#!/bin/sh
# Hetzner: pull main when it has news and rebuild (cron, every minute, see /etc/cron.d/washbubbles-deploy).
# Rebuilds only what changed, WITHOUT taking the site down:
#  - backend: the new one starts next to the old one; only when it answers is the old one stopped (the frontend's nginx finds
#    backends by name and retries the other one, docker/nginx.conf);
#  - frontend: there are two (frontend on 8081, frontend_b on 8082, both behind the host nginx, docker/host-nginx-upstream.conf);
#    they are replaced one at a time.
# If the site is not healthy afterwards it goes back to the previous commit (the same way).
#
# Everything is inside main(), read whole before it runs: this file can change under the "git merge" below.
main() {
cd /opt/washbubbles || exit 1
log() { echo "[$(date '+%F %T')] $*"; }
dc() { docker compose --env-file .env.docker "$@"; }
health() { for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -fsS -o /dev/null https://freshbubbles.pt/api/health && curl -fsS -o /dev/null https://freshbubbles.pt/ && return 0; sleep 5; done; return 1; }

# A backend container answers its own health check (it has no published port: ask from inside).
be_ok() { docker exec "$1" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; }
fe_ok() { curl -fsS -o /dev/null "http://127.0.0.1:$1/"; }

roll_backend() {
  dc build backend >/dev/null 2>&1 || { log "backend build failed"; return 1; }
  olds=$(dc ps -q backend)
  n=$(echo "$olds" | grep -c .)
  if [ "$n" -eq 0 ]; then dc up -d --no-deps backend >/dev/null 2>&1; return $?; fi
  dc up -d --no-deps --no-recreate --scale backend=$((n + 1)) backend >/dev/null 2>&1 || { log "could not start the new backend"; return 1; }
  new=$(dc ps -q backend | grep -v -F "$olds" | head -1)
  [ -n "$new" ] || { log "no new backend container"; return 1; }
  ok=""; for i in $(seq 1 60); do be_ok "$new" && { ok=1; break; }; sleep 2; done
  if [ -z "$ok" ]; then
    log "new backend did not answer: keeping the old one"
    docker rm -f "$new" >/dev/null 2>&1
    return 1
  fi
  sleep 4 # the frontends' nginx looks the name up again every 2 s: let it see the new backend before the old one goes
  for c in $olds; do docker stop -t 15 "$c" >/dev/null 2>&1; docker rm "$c" >/dev/null 2>&1; done
  log "backend replaced without stopping ($(echo "$new" | cut -c1-12))"
}

roll_frontend() {
  dc build frontend >/dev/null 2>&1 || { log "frontend build failed"; return 1; }
  for pair in frontend:8081 frontend_b:8082; do
    svc=${pair%%:*}; port=${pair##*:}
    dc up -d --no-deps --force-recreate "$svc" >/dev/null 2>&1 || { log "$svc did not start"; return 1; }
    ok=""; for i in $(seq 1 30); do fe_ok "$port" && { ok=1; break; }; sleep 1; done
    [ -n "$ok" ] || { log "$svc does not answer on $port"; return 1; }
  done
  log "frontend replaced one at a time"
}

roll() {
  r=0
  case " $* " in *" backend "*) roll_backend || r=1 ;; esac
  case " $* " in *" frontend "*) roll_frontend || r=1 ;; esac
  return $r
}

git fetch origin --quiet || { log "fetch failed"; exit 1; }
old=$(git rev-parse HEAD); new=$(git rev-parse origin/main)
[ "$old" = "$new" ] && exit 0
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then log "tracked files changed on the server: not updating"; exit 2; fi
files=$(git diff --name-only "$old" "$new")
git merge --ff-only origin/main >/dev/null 2>&1 || { log "fast-forward not possible"; exit 2; }
log "update $(echo "$old" | cut -c1-7) -> $(echo "$new" | cut -c1-7)"

targets=""
echo "$files" | grep -qE '^backend/|^docker-compose|^\.env' && targets="$targets backend"
echo "$files" | grep -qE '^src/|^public/|^index\.html|^vite\.config|^docker/|^docker-compose|^package(-lock)?\.json|^tailwind|^postcss|^Dockerfile' && targets="$targets frontend"
if [ -z "$targets" ]; then log "no code change (docs/scripts only)"; exit 0; fi
log "rebuilding:$targets"
prev=$old
roll $targets
if health; then log "healthy at $(git rev-parse --short HEAD)"; exit 0; fi
log "NOT healthy: going back to $(echo "$prev" | cut -c1-7)"
git reset --hard "$prev" >/dev/null 2>&1
roll backend frontend
health && log "rollback healthy" || log "WARNING: rollback not healthy either"
exit 3
}
main "$@"
