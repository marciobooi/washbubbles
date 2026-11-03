#!/bin/bash
# Clean-up of what Docker piles up on the central server (cron, every 6 hours, see /etc/cron.d/washbubbles-cleanup).
# Every automatic deploy builds images and leaves a build cache behind: it reached 44 GB (of a 75 GB disk) in a month.
# Only things that are safe to lose are removed: build cache older than 3 days, images no container uses that nothing tags, old
# stopped containers. Running containers, their images and ALL volumes (the database, uploads, translation models) are never touched.
# The build cache has a HARD CAP (5 GB): whatever the number of deploys in between, it cannot grow past that by more than a few hours' worth.
set -u
LOG=/var/log/washbubbles-cleanup.log
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
before=$(df --output=avail -BM / | tail -1 | tr -dc '0-9')
log "start (free ${before} MB)"
docker builder prune -f --max-used-space 5GB >/dev/null 2>&1   # keeps the most recent 5 GB of cache, drops the rest
docker image prune -f >/dev/null 2>&1                       # dangling images only (no tag, no container)
docker container prune -f --filter "until=72h" >/dev/null 2>&1
after=$(df --output=avail -BM / | tail -1 | tr -dc '0-9')
log "done (free ${after} MB, freed $((after - before)) MB)"
used=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$used" -ge 85 ] && log "WARNING: disk still ${used}% full after the clean-up"
exit 0
