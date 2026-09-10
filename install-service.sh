#!/bin/bash
# Run this once with sudo to install and start the Triforce systemd service.
# Usage: sudo bash install-service.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${SUDO_USER:-$USER}"

# Node discovery tries three shells in order of how common each setup is:
# 1. Login shell (works for system-wide installs and nvm init placed in .profile).
# 2. Interactive shell (works for the common case of nvm init living in .bashrc,
#    which a plain login shell never sources).
# 3. A fresh shell that sources ~/.nvm/nvm.sh directly, for setups where nvm
#    is only wired into an interactive prompt via a guard that skips non-interactive shells.
# Each attempt is piped through `tail -n1`: an interactive shell on a fresh
# account also prints Ubuntu's stock "To run a command as administrator..."
# sudo lecture (/etc/bash.bashrc) to stdout on first login, which would
# otherwise be captured as part of NODE_BIN. `command -v node` is always the
# last line a successful attempt prints, so trimming to the last line is safe.
NODE_BIN="$(sudo -u "$SERVICE_USER" bash -lc 'command -v node' 2>/dev/null | tail -n1 || true)"

if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(sudo -u "$SERVICE_USER" bash -ic 'command -v node' 2>/dev/null | tail -n1 || true)"
fi

if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(sudo -u "$SERVICE_USER" bash -c '
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    command -v node
  ' 2>/dev/null | tail -n1 || true)"
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.js was not found for $SERVICE_USER (checked login shell, interactive shell, and \$HOME/.nvm/nvm.sh). Install Node.js, or ensure nvm loads for $SERVICE_USER, then re-run this script." >&2
  exit 1
fi

touch "$SCRIPT_DIR/.env"
chown "$SERVICE_USER" "$SCRIPT_DIR/.env"
chmod 600 "$SCRIPT_DIR/.env"
if ! grep -q '^TRIFORCE_TOKEN=' "$SCRIPT_DIR/.env"; then
  printf 'TRIFORCE_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$SCRIPT_DIR/.env"
fi

# Pass through the filesystem-navigator roots if the operator set them for this
# install (colon-separated absolute paths; defaults to $HOME inside the server).
if [ -n "${TRIFORCE_FS_ROOTS:-}" ]; then
  if grep -q '^TRIFORCE_FS_ROOTS=' "$SCRIPT_DIR/.env"; then
    sed -i "s|^TRIFORCE_FS_ROOTS=.*|TRIFORCE_FS_ROOTS=${TRIFORCE_FS_ROOTS}|" "$SCRIPT_DIR/.env"
  else
    printf 'TRIFORCE_FS_ROOTS=%s\n' "${TRIFORCE_FS_ROOTS}" >> "$SCRIPT_DIR/.env"
  fi
fi

echo "Installing Triforce systemd service..."
sed -e "s|@USER@|$SERVICE_USER|g" \
    -e "s|@WORKDIR@|$SCRIPT_DIR|g" \
    -e "s|@NODE@|$NODE_BIN|g" \
    "$SCRIPT_DIR/triforce.service" > /etc/systemd/system/triforce.service

echo "Reloading systemd..."
systemctl daemon-reload

echo "Enabling service (start on boot)..."
systemctl enable triforce

echo "Starting service..."
systemctl start triforce

echo ""
echo "Done. Service status:"
systemctl status triforce --no-pager
