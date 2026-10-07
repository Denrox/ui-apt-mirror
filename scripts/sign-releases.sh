#!/bin/bash
# Sign Release files for every mirrored host that has a GPG key in keys.json.
# Called from mirror-sync.sh after every apt-mirror run, on demand from the admin UI
# (single-host mode via $1), and by apt-mirror-signed.py for each repository's new
# dists folder as apt-mirror2 publishes it (`--dir <path>`, signs only what our key
# has not signed yet).
# The upstream InRelease / Release.gpg are saved before they are replaced, under
# $UPSTREAM_SIGNATURES_DIR (outside the mirror tree, where apt-mirror2's autoclean would
# delete them), keyed by the checksum of the Release file they sign. `--restore <host>` puts
# them back (used before the host's key is deleted).

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
SKEL_ROOT="${SKEL_ROOT:-$(dirname "$MIRROR_ROOT")/skel}"
UPSTREAM_SIGS="${UPSTREAM_SIGNATURES_DIR:-$(dirname "$KEYS_INDEX")/upstream-signatures}"
LOG="${SIGN_RELEASES_LOG:-/var/log/apt-mirror/sign-releases.log}"
# apt-mirror2 builds a repository's new metadata in `dists.apt_mirror_new` and then moves it to `dists`.
NEW_SUFFIX=".apt_mirror_new"

mkdir -p "$(dirname "$LOG")"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

if [ ! -f "$KEYS_INDEX" ]; then
    [ "${1:-}" = "--dir" ] && exit 0
    log "No keys index at $KEYS_INDEX — nothing to sign."
    exit 0
fi

export GNUPGHOME="$GPG_HOME"
ROOT_REAL=$(realpath -e "$MIRROR_ROOT" 2>/dev/null || echo "$MIRROR_ROOT")

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

# Mirror folder of a host.
host_roots() {
    [ -d "$ROOT_REAL/$1" ] && printf '%s\n' "$ROOT_REAL/$1"
}

# A dists folder's path below the mirror root as it is once published (dists.apt_mirror_new -> dists).
published_rel() {
    local rel=${1#"$ROOT_REAL"/}
    sed "s#${NEW_SUFFIX//./\\.}\(/\|\$\)#\1#g" <<< "$rel"
}

release_sum() {
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
}

# Upstream signatures of a dists folder are kept as $UPSTREAM_SIGS/<path>/<sha256 of Release>/.
backup_base() {
    echo "$UPSTREAM_SIGS/$(published_rel "$1")"
}

# Save the signatures next to a Release file before ours replace them. The two newest
# versions are kept: the new dists folder is signed just before apt-mirror2 publishes it.
save_upstream() {
    local dist_dir="$1" sum base target f
    sum=$(release_sum "$dist_dir/Release")
    [ -n "$sum" ] || return 0
    [ -f "$dist_dir/InRelease" ] || [ -f "$dist_dir/Release.gpg" ] || return 0
    base=$(backup_base "$dist_dir")
    target="$base/$sum"
    mkdir -p "$base" || return 1
    rm -rf "$target.tmp"
    mkdir -p "$target.tmp" || return 1
    for f in InRelease Release.gpg; do
        if [ -f "$dist_dir/$f" ] && ! cp -p "$dist_dir/$f" "$target.tmp/$f"; then
            rm -rf "$target.tmp"
            return 1
        fi
    done
    rm -rf "$target"
    mv "$target.tmp" "$target" || return 1
    touch "$target"
    # Keep this version and the newest other one.
    find "$base" -mindepth 1 -maxdepth 1 -type d ! -name "$sum" -printf '%T@ %p\n' 2>/dev/null \
        | sort -rn | tail -n +2 | cut -d' ' -f2- | while IFS= read -r old; do rm -rf "$old"; done
}

# Where the upstream signatures of a dists folder's current Release file are: the saved
# copy, else apt-mirror2's skel folder when it holds the same Release. Empty when neither.
upstream_source() {
    local dist_dir="$1" sum rel skel
    sum=$(release_sum "$dist_dir/Release")
    [ -n "$sum" ] || return 0
    local saved
    saved="$(backup_base "$dist_dir")/$sum"
    if [ -f "$saved/InRelease" ] || [ -f "$saved/Release.gpg" ]; then
        echo "$saved"
        return 0
    fi
    rel=$(published_rel "$dist_dir")
    skel="$SKEL_ROOT/$rel"
    if cmp -s "$skel/Release" "$dist_dir/Release" \
            && { [ -f "$skel/InRelease" ] || [ -f "$skel/Release.gpg" ]; }; then
        echo "$skel"
    fi
}

restore_host() {
    local host="$1"
    local fingerprint
    fingerprint=$(host_fingerprint "$host")
    [ -n "$fingerprint" ] || return 0

    local count=0 missing=0 host_root release_file dist_dir src f
    while IFS= read -r host_root; do
        [ -z "$host_root" ] && continue
        while IFS= read -r release_file; do
            [ -z "$release_file" ] && continue
            case "$release_file" in */dists/*) ;; *) continue ;; esac
            dist_dir=$(dirname "$release_file")
            signed_by "$dist_dir" "$fingerprint" || continue
            src=$(upstream_source "$dist_dir")
            if [ -z "$src" ]; then
                # Never remove a signature without a replacement: ours stays until the next sync.
                log "No upstream signature saved for $release_file; it stays signed with $fingerprint until the next sync."
                missing=$((missing + 1))
                continue
            fi
            for f in InRelease Release.gpg; do
                if [ -f "$src/$f" ]; then
                    cp -p "$src/$f" "$dist_dir/$f.restore" && mv -f "$dist_dir/$f.restore" "$dist_dir/$f"
                else
                    rm -f "$dist_dir/$f"
                fi
            done
            count=$((count + 1))
        done < <(release_files "$host_root")
    done < <(host_roots "$host")

    log "Restored upstream signatures of $count Release file(s) for host '$host'."
    [ "$missing" -gt 0 ] && log "Not restored: $missing Release file(s) for host '$host'."
    return 0
}

# Sign one suite's Release file. Signatures that are not ours came from upstream (a fresh
# sync); they are saved for --restore first.
sign_release() {
    local release_file="$1" fingerprint="$2"
    local dist_dir
    dist_dir=$(dirname "$release_file")

    if ! signed_by "$dist_dir" "$fingerprint"; then
        save_upstream "$dist_dir" || log "WARN: could not save the upstream signatures of $release_file"
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

    local roots
    roots=$(host_roots "$host")
    if [ -z "$roots" ]; then
        log "Mirror root for '$host' not found at $ROOT_REAL/$host, skipping."
        return 0
    fi

    local count=0 host_root release_file
    while IFS= read -r host_root; do
        while IFS= read -r release_file; do
            [ -z "$release_file" ] && continue
            case "$release_file" in */dists/*) ;; *) continue ;; esac
            sign_release "$release_file" "$fingerprint" && count=$((count + 1))
        done < <(release_files "$host_root")
    done <<< "$roots"

    log "Signed $count Release file(s) for host '$host' with $fingerprint."
}

# Sign the Release files under one directory of the mirror (a repository's dists folder,
# possibly not yet published) that our key has not signed yet.
sign_dir() {
    local dir rel host fingerprint
    dir=$(realpath -e "$1" 2>/dev/null) || return 0
    case "$dir" in "$ROOT_REAL"/?*) ;; *) log "Not under $MIRROR_ROOT: $1, skipping."; return 0 ;; esac
    rel=${dir#"$ROOT_REAL"/}
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
