#!/usr/bin/env bash
# One-off, on the central server: daily backup at 03:20.
set -euo pipefail
chmod +x /opt/washbubbles/scripts/backup-mongo.sh
cat > /etc/cron.d/washbubbles-backup <<'CRON'
20 3 * * * root /opt/washbubbles/scripts/backup-mongo.sh >> /root/backups/cron.out 2>&1
CRON
chmod 644 /etc/cron.d/washbubbles-backup
echo installed
