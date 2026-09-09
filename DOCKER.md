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

## 1. Set an access token

```bash
echo "TRIFORCE_TOKEN=$(openssl rand -hex 24)" >> .env
```

`.env` is git‑ignored. Compose reads `TRIFORCE_TOKEN` from it automatically.

## 2. Build

```bash
docker compose build
```

## 3. Log in to the three accounts (one time)

```bash
docker compose run --rm triforce sh -lc '
  claude auth login &&
  codex login --device-auth &&
  agy -p ping
'
```

Each CLI prints a URL (and, for Codex, a device code). Open it in your normal
browser, approve, and paste anything it asks back into the terminal. The logins are
written into the `triforce-home` volume and survive rebuilds and restarts.

Prefer Triforce's guided wizard? `docker compose run --rm triforce node cli.js` and
answer `y` to "re‑run the configuration setup"; answer `y` to "remote/headless VM?"
so Codex uses device‑auth. (It also starts a server afterwards — Ctrl‑C once you are
logged in.)

Check status any time:

```bash
docker compose run --rm triforce sh -lc 'claude auth status; codex login status; agy -p ping'
```

## 4. Run the server

```bash
docker compose up -d
```

Dashboard: <http://localhost:3100/login> — enter the `TRIFORCE_TOKEN` from `.env`.
On the LAN: `http://<this-host-ip>:3100/login`.

## Manage

```bash
docker compose logs -f            # tail logs
docker compose restart            # reload after code changes
docker compose down               # stop (image + login volume kept)
docker volume rm triforce_triforce-home   # wipe stored logins
```
