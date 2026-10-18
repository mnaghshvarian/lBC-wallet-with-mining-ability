#!/usr/bin/env bash
# Builds btcd — a Bitcoin full node (https://github.com/btcsuite/btcd), the
# project lbcd is forked from — for the atomic swap tests. It plays the Bitcoin
# side of a swap on a local regtest network. Test-only: it is never bundled
# with the app.
#
#   scripts/build-btcd.sh     # → .tools/btcd/btcd (or btcd.exe)
#
# Like scripts/build-lbcd.sh, the source is the published release, fetched
# through the Go module proxy and checked against the hash pinned below (the
# value recorded in sum.golang.org). btcd needs Go 1.25: the go command fetches
# exactly that release if this computer's Go differs (also through the module
# proxy, checked against sum.golang.org), even where GOTOOLCHAIN=local is set
# (as GitHub's setup-go does). Needs Go 1.21 or newer to start.
set -euo pipefail

export GOTOOLCHAIN=go1.25.0+auto

BTCD_MODULE=github.com/btcsuite/btcd
BTCD_VERSION=v0.26.2
BTCD_SUM='h1:hPXzICjUZOsW2JwBLg9nHwGabc/D7pJDlna2vTB/SWI='

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/.tools/btcd"

info="$(GOFLAGS=-mod=mod go mod download -json "$BTCD_MODULE@$BTCD_VERSION")"
src="$(printf '%s' "$info" | sed -n 's/^[[:space:]]*"Dir": "\(.*\)",$/\1/p' | sed 's/\\\\/\\/g')"
sum="$(printf '%s' "$info" | sed -n 's/^[[:space:]]*"Sum": "\(.*\)",$/\1/p')"
if [ "$sum" != "$BTCD_SUM" ]; then
  echo "btcd source hash mismatch: got '$sum', expected '$BTCD_SUM'" >&2
  exit 1
fi
echo "btcd $BTCD_VERSION source verified ($sum)"

exe=btcd
[ "$(go env GOOS)" = windows ] && exe=btcd.exe
mkdir -p "$dest"
(
  cd "$src"
  CGO_ENABLED=0 GOFLAGS=-mod=readonly go build -trimpath -buildvcs=false -ldflags "-s -w -buildid=" -o "$dest/$exe" .
)
echo "built $dest/$exe"
