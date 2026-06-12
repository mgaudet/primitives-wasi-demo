#!/bin/sh
# Build the playground against the locally-built user-defined-primitives js.wasm.
#
# Set GECKO to your Gecko checkout if it isn't the default below. The wasm is
# produced by: MOZCONFIG=mozconfig-wasi ./mach build  (see mozconfig-wasi).
set -e

GECKO="${GECKO:-/Volumes/CSData/firefox_primitives}"
WASM="$GECKO/obj-wasi/dist/bin/js"

if [ ! -f "$WASM" ]; then
  echo "error: $WASM not found; build the WASI shell first." >&2
  exit 1
fi

cp "$WASM" ./js.wasm
echo "Copied js.wasm ($(du -h ./js.wasm | cut -f1))"

npm run build
cp ./js.wasm ./dist/js.wasm

echo
echo "Done. Serve the playground with:"
echo "    (cd dist && python3 -m http.server)"
echo "then open http://localhost:8000/"
