#!/usr/bin/env bash
# Packages each bundled skill as a .skill (a zip with the skill folder at the
# top level — the shape Claude's skill upload expects) plus a plain .zip twin.
# Output lands in packages/ (shipped in the npm tarball, served via jsDelivr)
# and a copy sits inside each skill folder for a one-click download.
#
# Deterministic: files are staged with a fixed mtime and zipped without extra
# attributes, so the same content always yields the same bytes. These archives
# are committed, and a build that churns them on every run would make every
# commit noisy and every diff meaningless.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf packages && mkdir -p packages
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
for dir in skills/*/; do
  name=$(basename "$dir")
  rm -rf "$STAGE/$name" && mkdir -p "$STAGE/$name"
  # tar is the portable way to copy a tree with excludes (cp --parents is GNU-only).
  ( cd "skills/$name" && tar --exclude='*.zip' --exclude='*.skill' --exclude='.DS_Store' -cf - . ) \
    | ( cd "$STAGE/$name" && tar -xf - )
  find "$STAGE/$name" -exec touch -t 200001010000 {} +
  ( cd "$STAGE" && TZ=UTC zip -qrX -D "$OLDPWD/packages/$name.skill" "$name" )
  cp "packages/$name.skill" "packages/$name.zip"
  cp "packages/$name.skill" "skills/$name/$name.zip"
  echo "packages/$name.skill  ($(du -h "packages/$name.skill" | cut -f1 | tr -d ' '))"
done
