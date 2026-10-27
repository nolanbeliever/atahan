#!/bin/sh
# Runs an in-page probe script (file) after starting singleplayer; prints its result.
cd "$(dirname "$0")/.." && timeout 300 node tools/shot.cjs probe "$(cat "$1")" 2>&1 | grep -v "GL Driver"
