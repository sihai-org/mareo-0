#!/usr/bin/env bash
# Regenerates the public operations page (https://mareo.cn/stats/) from the
# gateway database and publishes it as a static file. Run from server/deploy:
#
#   */15 * * * * cd /srv/mareo/server/deploy && ./stats-page.sh >> backups/stats.log 2>&1
#
# The page is a static snapshot on purpose: the database stays unreachable from
# the internet, and a failure leaves the previous page in place.
set -euo pipefail
cd "$(dirname "$0")"

site_dir=/var/www/mareo-site/stats
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Download requests come from the web server log; the OSS counters need
# credentials the gateway does not have, so the public page reports requests.
downloads="$(grep -ho 'GET /downloads/[^ ]*' /var/log/nginx/access.log* 2>/dev/null | wc -l | tr -d ' ' || echo 0)"

docker compose exec -T gateway node dist/src/stats-page.js --downloads "$downloads" > "$tmp"

mkdir -p "$site_dir"
chmod 644 "$tmp"
mv "$tmp" "$site_dir/index.html"
echo "$(date -Is) stats page regenerated (downloads=$downloads)"
