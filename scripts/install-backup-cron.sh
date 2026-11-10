#!/usr/bin/env bash
# One-off, on the central server: daily backup at 23:00 Lisbon time (the shop PCs make theirs at the same hour).
set -euo pipefail
chmod +x /opt/washbubbles/scripts/backup-mongo.sh
cat > /etc/cron.d/washbubbles-backup <<'CRON'
CRON_TZ=Europe/Lisbon
0 23 * * * root bash /opt/washbubbles/scripts/backup-mongo.sh >> /root/backups/cron.out 2>&1
CRON
chmod 644 /etc/cron.d/washbubbles-backup
echo installed
