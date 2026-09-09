# Running Triforce in Docker

`Dockerfile` builds a Node 22 image with the three local model CLIs baked in:

| CLI | Installed via | Binary |
| --- | --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` | `/usr/local/bin/claude` |
| OpenAI Codex | `npm i -g @openai/codex` (no Homebrew) | `/usr/local/bin/codex` |
| Antigravity | official `antigravity.google/cli/install.sh` (SHA‑512 verified) | `/usr/local/bin/agy` |

Triforce's own setup wizard only *checks* for these; the image installs them.

## Limitation

The container has **no systemd**, so the generated‑code sandbox used by Mode 1 and
Mode 2 pipeline execution is unavailable (`/api/capabilities` reports
`sandbox: "unavailable"`). Use Docker for: CLI login, the dashboard, and chat‑style
use. Run on a systemd host for full pipeline runs.

## Authentication — log in once, on the host

`compose.yml` mounts the host user's CLI credential dirs into the container, so you
authenticate **once, on the host**, and the container reuses it:

| CLI | Host paths mounted |
| --- | --- |
| claude | `~/.claude`, `~/.claude.json` |
| codex | `~/.codex` |
| agy | `~/.gemini` (holds `antigravity-cli/antigravity-oauth-token`) |

The container runs as uid 1000 (matching the host user), so the mounts are
read‑write and OAuth token refreshes are shared.

On the host, in a normal terminal:

```bash
claude auth login          # skip if already logged in
codex login --device-auth
agy -p ping                # triggers sign-in if needed
```

Verify:

```bash
claude auth status ; codex login status ; agy -p "say ok"
```

**Caveat:** the container's `claude` / `codex` / `agy` then share live state with any
host Claude Code / Antigravity session (same files, same user). Fine for a single
operator; avoid heavy concurrent `agy` use on host and container at the same time.

> Prefer full isolation instead? Replace the four credential bind mounts in
> `compose.yml` with a named volume (`- triforce-home:/home/node`) and run the
> logins inside the container in a real terminal:
> `docker compose run --rm -it triforce sh -lc 'claude auth login && codex login --device-auth && agy -p ping'`.

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
