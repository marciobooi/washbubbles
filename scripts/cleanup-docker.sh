#!/bin/bash
# Weekly clean-up of what Docker piles up on the central server (cron, Sunday 04:30, see /etc/cron.d/washbubbles-cleanup).
# Every automatic deploy builds images and leaves a build cache behind: it reached 44 GB (of a 75 GB disk) in a month.
# Only things that are safe to lose are removed: build cache older than 3 days, images no container uses that nothing tags, old
# stopped containers. Running containers, their images and ALL volumes (the database, uploads, translation models) are never touched.
set -u
LOG=/var/log/washbubbles-cleanup.log
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
before=$(df --output=avail -BM / | tail -1 | tr -dc '0-9')
log "start (free ${before} MB)"
docker builder prune -f --filter "until=72h" >/dev/null 2>&1
docker image prune -f >/dev/null 2>&1                       # dangling images only (no tag, no container)
docker container prune -f --filter "until=72h" >/dev/null 2>&1
find /root/backups -name 'washstore-*.archive.gz' -mtime +30 -delete 2>/dev/null   # backups: the script keeps 14 days; anything left over from before goes at 30
after=$(df --output=avail -BM / | tail -1 | tr -dc '0-9')
log "done (free ${after} MB, freed $((after - before)) MB)"
used=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$used" -ge 85 ] && log "WARNING: disk still ${used}% full after the clean-up"
exit 0
