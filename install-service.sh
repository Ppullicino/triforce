#!/bin/bash
# Run this once with sudo to install and start the Triforce systemd service.
# Usage: sudo bash install-service.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${SUDO_USER:-$USER}"
NODE_BIN="$(sudo -u "$SERVICE_USER" bash -lc 'command -v node')"

if [ -z "$NODE_BIN" ]; then
  echo "Node.js was not found for $SERVICE_USER" >&2
  exit 1
fi

touch "$SCRIPT_DIR/.env"
chown "$SERVICE_USER" "$SCRIPT_DIR/.env"
chmod 600 "$SCRIPT_DIR/.env"
if ! grep -q '^TRIFORCE_TOKEN=' "$SCRIPT_DIR/.env"; then
  printf 'TRIFORCE_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$SCRIPT_DIR/.env"
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
