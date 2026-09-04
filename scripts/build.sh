#!/usr/bin/env bash
#
# scripts/build.sh — package the extension into a shippable folder + zip.
#
# The extension is plain vanilla JS loaded via <script src> tags, so the source
# IS the runtime — there is no bundler. This copies ONLY the files the extension
# actually needs (manifest.json + the HTML <script> tags) into dist/, leaving
# behind tests, design docs, node_modules, and dev tooling.
#
# Run:  ./scripts/build.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

# Runtime files only — derived from manifest.json + options.html/popup.html.
FILES=(
 "manifest.json"
 "background.js"
 "content.js"
 "lib/rules.js"
 "cc-rule-row.js"
 "storage.js"
 "options.js"
 "options.html"
 "popup.js"
 "popup.html"
 "popup.css"
 "contentcensor48.png"
 "contentcensor128.png"
)

rm -rf "$DIST"
mkdir -p "$DIST"

for f in "${FILES[@]}"; do
 if [ ! -e "$ROOT/$f" ]; then
  echo "✘ missing $f" >&2
  exit 1
 fi
 mkdir -p "$DIST/$(dirname "$f")"
 cp "$ROOT/$f" "$DIST/$f"
 echo "✔ copied $f"
done

# Version comes from the manifest we just copied.
VER="$(node -e "process.stdout.write(require('$DIST/manifest.json').version||'dev')" 2>/dev/null || echo dev)"
OUT="$ROOT/contentcensor-$VER.zip"

if command -v zip >/dev/null 2>&1; then
 # Zip the contents from inside DIST so the archive keeps its own structure,
 # and keep the archive in ROOT so it is never included in itself.
 ( cd "$DIST" && zip -r -q "$OUT" . )
 echo "✔ $(basename "$OUT") (${#FILES[@]} files)"
else
 echo "⚠  'zip' not found — wrote the dist/ folder only; zip it yourself."
fi

echo
echo "Build complete → ${DIST#$ROOT/}"
