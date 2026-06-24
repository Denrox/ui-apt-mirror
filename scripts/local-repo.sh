#!/bin/bash
# Generate APT repository metadata for a locally hosted repo (uploaded .deb
# packages, not mirrored from upstream).
#
# Layout produced under <repoDir>:
#   pool/<component>/*.deb
#   dists/<suite>/<component>/binary-<arch>/Packages(.gz)
#   dists/<suite>/Release
#
# Release signing is handled separately by sign-releases.sh (reusing the
# existing per-host GPG flow), so this script only (re)builds the indexes.
#
# Usage:
#   local-repo.sh publish <repoDir> <suite> "<components>" "<arches>" [origin] [label]

set -u

LOG="/var/log/apt-mirror/local-repo.log"
# Fall back to /dev/null if the log location is not writable, so that the
# `2>>"$LOG"` redirects below never abort the metadata commands.
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
if ! { : >> "$LOG"; } 2>/dev/null; then
    LOG="/dev/null"
fi
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG" >&2; }

cmd="${1:-}"
if [ "$cmd" != "publish" ]; then
    echo "Usage: $0 publish <repoDir> <suite> <components> <arches> [origin] [label]" >&2
    exit 1
fi

repoDir="${2:?repoDir required}"
suite="${3:?suite required}"
components="${4:?components required}"
arches="${5:?arches required}"
origin="${6:-Local Repository}"
label="${7:-$origin}"

if ! command -v dpkg-scanpackages >/dev/null 2>&1; then
    log "ERROR: dpkg-scanpackages not found (install dpkg-dev)"
    exit 2
fi
if ! command -v apt-ftparchive >/dev/null 2>&1; then
    log "ERROR: apt-ftparchive not found (install apt-utils)"
    exit 2
fi
if [ ! -d "$repoDir" ]; then
    log "ERROR: repo directory $repoDir does not exist"
    exit 1
fi

cd "$repoDir" || exit 1
distDir="dists/$suite"

# Rebuild a per-component, per-architecture Packages index. dpkg-scanpackages
# --arch keeps packages of that architecture plus Architecture: all.
for comp in $components; do
    poolComp="pool/$comp"
    mkdir -p "$poolComp"
    for arch in $arches; do
        binDir="$distDir/$comp/binary-$arch"
        mkdir -p "$binDir"
        if dpkg-scanpackages --arch "$arch" "$poolComp" /dev/null \
                > "$binDir/Packages" 2>>"$LOG"; then
            :
        else
            log "WARN: dpkg-scanpackages produced no output for $comp/$arch"
            : > "$binDir/Packages"
        fi
        gzip -kf "$binDir/Packages"
    done
done

# Build the suite Release file (computes checksums of all indexes beneath it).
releaseTmp="$distDir/Release.tmp"
if apt-ftparchive \
        -o "APT::FTPArchive::Release::Origin=$origin" \
        -o "APT::FTPArchive::Release::Label=$label" \
        -o "APT::FTPArchive::Release::Suite=$suite" \
        -o "APT::FTPArchive::Release::Codename=$suite" \
        -o "APT::FTPArchive::Release::Components=$components" \
        -o "APT::FTPArchive::Release::Architectures=$arches" \
        release "$distDir" > "$releaseTmp" 2>>"$LOG"; then
    mv -f "$releaseTmp" "$distDir/Release"
else
    log "ERROR: apt-ftparchive release failed for $repoDir"
    rm -f "$releaseTmp"
    exit 1
fi

# Drop stale signatures; the signer recreates them if a key is registered.
rm -f "$distDir/Release.gpg" "$distDir/InRelease"

log "Published $repoDir (suite=$suite components=[$components] arches=[$arches])"
exit 0
