#!/bin/bash
# Sign Release files for every mirrored host that has a GPG key in keys.json.
# Called from mirror-sync.sh after a successful apt-mirror run, and on demand
# from the admin UI (single-host mode via $1).

set -u

GPG_HOME="${GNUPG_HOME:-/var/spool/apt-mirror/gpg/gnupg}"
KEYS_INDEX="${GPG_KEYS_INDEX:-/var/spool/apt-mirror/gpg/keys.json}"
MIRROR_ROOT="${MIRROR_ROOT:-/var/spool/apt-mirror/mirror}"
LOG="/var/log/apt-mirror/sign-releases.log"

mkdir -p "$(dirname "$LOG")"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

if [ ! -f "$KEYS_INDEX" ]; then
    log "No keys index at $KEYS_INDEX — nothing to sign."
    exit 0
fi

export GNUPGHOME="$GPG_HOME"

sign_host() {
    local host="$1"
    local fingerprint
    fingerprint=$(jq -r --arg h "$host" '.[$h].fingerprint // empty' "$KEYS_INDEX")
    if [ -z "$fingerprint" ]; then
        log "No key registered for host '$host', skipping."
        return 0
    fi

    local host_root="$MIRROR_ROOT/$host"
    if [ ! -d "$host_root" ]; then
        log "Mirror root for '$host' not found at $host_root, skipping."
        return 0
    fi

    local count=0
    while IFS= read -r release_file; do
        [ -z "$release_file" ] && continue
        local dist_dir
        dist_dir=$(dirname "$release_file")

        rm -f "$dist_dir/Release.gpg" "$dist_dir/InRelease"

        if ! gpg --batch --yes --pinentry-mode loopback --passphrase '' \
                --local-user "$fingerprint" --armor --detach-sign \
                --output "$dist_dir/Release.gpg" "$release_file" 2>>"$LOG"; then
            log "ERROR: detached sign failed for $release_file"
            continue
        fi

        if ! gpg --batch --yes --pinentry-mode loopback --passphrase '' \
                --local-user "$fingerprint" --clearsign \
                --output "$dist_dir/InRelease" "$release_file" 2>>"$LOG"; then
            log "ERROR: clearsign failed for $release_file"
            continue
        fi

        count=$((count + 1))
    done < <(find "$host_root" -type f -name Release -path '*/dists/*' 2>/dev/null)

    log "Signed $count Release file(s) for host '$host' with $fingerprint."
}

if [ $# -ge 1 ] && [ -n "$1" ]; then
    sign_host "$1"
    exit 0
fi

hosts=$(jq -r 'keys[]' "$KEYS_INDEX" 2>/dev/null || true)
if [ -z "$hosts" ]; then
    log "Keys index is empty — nothing to sign."
    exit 0
fi

while IFS= read -r host; do
    [ -z "$host" ] && continue
    sign_host "$host"
done <<< "$hosts"
