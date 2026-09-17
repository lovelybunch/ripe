#!/usr/bin/env bash
# Packages each bundled skill as a .skill (a zip with the skill folder at the
# top level — the shape Claude's skill upload expects) plus a plain .zip twin.
# Output lands in packages/, which ships in the npm tarball so the files are
# reachable from a public CDN without any hosting of our own:
#   https://cdn.jsdelivr.net/npm/ripeness/packages/<skill>.skill
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf packages && mkdir -p packages
for dir in skills/*/; do
  name=$(basename "$dir")
  ( cd skills && zip -qr "../packages/$name.skill" "$name" -x '*.DS_Store' )
  cp "packages/$name.skill" "packages/$name.zip"
  echo "packages/$name.skill  ($(du -h "packages/$name.skill" | cut -f1 | tr -d ' '))"
done
