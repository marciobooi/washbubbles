#!/bin/sh
# Hetzner: pull main when it has news and rebuild (cron, every minute, see /etc/cron.d/washbubbles-deploy).
# Rebuilds only what changed; if the site is not healthy afterwards it goes back to the previous commit.
cd /opt/washbubbles || exit 1
log() { echo "[$(date '+%F %T')] $*"; }
health() { for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -fsS -o /dev/null https://freshbubbles.pt/api/health && curl -fsS -o /dev/null https://freshbubbles.pt/ && return 0; sleep 5; done; return 1; }
build() { docker compose --env-file .env.docker up -d --build "$@" >/dev/null 2>&1; }

git fetch origin --quiet || { log "fetch failed"; exit 1; }
old=$(git rev-parse HEAD); new=$(git rev-parse origin/main)
[ "$old" = "$new" ] && exit 0
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then log "tracked files changed on the server: not updating"; exit 2; fi
files=$(git diff --name-only "$old" "$new")
git merge --ff-only origin/main >/dev/null 2>&1 || { log "fast-forward not possible"; exit 2; }
log "update $(echo "$old" | cut -c1-7) -> $(echo "$new" | cut -c1-7)"

targets=""
echo "$files" | grep -qE '^backend/|^docker-compose|^\.env' && targets="$targets backend"
echo "$files" | grep -qE '^src/|^public/|^index\.html|^vite\.config|^docker/|^package(-lock)?\.json|^tailwind|^postcss|^Dockerfile' && targets="$targets frontend"
if [ -z "$targets" ]; then log "no code change (docs/scripts only)"; exit 0; fi
log "rebuilding:$targets"
build $targets
if health; then log "healthy at $(git rev-parse --short HEAD)"; exit 0; fi
log "NOT healthy: going back to $(echo "$old" | cut -c1-7)"
git reset --hard "$old" >/dev/null 2>&1
build backend frontend
health && log "rollback healthy" || log "WARNING: rollback not healthy either"
exit 3
