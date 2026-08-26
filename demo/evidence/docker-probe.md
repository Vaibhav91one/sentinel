# Docker-in-sandbox capability probe

## Verdict: **SUPPORTED** — Docker containers run inside this sandbox ✅

### Evidence summary (full honest log in artifact below)

| Step | Result | Evidence |
|---|---|---|
| 1. Runtime inventory | No runtimes/sockets present | docker/podman/containerd/runc/nerdctl all NOT FOUND; no `.sock` files |
| 2. Install `docker.io` | Success | `docker.io 20.10.24+dfsg1`, containerd 1.6.20, runc 1.1.5 (bookworm) |
| 3. `dockerd &` + `docker info` | Daemon healthy | `Daemon has completed initialization`, `API listen on /var/run/docker.sock`, overlay2, cgroup v2, docker0 bridge up |
| 4. **Real container run** | Ran, exit 0 | Full PID/UTS/net/mnt/IPC isolation verified (distinct ns inodes), own hostname, own bridge IP `172.17.0.2`, init = PID 1 |
| 5. Rootless podman | N/A | podman absent at step 1 (conditional step — documented, not installed) |

### Why it works (and why it could have failed)
The sandbox is itself a container (`/.dockerenv`, PID 1 = `daytona`, overlay2 rootfs) running under the **Sysbox** runtime (sysboxfs FUSE mounts visible). Sysbox is purpose-built for Docker-in-Docker, which is why a nested `dockerd` succeeds despite the **active outer seccomp filter** (`Seccomp: 2`, 1 filter) and AppArmor. We hold all 41 caps (incl. CAP_SYS_ADMIN/NET_ADMIN), so the kernel-side requirements were present.

### Honest notes (no failures hidden)
- My first run test echoed the **host's** uname because `$(uname -a)` was expanded by the *outer* shell — a test artifact, not a namespace leak. Cleanly re-tested: inside hostname was the container-ID `493f468ddb30`, and namespace inodes were all distinct.
- `docker pull` from Docker Hub was **not** tested — registry hosts aren't scoped (egress-restricted sandbox). Image creation used an offline `docker import` of a busybox-static rootfs. So: containers run; image *pulling* is unverified and would need registry scope.
- `dockerd` is left running; stop with `pkill dockerd` if desired.

### Scope bookkeeping (per hard rules)
- **Scope entry authorizing network work:** temporary public entry `deb.debian.org` (added via `scope_add_temporary`, 30-min TTL, auto-expires; `scope_check` → `allowed` before any contact). All other network I/O (none) stayed local.
- **Intrusive approval:** none required — this was a local capability probe; no active scan/exploit of any scoped target was performed.

```sandbox_artifacts
[Docker capability probe report](/opt/tf/artifacts/docker-capability-probe.md)
```