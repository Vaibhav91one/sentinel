#!/usr/bin/env python3
"""
Generic Sentinel mission driver: send a message to a session, then handle
approval pauses / agent questions automatically until the mission completes.

Usage:
  python3 scripts/drive-turn.py --sid <session-id> --message "<text>" \
      [--deny-first] [--max-rounds 25] [--poll 12]

--deny-first : deny the FIRST intrusive approval, allow everything after
               (exercises the graceful-degradation path).
"""
import argparse, json, time, urllib.request, urllib.error

BASE = "http://localhost:8790/api/v1"

def http(url, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body,
        headers={"content-type": "application/json"}, method="POST" if payload is not None else "GET")
    return json.load(urllib.request.urlopen(req, timeout=120))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", required=True)
    ap.add_argument("--message", required=True)
    ap.add_argument("--deny-first", action="store_true")
    ap.add_argument("--max-rounds", type=int, default=25)
    ap.add_argument("--poll", type=int, default=12)
    args = ap.parse_args()

    denied_once = False
    final_text = ""

    def latest_state():
        d = http(f"{BASE}/sessions/{args.sid}/events")
        evs = d.get("data", d)              # newest-first
        newest = evs[0]["event"]["type"] if evs else None
        running = newest != "turn.done"
        done = [e["event"] for e in evs if e["event"]["type"] == "turn.done"]
        ra = done[0].get("state", {}).get("required_actions") or [] if done else []
        ids = []
        if ra:
            for r in ra:
                for c in r.get("tool_calls") or []:
                    ids.append(c["id"])
                if r.get("toolCallId"):
                    ids.append(r["toolCallId"])
        # also catch response_required (agent questions)
        qids = []
        rr = [e["event"] for e in evs if e["event"]["type"] == "tool.response_required"]
        if rr and not ids:
            for c in (rr[0].get("toolCalls") or rr[0].get("tool_calls") or []):
                qids.append(c.get("id") or c.get("toolCallId"))
        # newest substantive final text (search deep - events paginate at 100)
        txt = ""
        msgs = [e["event"] for e in evs if e["event"].get("type") == "model.message"]
        for m in msgs:                      # msgs are newest-first already
            c = m.get("content")
            t = c if isinstance(c, str) else "".join(
                x.get("text", "") for x in c if isinstance(x, dict)) if isinstance(c, list) else ""
            if m.get("finish_reason") == "stop" and len(t.strip()) > 200:
                txt = t
                break
        return ids, qids, txt, running

    http(f"{BASE}/sessions/{args.sid}/turns",
         {"stream": False, "input": [{"type": "user.message", "content": args.message}]})

    nudges = 0
    for rnd in range(1, args.max_rounds + 1):
        time.sleep(args.poll)
        ids, qids, txt, running = latest_state()
        if running and not ids and not qids:
            print(f"[{rnd}] mission actively running - waiting (no nudge)")
            continue
        if txt and not ids and not qids:
            final_text = txt
            print("=== COMPLETE ===")
            print(txt[-3000:])
            return
        if qids and not ids:
            print(f"[{rnd}] answering {len(qids)} question(s)")
            inp = [{"type": "user.tool_response", "thread_id": "main",
                    "tool_call_id": q, "content":
                    "Proceed autonomously with reasonable security-assessment choices."}
                   for q in qids]
        elif ids:
            use_deny = args.deny_first and not denied_once
            decision = {"status": "deny", "reason": "operator deny - exercise passive-only continuation"} \
                       if use_deny else {"status": "allow"}
            print(f"[{rnd}] {'DENY' if use_deny else 'ALLOW'} x{len(ids)}")
            if use_deny: denied_once = True
            inp = [{"type": "user.tool_approval", "thread_id": "main",
                    "tool_call_id": i, "approval": decision} for i in ids]
        else:
            if nudges >= 3:
                print("3 nudges without progress - stopping to avoid pollution")
                break
            nudges += 1
            print(f"[{rnd}] nudging continue ({nudges}/3)")
            inp = [{"type": "user.message", "content":
                    "Continue autonomously to completion. When finished, write the final ranked DRAFT report as pure text with zero tool calls."}]
        http(f"{BASE}/sessions/{args.sid}/turns", {"stream": False, "input": inp})

    print("MAX ROUNDS reached; dumping latest substantial text:")
    print(final_text[:2000])

if __name__ == "__main__":
    main()
