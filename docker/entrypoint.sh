#!/bin/sh
# Container entrypoint: inject TRIFORCE_TOKEN (if given via the container env) as a
# systemd drop-in for the triforce user service, then hand off to systemd as PID 1.
set -e

mkdir -p /etc/systemd/user/triforce.service.d
if [ -n "${TRIFORCE_TOKEN:-}" ]; then
  printf '[Service]\nEnvironment=TRIFORCE_TOKEN=%s\n' "$TRIFORCE_TOKEN" \
    > /etc/systemd/user/triforce.service.d/10-token.conf
else
  rm -f /etc/systemd/user/triforce.service.d/10-token.conf
fi

exec /sbin/init
