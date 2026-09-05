#!/usr/bin/env bash
#
# update.sh — upgrade an already-registered install.
#
#   scripts/update.sh /path/to/immich-plugins
#   VERSION=v0.2.1 DB_CONTAINER=immich_postgres scripts/update.sh /path/to/plugins
#
# ── Why this is not just "copy the new files" ──
#
# Immich cannot upgrade an external plugin in place, and fails quietly at it:
#
#   - same version, new files  -> import skipped (deduplicated on manifest hash)
#   - new version              -> INSERT dies on the plugin_name_uq unique
#                                 constraint, because the upsert targets
#                                 ON CONFLICT (name, version). One WARN at boot,
#                                 and the OLD version keeps running.
#
# The only way through is to delete the plugin row first. That cascades
# plugin -> plugin_method -> workflow_step, so every user's workflow loses its
# step. The workflow row survives, empty.
#
# This script does that deliberately and tells you what it costs. It asks before
# touching the database; pass --yes to skip the prompt in automation.
#
# Run it ON THE DOCKER HOST: it reaches the database with `docker exec`, and the
# plugins folder argument is a host path, not a path inside the container.
set -euo pipefail

NAME=immich-plugin-no-exif-date-fallback
DB_CONTAINER="${DB_CONTAINER:-immich_postgres}"
DB_USER="${DB_USER:-immich}"
DB_NAME="${DB_NAME:-immich}"
ASSUME_YES=0

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '  %s\n' "$*"; }

DEST=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    *) DEST="$arg" ;;
  esac
done
[ -n "$DEST" ] || die "usage: $0 [--yes] <plugins-folder>"
command -v docker >/dev/null || die "docker is required to reach the Immich database"

docker exec "$DB_CONTAINER" true 2>/dev/null \
  || die "no running container named '$DB_CONTAINER' — set DB_CONTAINER to your Immich Postgres container"

psql() { docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c "$1"; }

CURRENT="$(psql "select version from plugin where name='$NAME';" || true)"
[ -n "$CURRENT" ] || die "$NAME is not registered — this is a first install, use install.sh"
info "currently registered: $NAME v$CURRENT"

# Name the cost before incurring it: these are the workflows that will be emptied.
AFFECTED="$(psql "select w.\"ownerId\" || '  ' || coalesce(w.name,'(unnamed)')
  from workflow w join workflow_step s on s.\"workflowId\" = w.id
  join plugin_method m on m.id = s.\"pluginMethodId\"
  join plugin p on p.id = m.\"pluginId\" where p.name='$NAME';" || true)"

if [ -n "$AFFECTED" ]; then
  printf '\n\033[33mThese workflows will lose their step and must be re-enabled afterwards:\033[0m\n'
  printf '%s\n' "$AFFECTED" | sed 's/^/    /'
fi

if [ "$ASSUME_YES" != 1 ]; then
  printf '\nRemove the plugin row and reinstall? [y/N] '
  read -r reply
  case "$reply" in [yY]*) ;; *) die "aborted — nothing was changed" ;; esac
fi

# Files first: if the download fails we have not broken a working install.
VERSION="${VERSION:-latest}" "$(dirname "$0")/install.sh" "$DEST" >/dev/null \
  || die "install step failed — the database was NOT touched"
info "new files in place"

psql "delete from plugin where name='$NAME';" >/dev/null
info "plugin row removed (workflow steps cascaded)"

cat <<EOF

$(printf '\033[32m✓ ready\033[0m') — now restart Immich so it imports the new version:

    docker compose restart immich-server
    docker compose logs immich-server | grep -i 'loaded plugin'

Then, for each account that had it enabled, delete the now-empty workflow in the
UI at /workflows and run:

    IMMICH_URL=… IMMICH_API_KEY=… node scripts/enable.mjs
EOF
