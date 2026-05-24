#!/bin/bash
# Run this once with sudo to install and start the Triforce systemd service.
# Usage: sudo bash install-service.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing Triforce systemd service..."
cp "$SCRIPT_DIR/triforce.service" /etc/systemd/system/triforce.service

echo "Reloading systemd..."
systemctl daemon-reload

echo "Enabling service (start on boot)..."
systemctl enable triforce

echo "Starting service..."
systemctl start triforce

echo ""
echo "Done. Service status:"
systemctl status triforce --no-pager
