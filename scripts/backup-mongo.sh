#!/usr/bin/env bash
# Daily dump of the central MongoDB (all shops) with retention and a restore check, at 23:00 Lisbon time.
# Installed by scripts/install-backup-cron.sh. Output: /root/backups/washstore-YYYYmmdd-HHMM.archive.gz
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/washbubbles}"
OUT_DIR="${OUT_DIR:-/root/backups}"
KEEP="${KEEP:-1}"   # how many backups to keep: ONE, the latest that was made and checked (the old one goes only after the new one succeeded)
DB="${DB:-washstore}"
LOG="$OUT_DIR/backup.log"
mkdir -p "$OUT_DIR"
cd "$APP_DIR"
stamp="$(date +%Y%m%d-%H%M)"
file="$OUT_DIR/$DB-$stamp.archive.gz"
dc() { docker compose --env-file .env.docker "$@"; }
# With MONGO_AUTH=--auth the database asks for a user: the administrator's is in .env.docker (MONGO_ROOT_USER / MONGO_ROOT_PASS).
MU=$(grep -s '^MONGO_ROOT_USER=' .env.docker | cut -d= -f2-); MP=$(grep -s '^MONGO_ROOT_PASS=' .env.docker | cut -d= -f2-)
AUTH=""; [ -n "$MU" ] && AUTH="--username $MU --password $MP --authenticationDatabase admin"
fail() { echo "$(date -Is) FAILED: $1" >> "$LOG"; rm -f "$file"; exit 1; }

dc exec -T mongo mongodump $AUTH --quiet --db "$DB" --archive --gzip > "$file" || fail "mongodump"
size=$(stat -c %s "$file")
[ "$size" -gt 1000 ] || fail "dump too small ($size bytes)"

# Restore check: load it into a throw-away database and compare the number of users and settings, then drop it.
dc exec -T mongo mongorestore $AUTH --quiet --gzip --archive --nsFrom "$DB.*" --nsTo "${DB}_restorecheck.*" < "$file" || fail "restore check (mongorestore)"
live=$(dc exec -T mongo mongosh $AUTH --quiet "$DB" --eval 'db.users.countDocuments()+db.settings.countDocuments()')
copy=$(dc exec -T mongo mongosh $AUTH --quiet "${DB}_restorecheck" --eval 'db.users.countDocuments()+db.settings.countDocuments()')
dc exec -T mongo mongosh $AUTH --quiet "${DB}_restorecheck" --eval 'db.dropDatabase()' > /dev/null
[ "$live" = "$copy" ] || fail "restore check differs (live=$live copy=$copy)"

# the new backup is complete and its restore check passed: only now are the older ones removed
ls -1t "$OUT_DIR"/$DB-*.archive.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
# Off-site copy (optional): set OFFSITE_DEST in /etc/default/washbubbles-backup to an rclone destination, e.g. "hetzner-box:washbubbles".
if [ -r /etc/default/washbubbles-backup ]; then . /etc/default/washbubbles-backup; fi
if [ -n "${OFFSITE_DEST:-}" ]; then
  if command -v rclone >/dev/null 2>&1 && rclone copy "$file" "$OFFSITE_DEST" --quiet; then offsite="offsite ok"; else offsite="OFFSITE FAILED"; fi
else offsite="offsite not configured"; fi
echo "$(date -Is) ok $file ($size bytes, rows=$copy, $offsite)" >> "$LOG"
