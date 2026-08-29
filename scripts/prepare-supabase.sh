#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE="$ROOT/supabase/signing_keys.json"

validate_key_file() {
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    const keys = Array.isArray(parsed) ? parsed : [parsed];
    const valid = keys.length > 0 && keys.every((key) =>
      key?.kty === "EC" &&
      key.crv === "P-256" &&
      key.alg === "ES256" &&
      key.use === "sig" &&
      Array.isArray(key.key_ops) &&
      key.key_ops.includes("sign") &&
      key.key_ops.includes("verify") &&
      ["d", "x", "y", "kid"].every((field) =>
        typeof key[field] === "string" && key[field].length > 0,
      ),
    );
    if (!valid) process.exit(1);
    if (!Array.isArray(parsed)) {
      fs.writeFileSync(path, `${JSON.stringify(keys, null, 2)}\n`);
    }
    fs.chmodSync(path, 0o600);
  ' "$1"
}

if [ -s "$KEY_FILE" ]; then
  validate_key_file "$KEY_FILE"
  exit 0
fi

mkdir -p "$(dirname "$KEY_FILE")"
umask 077
TMP_FILE="$(mktemp "$ROOT/supabase/.signing_keys.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

(
  cd "${TMPDIR:-/tmp}"
  "$ROOT/node_modules/.bin/supabase" gen signing-key --algorithm ES256
) > "$TMP_FILE"
validate_key_file "$TMP_FILE"
mv "$TMP_FILE" "$KEY_FILE"
trap - EXIT
