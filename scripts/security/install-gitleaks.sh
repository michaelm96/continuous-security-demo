#!/usr/bin/env bash
#
# install-gitleaks.sh — checksum-verified installer for Gitleaks 8.30.1 (linux/x64).
#
# Usage: install-gitleaks.sh [install-dir]
#
# Defaults <install-dir> to "$HOME/.local/bin". The archive URL is pinned to
# the exact immutable GitHub release; the SHA-256 is verified with sha256sum
# before any extraction. No pipe-to-shell invocation, no mutable release refs.
#
set -euo pipefail

VERSION="8.30.1"
EXPECTED_SHA="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
URL="https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz"
INSTALL_DIR="${1:-$HOME/.local/bin}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  -o "$work/gitleaks_8.30.1_linux_x64.tar.gz" "$URL"

echo "${EXPECTED_SHA}  ${work}/gitleaks_8.30.1_linux_x64.tar.gz" | sha256sum -c -

tar -xzf "$work/gitleaks_8.30.1_linux_x64.tar.gz" -C "$work" gitleaks

mkdir -p "$INSTALL_DIR"
install -m 0755 "$work/gitleaks" "$INSTALL_DIR/gitleaks"

"$INSTALL_DIR/gitleaks" version