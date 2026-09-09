# Running Triforce in Docker

`Dockerfile` builds a Node 22 image with the three local model CLIs baked in:

| CLI | Installed via | Binary |
| --- | --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` | `/usr/local/bin/claude` |
| OpenAI Codex | `npm i -g @openai/codex` (no Homebrew) | `/usr/local/bin/codex` |
| Antigravity | official `antigravity.google/cli/install.sh` (SHA‑512 verified) | `/usr/local/bin/agy` |

Triforce's own setup wizard only *checks* for these; the image installs them.

## Two images

| | `Dockerfile` + `compose.yml` | `Dockerfile.systemd` + `compose.systemd.yml` |
| --- | --- | --- |
| Base | `node:22-bookworm-slim` | `debian:12` booting systemd as PID 1 |
| Privileges | unprivileged | **`privileged: true`** + tmpfs on `/run` |
| `/api/capabilities` sandbox | `unavailable` | **`systemd`** |
| Mode 1/2 pipeline runs (execute generated code) | ✗ rejected `SANDBOX_UNAVAILABLE` | ✓ works |
| Good for | CLI login, dashboard, chat-style use | full pipeline runs |

Run **one** of them (both use port 3100). The rest of this file covers the plain
image; jump to [systemd mode](#systemd-mode) for the other.

The plain container has no systemd, so the generated-code sandbox is unavailable
(`/api/capabilities` → `sandbox: "unavailable"`) and Mode 1/2 runs are rejected before
they start.

## Authentication — log in inside the container

`compose.yml` gives the container a self-contained credential volume
(`triforce-home` on `/home/node`) with no dependency on the host user's
`~/.claude` / `~/.codex` / `~/.gemini`. You authenticate once, **inside the
container, from a real terminal** (a TTY is required — this will hang if run
through a non-interactive wrapper).

With the stack running (`docker compose up -d`):

```bash
docker compose exec triforce claude auth login
docker compose exec triforce codex login --device-auth
docker compose exec triforce agy -p ping
```

| CLI | Flow |
| --- | --- |
| `claude auth login` | prints a URL → approve in your browser → it shows a code → paste it back at the `Paste code here >` prompt. |
| `codex login --device-auth` | prints a URL + short code → enter the code on the page → it polls and finishes on its own (no paste-back). |
| `agy -p ping` | opens a browser / prints a sign-in URL on first use → follow it → then it answers `ping`. |

Verify:

```bash
docker compose exec triforce sh -lc 'claude auth status; codex login status; agy -p "say ok"'
```

Logins persist in the `triforce-home` volume across rebuilds and restarts.
`docker volume rm triforce_triforce-home` wipes them.

> Prefer to reuse the host's existing logins instead of logging in again? Replace
> the `- triforce-home:/home/node` line in `compose.yml` with:
> ```yaml
>       - ${HOME}/.claude:/home/node/.claude
>       - ${HOME}/.claude.json:/home/node/.claude.json
>       - ${HOME}/.codex:/home/node/.codex
>       - ${HOME}/.gemini:/home/node/.gemini
> ```
> The container runs as uid 1000, so these are read-write and token refresh is
> shared — but the container then shares live state with any host Claude Code /
> Antigravity session.

## Run

```bash
echo "TRIFORCE_TOKEN=$(openssl rand -hex 24)" >> .env   # .env is git-ignored
docker compose build
docker compose up -d
```

Dashboard: <http://localhost:3100/login> — enter the `TRIFORCE_TOKEN` from `.env`.
On the LAN: `http://<this-host-ip>:3100/login`.

## Manage

```bash
docker compose logs -f            # tail logs
docker compose restart            # reload after code changes
docker compose down               # stop
```

---

## systemd mode

`Dockerfile.systemd` boots systemd as PID 1 so `systemd-run --user` (used by
`sandbox.js` and the workspace test runner) works inside the container. The server
runs as a systemd **user** service of the `triforce` account (uid 1000), which is
what gives it the user bus that `systemd-run --user` needs.

Requirements: a **cgroup v2** host (check: `stat -fc %T /sys/fs/cgroup` →
`cgroup2fs`) and `privileged: true` (set in `compose.systemd.yml`). No host paths
beyond the project directory are bind-mounted.

### Run

```bash
echo "TRIFORCE_TOKEN=$(openssl rand -hex 24)" >> .env    # if not already set
docker compose down                                       # stop the plain stack (same port)
docker compose -f compose.systemd.yml up -d
```

Confirm the sandbox is live:

```bash
curl -s -b "triforce_token=$(grep -oP 'TRIFORCE_TOKEN=\K.*' .env)" \
  http://localhost:3100/api/capabilities
# ... "sandbox":"systemd"
```

### Log in to the three CLIs (one time, real terminal)

```bash
docker compose -f compose.systemd.yml exec -u triforce triforce bash -lc 'claude auth login'
docker compose -f compose.systemd.yml exec -u triforce triforce bash -lc 'codex login --device-auth'
docker compose -f compose.systemd.yml exec -u triforce triforce bash -lc 'agy -p ping'
```

Same flows as [above](#authentication--log-in-inside-the-container): URL + paste for
claude, device code for codex, first-use sign-in for agy. Logins persist in the
`triforce-systemd-home` volume.

### Manage

```bash
docker compose -f compose.systemd.yml logs -f
docker compose -f compose.systemd.yml exec triforce journalctl -u user@1000.service -n 50
docker compose -f compose.systemd.yml down            # SIGRTMIN+3 -> clean systemd shutdown
```
