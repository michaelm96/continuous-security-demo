#!/usr/bin/env bash
set -euo pipefail

PSQL="/Applications/Postgres.app/Contents/Versions/latest/bin/psql"
DBNAME="${DBNAME:-continuous_security_demo}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG_DIR="$HERE/../../../supabase/migrations"

export PGHOST="${PGHOST:-/tmp}"
export PGUSER="${PGUSER:-$(whoami)}"   # Postgres.app defaults to current macOS user

cmd="${1:-setup}"

case "$cmd" in
  setup)
    # 1. Create database if missing (connect to default 'postgres' db first)
    EXISTS=$("$PSQL" -d postgres -tAc "select 1 from pg_database where datname='$DBNAME'" || true)
    if [ "$EXISTS" != "1" ]; then
      "$PSQL" -d postgres -c "create database $DBNAME"
    fi

    # 2. Apply auth stub (always idempotent)
    "$PSQL" -d "$DBNAME" -v ON_ERROR_STOP=1 -f "$HERE/sql/000_auth_stub.sql"

    # 3. Apply migrations
    for f in "$MIG_DIR"/*.sql; do
      [ -e "$f" ] || continue
      "$PSQL" -d "$DBNAME" -v ON_ERROR_STOP=1 -f "$f"
    done
    ;;

  reset)
    EXISTS=$("$PSQL" -d postgres -tAc "select 1 from pg_database where datname='$DBNAME'" || true)
    if [ "$EXISTS" = "1" ]; then
      "$PSQL" -d postgres -c "drop database $DBNAME"
    fi
    "$PSQL" -d postgres -c "create database $DBNAME"
    "$PSQL" -d "$DBNAME" -v ON_ERROR_STOP=1 -f "$HERE/sql/000_auth_stub.sql"
    for f in "$MIG_DIR"/*.sql; do
      [ -e "$f" ] || continue
      "$PSQL" -d "$DBNAME" -v ON_ERROR_STOP=1 -f "$f"
    done
    ;;

  psql)
    "$PSQL" -d "$DBNAME" "${@:2}"
    ;;

  *)
    echo "usage: $0 [setup|reset|psql <args>]" >&2
    exit 64
    ;;
esac