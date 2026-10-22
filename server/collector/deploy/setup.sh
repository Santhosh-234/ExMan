#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 VM:  sudo bash setup.sh <hostname>
# Run it from the folder that contains server.mjs (the copied server/collector directory).
set -euo pipefail
HOST="${1:?usage: sudo bash setup.sh <hostname, e.g. 13-232-10-4.sslip.io>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

# Node 22 (needs the built-in node:sqlite)
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy (automatic HTTPS certificates)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# the collector
mkdir -p /opt/exman-collector
cp "$HERE"/*.mjs /opt/exman-collector/
cp "$HERE/deploy/exman-collector.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now exman-collector

# the web front door
sed "s/HOST/${HOST}/" "$HERE/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl restart caddy

sleep 2
echo "--- local check:"; curl -fsS http://127.0.0.1:8787/healthz; echo
echo "--- public check (certificate can take ~30s the first time):"; curl -fsS "https://${HOST}/healthz" || echo "not reachable yet: check ports 80/443 in the security group, then retry"
echo; echo "Done. Set the GitHub repo variable TELEMETRY_URL to: https://${HOST}/t"
