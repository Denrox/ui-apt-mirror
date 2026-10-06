#!/bin/bash
# Sign Release files for every mirrored host that has a GPG key in keys.json.
# Called from mirror-sync.sh after a successful apt-mirror run, and on demand
# from the admin UI (single-host mode via $1).
# The upstream InRelease / Release.gpg are kept as *.upstream; `--restore <host>`
# puts them back (used before the host's key is deleted).

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

# Whether a dists/ directory's signatures were made with the given key.
signed_by() {
    local dist_dir="$1" fingerprint="$2" status
    if [ -f "$dist_dir/InRelease" ]; then
        status=$(gpg --batch --status-fd 1 --verify "$dist_dir/InRelease" 2>/dev/null)
    elif [ -f "$dist_dir/Release.gpg" ]; then
        status=$(gpg --batch --status-fd 1 --verify "$dist_dir/Release.gpg" "$dist_dir/Release" 2>/dev/null)
    else
        return 1
    fi
    grep -q "^\[GNUPG:\] VALIDSIG .*$fingerprint" <<< "$status"
}

host_fingerprint() {
    jq -r --arg h "$1" '.[$h].fingerprint // empty' "$KEYS_INDEX"
}

restore_host() {
    local host="$1"
    local fingerprint
    fingerprint=$(host_fingerprint "$host")
    if [ -z "$fingerprint" ] || [ ! -d "$MIRROR_ROOT/$host" ]; then
        return 0
    fi

    local count=0
    while IFS= read -r release_file; do
        [ -z "$release_file" ] && continue
        local dist_dir f
        dist_dir=$(dirname "$release_file")
        if signed_by "$dist_dir" "$fingerprint"; then
            for f in InRelease Release.gpg; do
                if [ -f "$dist_dir/$f.upstream" ]; then
                    mv -f "$dist_dir/$f.upstream" "$dist_dir/$f"
                else
                    rm -f "$dist_dir/$f"
                fi
            done
            count=$((count + 1))
        else
            rm -f "$dist_dir/InRelease.upstream" "$dist_dir/Release.gpg.upstream"
        fi
    done < <(find "$MIRROR_ROOT/$host" -type f -name Release -path '*/dists/*' 2>/dev/null)

    log "Restored upstream signatures of $count Release file(s) for host '$host'."
}

sign_host() {
    local host="$1"
    local fingerprint
    fingerprint=$(host_fingerprint "$host")
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

        # Signatures that are not ours came from upstream (a fresh sync); keep them for --restore.
        if ! signed_by "$dist_dir" "$fingerprint"; then
            local f
            for f in InRelease Release.gpg; do
                rm -f "$dist_dir/$f.upstream"
                [ -f "$dist_dir/$f" ] && cp -p "$dist_dir/$f" "$dist_dir/$f.upstream"
            done
        fi
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

if [ "${1:-}" = "--restore" ]; then
    [ -n "${2:-}" ] || { echo "Usage: $0 --restore <host>" >&2; exit 1; }
    restore_host "$2"
    exit 0
fi

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
