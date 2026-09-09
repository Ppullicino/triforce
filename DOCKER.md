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
