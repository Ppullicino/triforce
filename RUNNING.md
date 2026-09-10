# Triforce — Running & Operations

## Onboarding (`triforce init`)

On a fresh machine, from the project directory:

```bash
triforce init      # guided: dependency + login check for claude/codex/agy,
                   # generates TRIFORCE_TOKEN in .env (chmod 600), optionally
                   # installs the systemd service, then prints the access URL,
                   # token, and a QR code, and writes triforce-access.txt.
triforce doctor    # re-check logins, sandbox status, workspace-root disk, and
                   # reprint access info at any time.
```

`triforce init` asks for optional **filesystem-navigator roots** — a
colon-separated list of absolute paths the web client may browse and pick a
working folder from. It defaults to `$HOME`; set `TRIFORCE_FS_ROOTS` in `.env`
(or pass it to `install-service.sh`) to widen or narrow it. Secret paths
(`.env`, `.ssh`, `.aws`, other CLIs' credential dirs) are always denied.

## Modes

- **Mode 1 — build:** Prompt Designer ↔ Supervisor refine the spec against your
  original prompt, then Coder ↔ Supervisor build and test it in the sandbox.
  Optionally pick a real working folder; review the streamed diff and **Apply**
  it back (into a fresh `triforce/apply-*` git branch by default —
  `TRIFORCE_APPLY_GIT_POLICY` = `branch` | `refuse` | `force`).
- **Mode 2 — credit extender:** roleless. A router picks the best CLI per step
  and fails over to another on a rate/usage-limit signal, spreading load across
  the three subscriptions. Questions are answered by several CLIs and reconciled.
- **Mode 3 — verified chat:** every answer is drafted, cross-checked by all
  three CLIs, and reconciled before you see it. Read-only folder context only;
  never writes or executes.

Modes 1 and 2 require a working sandbox (`/api/capabilities` → `sandbox:
"systemd"`); Mode 3 does not.

## Access

The dashboard and WebSocket require the `TRIFORCE_TOKEN` stored in `.env`. Open
`http://localhost:3000/login` and enter the token there. The form sends it in a POST
body; do not put it in a URL. Legacy `/auth?token=...` support is disabled unless an
operator explicitly sets `TRIFORCE_ALLOW_URL_TOKEN_AUTH=1` during a migration.

The authentication route sets an HTTP-only, same-site cookie and redirects to the dashboard. Do not expose port 3000 directly to an untrusted network; use an SSH tunnel or an authenticated TLS reverse proxy.

---

## Systemd Service (Always-On)

### One-time Install

Run this once from the project directory to install the systemd service:

```bash
sudo bash install-service.sh
```

This copies `triforce.service` to `/etc/systemd/system/`, enables it to start on boot, and starts it immediately.

### Service Management

```bash
# Check status
sudo systemctl status triforce

# Restart
sudo systemctl restart triforce

# Stop
sudo systemctl stop triforce

# Start
sudo systemctl start triforce

# Disable autostart
sudo systemctl disable triforce
```

### View Logs

```bash
# Live tail (Ctrl+C to exit)
journalctl -u triforce -f

# Or use the helper script
~/triforce-logs.sh

# Last 100 lines
journalctl -u triforce -n 100
```

---

## PWA — Install as App

Triforce is a fully installable Progressive Web App. Once installed it runs full-screen with no browser chrome.

### Android (Chrome)

1. Open `http://10.168.69.10:3000` in Chrome
2. Tap the **⋮** menu → **Add to Home screen**
3. Tap **Install** when prompted
4. A "TRIFORCE" icon appears on your home screen

An install banner will also appear automatically after 30 seconds if the app is not already installed.

### iPhone / iPad (Safari)

1. Open `http://10.168.69.10:3000` in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add** in the top-right corner

> Note: iOS requires Safari for PWA installation. Chrome on iOS cannot install PWAs.

### Mac (Chrome or Edge)

1. Open `http://10.168.69.10:3000` in Chrome or Edge
2. Click the **install icon** (⊕) in the address bar, or go to **⋮** → **Install Triforce**
3. Click **Install**

The app opens as a standalone window without browser chrome.

---

## Notes

- The installer detects the invoking user's Node binary and project path when it renders the service unit. Re-run it after moving the project or changing Node installations. Detection tries a login shell, then an interactive shell, then explicit `~/.nvm/nvm.sh` sourcing, so nvm-managed Node is found regardless of which shell rc file its init script lives in.
- Transcripts are disabled by default. Set `TRIFORCE_TRANSCRIPTS=1` to create private, per-run transcript directories under `./transcripts/`; these are excluded from git and may contain sensitive data.
- Generated JavaScript requires a functioning per-user systemd manager. It runs with Node's permission model plus systemd resource, filesystem, process, and network restrictions.
- Mode 1 (and Mode 2's build path) create multi-file project workspaces under `~/.local/share/triforce/workspaces/` (override with `TRIFORCE_WORKSPACE_ROOT`). When a real folder is selected the workspace is seeded from a `.gitignore`-aware snapshot of it; the run only ever edits the copy, and changes reach the real folder solely through an explicit **Apply**. Generated paths are validated, dependencies are exposed read-only, and the declared Node test file runs with a private network and writes restricted to its own workspace.
- The per-CLI subscription ledger persists at `${TRIFORCE_RUNS_DIR}/ledger.json` (rolling call/token windows + cooldowns); it feeds the Mode 2 router and the dashboard headroom bar (`GET /api/ledger`).
- The `.env` file holds `TRIFORCE_TOKEN` (and other server settings) and is excluded from git. Model access is provided entirely by the locally installed `claude`, `codex`, and `agy` CLIs, which you authenticate separately; the server no longer reads provider API keys.
