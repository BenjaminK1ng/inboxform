#!/usr/bin/env bash
# (Re)start InboxForm + Cloudflare tunnel. Prints the live URL.
# Run after reboot: bash start.sh
set -e
cd "$(dirname "$0")"

# 1. start the server (detached)
if ! curl -s -o /dev/null --max-time 2 http://localhost:8080/api/status 2>/dev/null; then
  setsid nohup env $(grep -v '^#' data/.env | xargs) PORT=8080 node server/server.js \
    > /tmp/inboxform-server.log 2>&1 < /dev/null & disown
  sleep 1.5
  echo "server started"
else
  echo "server already running"
fi

# 2. start the tunnel if not running
if ! pgrep -f "cloudflared tunnel" > /dev/null; then
  setsid nohup ~/bin/cloudflared tunnel --url http://localhost:8080 \
    > /tmp/inboxform-tunnel.log 2>&1 < /dev/null & disown
  sleep 8
fi

URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/inboxform-tunnel.log | head -1)
echo "LIVE: $URL"
echo "status: curl -s $URL/api/status"
