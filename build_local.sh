#!/bin/sh
# Build the playground against the locally-built user-defined-primitives js.wasm.
#
# Set GECKO to your Gecko checkout if it isn't the default below. The wasm is
# produced by: MOZCONFIG=mozconfig-wasi ./mach build  (see mozconfig-wasi).
#
# Output goes to docs/, which GitHub Pages serves directly (main, /docs).
set -e

GECKO="${GECKO:-/Volumes/CSData/firefox_primitives}"
WASM="$GECKO/obj-wasi/dist/bin/js"

if [ ! -f "$WASM" ]; then
  echo "error: $WASM not found; build the WASI shell first." >&2
  exit 1
fi

cp "$WASM" ./js.wasm
echo "Copied js.wasm ($(du -h ./js.wasm | cut -f1))"

# webpack emits the site (including js.wasm and .nojekyll) into docs/.
npm run build

echo
echo "Built into docs/. Preview locally with:"
echo "    (cd docs && python3 -m http.server)"
echo "Deploy by committing docs/ and pushing; GitHub Pages serves main /docs."
