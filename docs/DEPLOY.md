# Deploying Sentinel to an always-on VM

Self-hosts the three control-plane services (scope-guard, TrueForge harness,
console) on a single VM with systemd process management, token auth, and a
Cloudflare Tunnel for HTTPS — no open inbound ports. Targets GCP's e2-micro
Always Free tier, but the systemd/tunnel steps work on any Debian/Ubuntu VM.

**Scope note:** this deploys the *control plane* only. Mission sandboxes
(where actual scanning/exploitation happens) are separately provisioned by
Daytona per the harness's own config — nothing here changes that.

**Security boundaries this deploy preserves, not weakens:**
- scope-guard (`:9930`) is hardcoded to `127.0.0.1` in code — it is never
  reachable off this VM, by design. Don't try to "fix" that.
- The harness (`:8790`) also stays loopback-only in this setup — only the
  console is tunnel-fronted.
- Auth is **token-based** (`CONSOLE_TOKEN`/`GUARD_TOKEN`/`REQUIRE_GUARD_TOKEN=1`),
  not OIDC. Real OIDC needs the harness in non-standalone mode with a live
  Postgres + Redis alongside it — a meaningfully bigger footprint that
  doesn't fit comfortably on an e2-micro. If you outgrow token auth later,
  that's the upgrade path, not covered by this doc.

## 1. Provision the VM

Your own step — needs your GCP account/billing. GCP Console → Compute Engine
→ Create Instance → **e2-micro**, region `us-west1`/`us-central1`/`us-east1`
(required for the Always Free allowance), Debian 12 image, default networking
(no need to open any firewall ports — the tunnel is outbound-only).

## 2. Bootstrap the VM

SSH in, then:

```bash
# Node 22 (NodeSource) — matches this repo's engines.node >=22.14
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# pnpm via corepack (ships with Node >=16.9)
corepack enable
corepack prepare pnpm@latest --activate
```

## 3. Create a dedicated service user, clone the repo

Don't run this under your own login user — a compromised mission sandbox or
a bug in one of these services shouldn't inherit your full account.

```bash
sudo useradd -m -s /bin/bash sentinel
sudo -u sentinel -i
git clone https://github.com/Vaibhav91one/sentinel /home/sentinel/sentinel
cd /home/sentinel/sentinel
```

## 4. Install and build

```bash
pnpm install
pnpm build     # compiles mcp/scope-guard's TypeScript; the harness itself
               # is a pre-built npm dependency, no build step needed for it
```

## 5. Write `.env`

```bash
cp deploy/.env.example .env
chmod 600 .env
# generate real values:
python3 -c "import secrets; print('GUARD_TOKEN=' + secrets.token_hex(24))" >> .env
python3 -c "import secrets; print('CONSOLE_TOKEN=' + secrets.token_hex(16))" >> .env
# then edit .env by hand: fill DEEPSEEK_API_KEY (or OPENAI_ACTIVE/OPENAI_MODEL),
# dedupe the GUARD_TOKEN/CONSOLE_TOKEN lines the template already has empty,
# confirm REQUIRE_GUARD_TOKEN=1 is set.
```

`.env` is gitignored — never commit it. See `deploy/.env.example` for the
full annotated list of what each variable does.

## 6. Install the systemd units

```bash
exit   # back to your sudo-capable user
cd /home/sentinel/sentinel
for f in deploy/systemd/sentinel-guard.service deploy/systemd/sentinel-harness.service deploy/systemd/sentinel-console.service deploy/systemd/sentinel.target; do
  sed "s#__SENTINEL_HOME__#/home/sentinel/sentinel#g" "$f" | sudo tee "/etc/systemd/system/$(basename "$f")" >/dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now sentinel.target
```

## 7. Verify locally on the VM (before touching networking)

```bash
systemctl status sentinel-guard sentinel-harness sentinel-console  # all "active (running)"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9930/healthz              # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/api/v1/openapi.json  # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8792/                     # 200 or a login redirect
ls -la /home/sentinel/sentinel/data/    # scope.json + audit.jsonl should exist HERE,
                                         # not anywhere else — confirms WorkingDirectory
                                         # was set correctly in the guard unit
```

## 8. Cloudflare Tunnel (public HTTPS, no open ports)

Requires a domain on Cloudflare (free to add one if you don't have it there).

```bash
# install cloudflared (Debian package from Cloudflare's repo)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

cloudflared tunnel login                        # opens a browser auth flow
cloudflared tunnel create sentinel-console       # prints a <tunnel-id>, writes
                                                  # ~/.cloudflared/<tunnel-id>.json
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<tunnel-id>.json /etc/cloudflared/
sed -e "s#__TUNNEL_ID__#<tunnel-id>#g" -e "s#__YOUR_HOSTNAME__#sentinel.yourdomain.com#g" \
  deploy/cloudflared/config.yml | sudo tee /etc/cloudflared/config.yml >/dev/null

cloudflared tunnel route dns sentinel-console sentinel.yourdomain.com
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## 9. Final check

From an **outside machine** (not the VM):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -m 5 https://sentinel.yourdomain.com/   # console, reachable
curl -s -o /dev/null -w '%{http_code}\n' -m 5 http://<vm-external-ip>:8790/ 2>&1 # should time out / refuse
curl -s -o /dev/null -w '%{http_code}\n' -m 5 http://<vm-external-ip>:9930/ 2>&1 # should time out / refuse
```

The last two failing (not the first) is the point — harness and scope-guard
must never be reachable except from the VM itself. Visit
`https://sentinel.yourdomain.com/login?token=<your-CONSOLE_TOKEN>` in a
browser to confirm the token gate is actually enforced, not silently open.

## Known gap, documented not hidden

The console's `/api/*` proxy to the harness (`console/serve.mjs`) does not
forward the client's `Authorization` header. This is harmless today — the
harness has no auth of its own in standalone mode — but if you ever add
harness-side auth later, requests routed through the console's `/api/*` path
won't carry credentials to the harness automatically. Revisit
`console/serve.mjs`'s `/api/*` handler at that point.

## Operating

```bash
systemctl start|stop|restart sentinel.target   # all three at once
journalctl -u sentinel-harness -f              # tail one service's logs
journalctl -u sentinel-guard -f
journalctl -u sentinel-console -f
```
