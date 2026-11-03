#!/bin/sh
# Fails when the screen's source uses a name that is not defined or imported (what blanked the kiosk on 2026-10-23).
# Uses a throw-away install of eslint, so the project's own packages (and the shop PCs' npm install) are untouched.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/../../src" && pwd)"
DIR="${TMPDIR:-/tmp}/wb-check"
mkdir -p "$DIR"
( cd "$DIR" && { [ -x node_modules/.bin/eslint ] || npm install --silent --no-audit --no-fund eslint@9 eslint-plugin-react globals >/dev/null; } )
cp "$HERE/eslint.config.mjs" "$DIR/eslint.config.mjs"
rm -rf "$DIR/src" && mkdir -p "$DIR/src" && cp -R "$SRC/." "$DIR/src/"
( cd "$DIR" && ./node_modules/.bin/eslint -c eslint.config.mjs --no-warn-ignored src )
echo "frontend: no undefined names"
