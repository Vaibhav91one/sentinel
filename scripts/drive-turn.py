#!/usr/bin/env python3
"""
Generic Sentinel mission driver — resilient approval/question resolution.

Handles:
- actively-running missions (waits, never nudges into pollution)
- single + BATCHED intrusive approvals (Allow/Deny, deny-first mode)
- agent questions (tool.response_required)
- subagent-thread approvals surfaced via 422 hints (self-correcting)
- empty-input completion signaling

Usage:
  python3 scripts/drive-turn.py --sid <session-id> --message "<text>" \
      [--deny-first] [--max-rounds 40] [--poll 15] [--resume]
"""
import argparse, json, re, time, urllib.request, urllib.error

BASE = "http://localhost:8790/api/v1"

def call(url, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body,
        headers={"content-type": "application/json"}, method="POST" if payload is not None else "GET")
    try:
        res = urllib.request.urlopen(req, timeout=120)
        return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"raw": raw}

def get(url):
    _, d = call(url)
    return d.get("data", d) if isinstance(d, dict) else d

def extract_pending(msg):
    """Pull pending tool-call ids (+thread hints) out of a 422 error message."""
    ids = re.findall(r'call_[A-Za-z0-9_-]+', msg)
    threads = re.findall(r'thread ([0-9a-f-]{36})', msg)
    if not ids:
        m = re.search(r'"toolCallId"\s*:\s*"([^"]+)"', msg)
        if m: ids = [m.group(1)]
    return ids, threads

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", required=True)
    ap.add_argument("--message", default="")
    ap.add_argument("--deny-first", action="store_true")
    ap.add_argument("--max-rounds", type=int, default=40)
    ap.add_argument("--poll", type=int, default=15)
    args = ap.parse_args()

    denied_once = False
    final_text = ""
    nudges = 0

    sid_url = f"{BASE}/sessions/{args.sid}"
    ev_url = f"{BASE}/sessions/{args.sid}/events"

    def events_all():
        out, token = [], None
        while True:
            code, d = call(ev_url + (f"?page_token={token}" if token else ""))
            if code != 200: return out
            out += d.get("data", [])
            token = d.get("page_token") or d.get("next_page_token")
            if not token: return out

    def state():
        evs = events_all()
        newest = evs[0]["event"]["type"] if evs else None
        running = newest != "turn.done"
        # pending approvals: latest turn.done required_actions OR live tool.response_required
        pend_ids, threads = [], []
        td = [e["event"] for e in evs if e["event"]["type"] == "turn.done"]
        for t in reversed(td):                      # newest done first
            ra = t.get("state", {}).get("required_actions") or []
            if ra:
                for r in ra:
                    th = r.get("thread_id") or r.get("threadId") or "main"
                    for c in r.get("tool_calls") or []:
                        cid = c.get("id") or c.get("toolCallId")
                        pend_ids.append(cid); threads.append(th)
                break
        qr = [e["event"] for e in evs if e["event"]["type"] == "tool.response_required"]
        qids = []
        if qr:
            for c in (qr[0].get("toolCalls") or []):
                qids.append(c.get("id"))
        # final text: newest stop-message with substance
        txt = ""
        msgs = [e["event"] for e in evs if e["event"].get("type") == "model.message"]
        for m in msgs:
            c = m.get("content")
            t = c if isinstance(c, str) else "".join(
                x.get("text", "") for x in c if isinstance(x, dict)) if isinstance(c, list) else ""
            if m.get("finish_reason") == "stop" and len(t.strip()) > 200 and not m.get("tool_calls"):
                txt = t; break
        return running, pend_ids, threads, qids, txt

    def approve(ids, threads, deny=False):
        inp = []
        for i, cid in enumerate(ids):
            th = threads[i] if i < len(threads) else "main"
            dec = {"status": "deny", "reason": "operator deny - continue passive-only"} \
                  if deny else {"status": "allow"}
            inp.append({"type": "user.tool_approval", "thread_id": th,
                        "tool_call_id": cid, "approval": dec})
        return call(f"{sid_url}/turns", {"stream": False, "input": inp})

    def answer(qids):
        inp = [{"type": "user.tool_response", "thread_id": "main", "tool_call_id": q,
                "content": "Proceed autonomously with reasonable security-assessment choices."}
               for q in qids]
        return call(f"{sid_url}/turns", {"stream": False, "input": inp})

    # kick off (or resume) with the operator message
    code, body = call(f"{sid_url}/turns",
        {"stream": False, "input": [{"type": "user.message", "content": args.message}]})
    print(f"[start] HTTP {code}")

    last_approved = None
    for rnd in range(1, args.max_rounds + 1):
        time.sleep(args.poll)

        # 422 hint from previous action? resolve exactly those first
        running, pend_ids, threads, qids, txt = state()

        if txt and not pend_ids and not qids and not running:
            print("=== COMPLETE ===")
            print(txt[-3500:])
            open(f"/tmp/drive-final-{args.sid[-8:]}.md", "w").write(txt)
            return

        # NOTE: required_actions persist on historical turn.done records even
        # after resolution - never skip approving based on dedupe alone.
        # Instead: attempt the approval; if the harness rejects it as already
        # resolved, fall through to nudge/completion handling.
            last_approved = key or last_approved
            use_deny = args.deny_first and not denied_once
            print(f"[{rnd}] {'DENY' if use_deny else 'ALLOW'} x{len(pend_ids)}")
            code, _ = approve(pend_ids, threads, deny=use_deny)
            if use_deny: denied_once = True
            if code >= 400:
                print(f"[{rnd}] approval POST rejected ({code}) - will re-detect")
            continue

        if qids:
            print(f"[{rnd}] answering {len(qids)} question(s)")
            answer(qids)
            continue

        if running:
            print(f"[{rnd}] mission actively running - waiting")
            continue

        # idle, no final text, nothing pending -> nudge a few times, then signal completion
        if nudges < 2:
            nudges += 1
            print(f"[{rnd}] nudging ({nudges}/2)")
            code, body = call(f"{sid_url}/turns", {"stream": False, "input": [
                {"type": "user.message", "content":
                 "Continue autonomously to completion; deliver the final ranked DRAFT report as pure text."}]})
            if code == 422:
                ids, ths = extract_pending(json.dumps(body))
                if ids:
                    print(f"[{rnd}] 422 revealed pending: {ids}")
                    code, _ = approve(ids, ths, deny=(args.deny_first and nudges == 1))
            continue

        # last resort: empty input signals parent completion (subagent aggregation)
        code, body = call(f"{sid_url}/turns", {"stream": False, "input": []})
        print(f"[{rnd}] completion signal -> HTTP {code}")
        if code == 200:
            time.sleep(30)

    print("MAX ROUNDS reached")

if __name__ == "__main__":
    main()
