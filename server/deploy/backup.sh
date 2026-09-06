#!/usr/bin/env bash
# Online, consistent backup of the gateway SQLite database using VACUUM INTO.
# Safe to run while the gateway is serving. Keeps the 30 newest backups.
#
# Usage (run from server/deploy):
#   ./backup.sh
# Schedule it, e.g. daily at 03:17:
#   17 3 * * * cd /srv/mareo/server/deploy && ./backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"

stamp="$(date +%Y%m%d-%H%M%S)"
filename="mareo-$stamp.db"
mkdir -p backups

docker compose exec -T gateway node -e "
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(process.env.DB_PATH ?? 'data/mareo.db')
  db.exec('VACUUM INTO \"/app/backups/$filename\"')
  db.close()
"

echo "backup written to backups/$filename"
find backups -name 'mareo-*.db' -type f | sort -r | tail -n +31 | xargs -r rm --
