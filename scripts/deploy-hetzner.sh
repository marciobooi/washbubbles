#!/bin/sh
# Run on the Hetzner server by the GitHub Action (forced command of its ssh key): pull main and rebuild.
set -e
cd /opt/washbubbles
git pull --ff-only
docker compose --env-file .env.docker up -d --build backend frontend
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null https://freshbubbles.pt/api/health; then echo "deployed $(git rev-parse --short HEAD): healthy"; exit 0; fi
  sleep 5
done
echo "deployed $(git rev-parse --short HEAD) but the health check failed" >&2
exit 1
