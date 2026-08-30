#!/usr/bin/env bash
#
# install-gitleaks.sh — checksum-verified installer for Gitleaks 8.30.1.
#
# Usage: install-gitleaks.sh [install-dir]
#
# Defaults <install-dir> to "$HOME/.local/bin". The archive URL is pinned to
# the exact immutable GitHub release for the host's platform; the SHA-256 is
# verified with sha256sum before any extraction. No pipe-to-shell invocation,
# no mutable release refs.
#
set -euo pipefail

VERSION="8.30.1"

# Per-platform SHA-256 of the upstream gitleaks_8.30.1_<platform>.tar.gz
# release archive. Computed against the immutable tag
# https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1.
declare -A SHA256=(
  [darwin_arm64]="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
  [darwin_x64]="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"
  [linux_arm64]="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
  [linux_x64]="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
)

uname_s="$(uname -s)"
uname_m="$(uname -m)"
case "${uname_s}:${uname_m}" in
  Darwin:arm64)  PLATFORM="darwin_arm64" ;;
  Darwin:x86_64) PLATFORM="darwin_x64" ;;
  Linux:aarch64) PLATFORM="linux_arm64" ;;
  Linux:x86_64)  PLATFORM="linux_x64" ;;
  *) echo "Unsupported platform: ${uname_s} ${uname_m}" >&2; exit 2 ;;
esac

EXPECTED_SHA="${SHA256[${PLATFORM}]}"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_${PLATFORM}.tar.gz"
INSTALL_DIR="${1:-$HOME/.local/bin}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  -o "$work/gitleaks.tar.gz" "$URL"

echo "${EXPECTED_SHA}  ${work}/gitleaks.tar.gz" | sha256sum -c -

tar -xzf "$work/gitleaks.tar.gz" -C "$work" gitleaks

mkdir -p "$INSTALL_DIR"
install -m 0755 "$work/gitleaks" "$INSTALL_DIR/gitleaks"

"$INSTALL_DIR/gitleaks" version
