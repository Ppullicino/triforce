# Triforce — Running & Operations

## Access

- **Local network:** http://10.168.69.5:3000
- **On the VM itself:** http://localhost:3000

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

- The service file references the NVM node binary at its current path. If you upgrade Node via NVM, update the `ExecStart` path in `/etc/systemd/system/triforce.service` and run `sudo systemctl daemon-reload && sudo systemctl restart triforce`.
- Transcript files are written to `./transcripts/` and are excluded from git.
- The `.env` file holds your API keys and is excluded from git.
