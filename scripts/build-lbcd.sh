#!/usr/bin/env bash
# Builds lbcd — LBRY's official full node (https://github.com/lbryio/lbcd) — from
# source, for bundling as the wallet's built-in node.
#
#   scripts/build-lbcd.sh                 # this computer's platform
#   scripts/build-lbcd.sh linux-x64 linux-arm64 mac-x64 mac-arm64 win-x64
#
# Output: apps/desktop/resources/bin/<os>-<arch>/lbcd[.exe] (os/arch named the way
# electron-builder's ${os}-${arch} macros name them). Needs Go 1.19 or newer.
#
# The source is the published release tag, fetched through the Go module proxy.
# Its hash is checked against the value pinned below (the same value recorded in
# the public Go checksum database, sum.golang.org), and lbcd's own go.sum pins
# every dependency. The binary is unmodified; only the version string is set,
# exactly as LBRY's release builds do.
set -euo pipefail

LBCD_MODULE=github.com/lbryio/lbcd
LBCD_VERSION=v0.22.119 # 2022-11-23, git commit a0ff51b84acc553c9e9568e80c7873c03e24d679
LBCD_SUM='h1:eWUUYDO0ilQzaHQIyAZywshTGmVIvK9WMl2fGMQ990I='

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_root="$root/apps/desktop/resources/bin"

host_target() {
  local os arch
  case "$(go env GOOS)" in
    linux) os=linux ;;
    darwin) os=mac ;;
    windows) os=win ;;
    *) echo "unsupported OS $(go env GOOS)" >&2; exit 1 ;;
  esac
  case "$(go env GOARCH)" in
    amd64) arch=x64 ;;
    arm64) arch=arm64 ;;
    *) echo "unsupported architecture $(go env GOARCH)" >&2; exit 1 ;;
  esac
  echo "$os-$arch"
}

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=("$(host_target)")

# Download (or reuse) the release source and check its hash.
info="$(GOFLAGS=-mod=mod go mod download -json "$LBCD_MODULE@$LBCD_VERSION")"
src="$(printf '%s' "$info" | sed -n 's/^[[:space:]]*"Dir": "\(.*\)",$/\1/p' | sed 's/\\\\/\\/g')"
sum="$(printf '%s' "$info" | sed -n 's/^[[:space:]]*"Sum": "\(.*\)",$/\1/p')"
if [ "$sum" != "$LBCD_SUM" ]; then
  echo "lbcd source hash mismatch: got '$sum', expected '$LBCD_SUM'" >&2
  exit 1
fi
echo "lbcd $LBCD_VERSION source verified ($sum)"

for target in "${targets[@]}"; do
  os="${target%-*}"
  arch="${target#*-}"
  case "$os" in
    linux) goos=linux; exe=lbcd ;;
    mac) goos=darwin; exe=lbcd ;;
    win) goos=windows; exe=lbcd.exe ;;
    *) echo "unknown target $target (use linux|mac|win-x64|arm64)" >&2; exit 1 ;;
  esac
  case "$arch" in
    x64) goarch=amd64 ;;
    arm64) goarch=arm64 ;;
    *) echo "unknown architecture in $target" >&2; exit 1 ;;
  esac
  dest="$out_root/$target"
  mkdir -p "$dest"
  (
    cd "$src"
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" GOFLAGS=-mod=readonly \
      go build -trimpath -buildvcs=false \
      -ldflags "-s -w -buildid= -X $LBCD_MODULE/version.appTag=$LBCD_VERSION" \
      -o "$dest/$exe" .
  )
  echo "built $dest/$exe"
done
