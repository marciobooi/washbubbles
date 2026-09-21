#!/usr/bin/env bash
# Frees port 3000 for washbubbles' own backend dev server, without touching
# an unrelated process that happens to be bound to the same port on this
# machine (another local project's dev server squats :3000 — see
# memory/env_port_3000_conflict.md). Only kills a process whose cwd is
# exactly this repo's backend/ directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"

for pid in $(lsof -ti:3000 2>/dev/null || true); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | awk '/^n/{print substr($0, 2)}')
  if [ "$cwd" = "$BACKEND_DIR" ]; then
    kill -9 "$pid"
    echo "Killed washbubbles backend process on port 3000 (pid $pid)"
  fi
done

exit 0
