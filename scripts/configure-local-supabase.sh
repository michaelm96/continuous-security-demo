#!/usr/bin/env bash
set -euo pipefail

project_id="continuous-security-demo"
container_id="$({
  docker ps \
    --filter "label=com.supabase.cli.project=${project_id}" \
    --format '{{.ID}} {{.Names}}' \
    | awk '$2 ~ /^supabase_db_/ { print $1 }'
} | head -n 1)"

if [[ -z "${container_id}" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi

# The Supabase CLI migration role cannot grant privileges on the platform-owned
# auth schema. Execute only the required grants and final function ACL using the
# database container's own administrator environment; no password is printed or
# persisted by this script.
docker exec -i "${container_id}" sh -ceu '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec psql --no-psqlrc --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
' <<'SQL'
grant usage on schema auth to public_refund_definer;
grant execute on function auth.uid() to public_refund_definer;

revoke all on function public.create_refund(uuid, bigint, char(3), text, text, uuid)
  from public, anon, service_role;
grant execute on function public.create_refund(uuid, bigint, char(3), text, text, uuid)
  to authenticated;

do $$
begin
  if not has_schema_privilege('public_refund_definer', 'auth', 'usage')
     or not has_function_privilege('public_refund_definer', 'auth.uid()', 'execute') then
    raise exception 'refund definer auth privileges are incomplete';
  end if;

  if has_function_privilege('anon', 'public.create_refund(uuid,bigint,character,text,text,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.create_refund(uuid,bigint,character,text,text,uuid)', 'execute')
     or has_function_privilege('service_role', 'public.create_refund(uuid,bigint,character,text,text,uuid)', 'execute') then
    raise exception 'create_refund execute ACL is not authenticated-only';
  end if;
end
$$;
SQL
