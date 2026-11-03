#!/bin/sh
# Hetzner: keep release/app.zip + release/version.txt in step with the checked-out commit (cron, every minute, see
# /etc/cron.d/washbubbles-release). Shop PCs install and update from it (backend/src/routes/installer.js).
# Separate from hetzner-autodeploy.sh on purpose: that script is rewritten by the very update it is running.
cd /opt/washbubbles || exit 1
head=$(git rev-parse HEAD) || exit 1
[ "$(cat release/version.txt 2>/dev/null)" = "$head" ] && exit 0
# only once the site answers with this version (the deploy rebuilds first)
curl -fsS -o /dev/null https://freshbubbles.pt/api/health || exit 0
mkdir -p release || exit 1
git archive --format=zip -o release/app.zip.tmp HEAD -- . ':!graft' ':!docs' ':!pos-client' || exit 1
mv release/app.zip.tmp release/app.zip
echo "$head" > release/version.txt.tmp && mv release/version.txt.tmp release/version.txt
echo "[$(date '+%F %T')] release published at $(echo "$head" | cut -c1-7)"
