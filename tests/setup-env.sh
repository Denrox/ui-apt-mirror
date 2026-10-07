#!/bin/bash
# Tests for setup.sh's .env handling: a fresh install writes the documented file;
# upgrades and --reconfigure change only setup.sh's own keys and keep every other
# line, and the file's mode. Run from anywhere in a clone: tests/setup-env.sh
set -uo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0
passes=0

ok() { passes=$((passes + 1)); }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok; else fail "$1"; fi; }

# shellcheck source=../setup.sh
. "$repo/setup.sh" --lib
set +e

# Runs write_env_file in a new install dir $1 as setup.sh would: "upgrade" keeps the
# current settings; "set" uses the values given as KEY=VALUE arguments after it.
run_setup() {
    local dir=$1 mode=$2
    shift 2
    (
        cd "$dir" || exit 1
        load_existing_config
        use_current_config
        if [ "$mode" = set ]; then
            local kv
            for kv in "$@"; do declare "$kv"; done
        fi
        write_env_file
    ) > "$dir/log" 2>&1 || fail "$dir: write_env_file exited $?: $(cat "$dir/log")"
}

new_dir() { mkdir -p "$work/$1"; echo "$work/$1"; }

# 1. Fresh install: the documented header and the four settings
d=$(new_dir fresh)
run_setup "$d" set MIRROR_DOMAIN=f.test SYNC_FREQUENCY=7200 HOST_TIMEZONE=Europe/Berlin ENABLE_NPM_PROXY=n
cat > "$d/expected" <<'ENV'
# ui-apt-mirror settings. Change with ./setup.sh --reconfigure, or edit and run ./start.sh.
# The admin, files, npm and cheatsheets hosts are subdomains of MIRROR_DOMAIN.
MIRROR_DOMAIN=f.test
SYNC_FREQUENCY=7200
NPM_PROXY_ENABLED=false
TZ=Europe/Berlin
ENV
check "fresh: documented .env written" 'cmp -s "$d/expected" "$d/.env"'

# An install's .env with the admin's own lines, a key changed by hand
# (SYNC_FREQUENCY), and mode 640
admin_env() {
    cat > "$1/.env" <<'ENV'
# ui-apt-mirror settings. Change with ./setup.sh --reconfigure, or edit and run ./start.sh.
# The admin, files, npm and cheatsheets hosts are subdomains of MIRROR_DOMAIN.
COMPOSE_PROJECT_NAME=mirror
MIRROR_DOMAIN=e.test
SYNC_FREQUENCY=3600
NPM_PROXY_ENABLED=true
TZ=UTC
# Added by the admin (r3 upgrade test): used by docker-compose.override.yml
R3_UPGRADE_VAR=keepme
ENV
    chmod 640 "$1/.env"
    cp -p "$1/.env" "$1/before"
}

# 2. Upgrade: nothing changes, not even the file's inode or mode
d=$(new_dir upgrade)
admin_env "$d"
inode=$(stat -c %i "$d/.env")
run_setup "$d" upgrade
check "upgrade: .env byte-identical" 'cmp -s "$d/before" "$d/.env"'
check "upgrade: custom variable kept" 'grep -qx R3_UPGRADE_VAR=keepme "$d/.env"'
check "upgrade: comment kept" 'grep -qx "# Added by the admin (r3 upgrade test): used by docker-compose.override.yml" "$d/.env"'
check "upgrade: hand-changed key kept" 'grep -qx SYNC_FREQUENCY=3600 "$d/.env"'
check "upgrade: same file" '[ "$(stat -c %i "$d/.env")" = "$inode" ]'
check "upgrade: mode kept" '[ "$(stat -c %a "$d/.env")" = 640 ]'
check "upgrade: says nothing changed" 'grep -q "up to date" "$d/log"'

# 3. Reconfigure: changed keys are updated in place, everything else stays
d=$(new_dir reconfigure)
admin_env "$d"
run_setup "$d" set MIRROR_DOMAIN='n&w\1.test' HOST_TIMEZONE=America/Argentina/Buenos_Aires ENABLE_NPM_PROXY=n
sed -e 's/^MIRROR_DOMAIN=.*/MIRROR_DOMAIN=n\&w\\1.test/' -e 's|^TZ=.*|TZ=America/Argentina/Buenos_Aires|' \
    -e 's/^NPM_PROXY_ENABLED=.*/NPM_PROXY_ENABLED=false/' "$d/before" > "$d/expected"
check "reconfigure: only the changed keys differ, in place" 'cmp -s "$d/expected" "$d/.env"'
check "reconfigure: mode kept" '[ "$(stat -c %a "$d/.env")" = 640 ]'
check "reconfigure: no temporary file left" '[ -z "$(ls -A "$d" | grep "^\.env\.")" ]'

# 4. A key missing from .env is appended; a duplicate key is set everywhere it appears
d=$(new_dir missing-key)
admin_env "$d"
sed -i -e '/^TZ=/d' -e '$a MIRROR_DOMAIN=dup.test' "$d/.env"
printf 'NO_NEWLINE=1' >> "$d/.env"
run_setup "$d" set MIRROR_DOMAIN=m.test HOST_TIMEZONE=UTC
check "missing key: appended" '[ "$(tail -n 1 "$d/.env")" = TZ=UTC ]'
check "missing key: unterminated last line kept" 'grep -qx NO_NEWLINE=1 "$d/.env"'
check "missing key: every MIRROR_DOMAIN line set" '[ "$(grep -c "^MIRROR_DOMAIN=m.test$" "$d/.env")" = 2 ]'
check "missing key: admin lines kept" 'grep -qx R3_UPGRADE_VAR=keepme "$d/.env" && grep -qx COMPOSE_PROJECT_NAME=mirror "$d/.env"'
check "missing key: header kept once" '[ "$(grep -c "^# ui-apt-mirror settings" "$d/.env")" = 1 ]'

echo "$passes passed, $fails failed"
[ "$fails" -eq 0 ]
