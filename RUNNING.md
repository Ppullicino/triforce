# Triforce — Running & Operations

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

- The installer detects the invoking user's Node binary and project path when it renders the service unit. Re-run it after moving the project or changing Node installations.
- Transcripts are disabled by default. Set `TRIFORCE_TRANSCRIPTS=1` to create private, per-run transcript directories under `./transcripts/`; these are excluded from git and may contain sensitive data.
- Generated JavaScript requires a functioning per-user systemd manager. It runs with Node's permission model plus systemd resource, filesystem, process, and network restrictions.
- Mode 3 creates persistent multi-file projects under `~/.local/share/triforce/workspaces/` (override with `TRIFORCE_WORKSPACE_ROOT`). Generated paths are validated, dependencies are exposed read-only, and the declared Node test file runs with a private network and writes restricted to its own workspace.
- The `.env` file holds your API keys and is excluded from git.
