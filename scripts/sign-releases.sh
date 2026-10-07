#!/bin/bash
# Sign Release files for every mirrored host that has a GPG key in keys.json.
# Called from mirror-sync.sh after every apt-mirror run, on demand from the admin UI
# (single-host mode via $1), and by apt-mirror-signed.py for each repository's new
# dists folder as apt-mirror2 publishes it (`--dir <path>`, signs only what our key
# has not signed yet).
# The upstream InRelease / Release.gpg are kept as *.upstream; `--restore <host>`
# puts them back (used before the host's key is deleted).

set -u

# One signing run at a time (the sync and the admin UI can both start one). flock -o holds the
# lock in the flock process only, so a gpg-agent started by gpg cannot inherit and keep it.
LOCK_FILE="${SIGN_RELEASES_LOCK:-/var/run/sign-releases.lock}"
if [ -z "${SIGN_RELEASES_LOCKED:-}" ] && command -v flock >/dev/null 2>&1 \
        && touch "$LOCK_FILE" 2>/dev/null; then
    SIGN_RELEASES_LOCKED=1 exec flock -o -w 600 "$LOCK_FILE" "$0" "$@"
fi

GPG_HOME="${GNUPG_HOME:-/var/spool/apt-mirror/gpg/gnupg}"
KEYS_INDEX="${GPG_KEYS_INDEX:-/var/spool/apt-mirror/gpg/keys.json}"
MIRROR_ROOT="${MIRROR_ROOT:-/var/spool/apt-mirror/mirror}"
LOG="${SIGN_RELEASES_LOG:-/var/log/apt-mirror/sign-releases.log}"

mkdir -p "$(dirname "$LOG")"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

if [ ! -f "$KEYS_INDEX" ]; then
    [ "${1:-}" = "--dir" ] && exit 0
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

# Suite-level Release files under a directory. apt reads InRelease / Release.gpg only next to
# these, not next to the per-component Release files (binary-*/, source/).
release_files() {
    find "$1" -type f -name Release ! -path '*/binary-*/Release' ! -path '*/source/Release' 2>/dev/null
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

# Sign one suite's Release file. Signatures that are not ours came from upstream (a fresh
# sync); they are kept as *.upstream for --restore.
sign_release() {
    local release_file="$1" fingerprint="$2"
    local dist_dir f
    dist_dir=$(dirname "$release_file")

    if ! signed_by "$dist_dir" "$fingerprint"; then
        for f in InRelease Release.gpg; do
            rm -f "$dist_dir/$f.upstream"
            [ -f "$dist_dir/$f" ] && cp -p "$dist_dir/$f" "$dist_dir/$f.upstream"
        done
    fi

    # Signed next to the final names, then renamed over them: a client never sees a missing file.
    rm -f "$dist_dir/Release.gpg.new" "$dist_dir/InRelease.new"
    if ! gpg --batch --yes --pinentry-mode loopback --passphrase '' \
            --local-user "$fingerprint" --armor --detach-sign \
            --output "$dist_dir/Release.gpg.new" "$release_file" 2>>"$LOG"; then
        log "ERROR: detached sign failed for $release_file"
        rm -f "$dist_dir/Release.gpg.new"
        return 1
    fi
    if ! gpg --batch --yes --pinentry-mode loopback --passphrase '' \
            --local-user "$fingerprint" --clearsign \
            --output "$dist_dir/InRelease.new" "$release_file" 2>>"$LOG"; then
        log "ERROR: clearsign failed for $release_file"
        rm -f "$dist_dir/Release.gpg.new" "$dist_dir/InRelease.new"
        return 1
    fi
    mv -f "$dist_dir/Release.gpg.new" "$dist_dir/Release.gpg"
    mv -f "$dist_dir/InRelease.new" "$dist_dir/InRelease"
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

    local count=0 release_file
    while IFS= read -r release_file; do
        [ -z "$release_file" ] && continue
        case "$release_file" in */dists/*) ;; *) continue ;; esac
        sign_release "$release_file" "$fingerprint" && count=$((count + 1))
    done < <(release_files "$host_root")

    log "Signed $count Release file(s) for host '$host' with $fingerprint."
}

# Sign the Release files under one directory of the mirror (a repository's dists folder,
# possibly not yet published) that our key has not signed yet.
sign_dir() {
    local dir root rel host fingerprint
    dir=$(realpath -e "$1" 2>/dev/null) || return 0
    root=$(realpath -e "$MIRROR_ROOT" 2>/dev/null) || return 0
    case "$dir" in "$root"/?*) ;; *) log "Not under $MIRROR_ROOT: $1, skipping."; return 0 ;; esac
    rel=${dir#"$root"/}
    host=${rel%%/*}
    fingerprint=$(host_fingerprint "$host")
    [ -n "$fingerprint" ] || return 0

    local count=0 release_file
    while IFS= read -r release_file; do
        [ -z "$release_file" ] && continue
        signed_by "$(dirname "$release_file")" "$fingerprint" && continue
        sign_release "$release_file" "$fingerprint" && count=$((count + 1))
    done < <(release_files "$dir")

    [ "$count" -gt 0 ] && log "Signed $count Release file(s) in $dir with $fingerprint."
    return 0
}

if [ "${1:-}" = "--dir" ]; then
    [ -n "${2:-}" ] || { echo "Usage: $0 --dir <path>" >&2; exit 1; }
    sign_dir "$2"
    exit 0
fi

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
