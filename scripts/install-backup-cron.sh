#!/usr/bin/env bash
# One-off, on the central server: daily backup at 23:00 Lisbon time (the shop PCs make theirs at the same hour).
set -euo pipefail
chmod +x /opt/washbubbles/scripts/backup-mongo.sh
cat > /etc/cron.d/washbubbles-backup <<'CRON'
# the server's clock is UTC and this cron has no time zones: asked at 22:00 and 23:00 UTC, it runs in the one that is 23:00 in Lisbon
0 22,23 * * * root [ "$(TZ=Europe/Lisbon date +\%H)" = 23 ] && bash /opt/washbubbles/scripts/backup-mongo.sh >> /root/backups/cron.out 2>&1
CRON
chmod 644 /etc/cron.d/washbubbles-backup
echo installed
