#!/bin/bash
# Regression tests for scripts/sign-releases.sh. Needs gpg, jq and flock, so run it in the image:
#   docker run --rm -v "$PWD":/src:ro --entrypoint bash ui-apt-mirror:<tag> /src/tests/sign-releases.test.sh
set -u

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGN="$SRC/scripts/sign-releases.sh"
WORK=$(mktemp -d)
trap 'gpgconf --homedir "$WORK/gnupg" --kill all 2>/dev/null; gpgconf --homedir "$WORK/upstream-gnupg" --kill all 2>/dev/null; rm -rf "$WORK"' EXIT

export GNUPG_HOME="$WORK/gnupg" GPG_KEYS_INDEX="$WORK/gpg/keys.json" MIRROR_ROOT="$WORK/mirror"
export SIGN_RELEASES_LOG="$WORK/sign.log" SIGN_RELEASES_LOCK="$WORK/sign.lock"
SKEL="$WORK/skel"
STORE="$WORK/gpg/upstream-signatures"
mkdir -p "$GNUPG_HOME" "$WORK/upstream-gnupg" "$WORK/gpg" "$MIRROR_ROOT" "$SKEL"
chmod 700 "$GNUPG_HOME" "$WORK/upstream-gnupg"

failures=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

new_key() { # homedir uid -> fingerprint
    gpg --homedir "$1" --batch --pinentry-mode loopback --passphrase '' --status-fd 1 \
        --quick-gen-key "$2" ed25519 sign never 2>/dev/null | awk '/KEY_CREATED/ {print $4}'
}
UPSTREAM_FPR=$(new_key "$WORK/upstream-gnupg" "upstream <up@example.org>")
OUR_FPR=$(new_key "$GNUPG_HOME" "apt-mirror+deb.example.org <apt-mirror+deb.example.org@mirror.intra>")
echo "{\"deb.example.org\": {\"fingerprint\": \"$OUR_FPR\"}}" > "$GPG_KEYS_INDEX"

# A suite as apt-mirror2 publishes it: skel holds the download, mirror hard links to it.
make_suite() { # <repo path below the mirror root> <suite> <text>
    local skel="$SKEL/$1/dists/$2" dist="$MIRROR_ROOT/$1/dists/$2"
    mkdir -p "$skel/main/binary-amd64" "$dist/main/binary-amd64"
    printf 'Origin: test\nSuite: %s\nDescription: %s\n' "$2" "$3" > "$skel/Release"
    gpg --homedir "$WORK/upstream-gnupg" --batch --yes --clearsign -u "$UPSTREAM_FPR" -o "$skel/InRelease" "$skel/Release" 2>/dev/null
    gpg --homedir "$WORK/upstream-gnupg" --batch --yes --armor --detach-sign -u "$UPSTREAM_FPR" -o "$skel/Release.gpg" "$skel/Release" 2>/dev/null
    printf 'Component: main\n' > "$skel/main/binary-amd64/Release"
    local f
    for f in Release InRelease Release.gpg main/binary-amd64/Release; do
        rm -f "$dist/$f"
        ln "$skel/$f" "$dist/$f"
    done
}
signer() { # dists folder -> fingerprint of its InRelease signature
    gpg --homedir "$WORK/upstream-gnupg" --batch --status-fd 1 --verify "$1/InRelease" 2>/dev/null | awk '/VALIDSIG/ {print $3}'
    gpg --homedir "$GNUPG_HOME" --batch --status-fd 1 --verify "$1/InRelease" 2>/dev/null | awk '/VALIDSIG/ {print $3}'
}
signed_by_us() { signer "$1" | grep -qx "$OUR_FPR"; }
signed_upstream() {
    signer "$1" | grep -qx "$UPSTREAM_FPR" \
        && gpg --homedir "$WORK/upstream-gnupg" --batch --verify "$1/Release.gpg" "$1/Release" 2>/dev/null
}
# apt-mirror2's autoclean deletes every file the indexes do not list.
autoclean() { find "$MIRROR_ROOT" -type f \( -name '*.upstream' -o -name '*.new' \) -delete; }

echo "# r3-repos-1: the upstream signatures survive autoclean"
make_suite deb.example.org/debian trixie one
D="$MIRROR_ROOT/deb.example.org/debian/dists/trixie"
"$SIGN" deb.example.org >/dev/null
check "signed with our key" 'signed_by_us "$D"'
check "nothing extra inside dists" '[ -z "$(find "$MIRROR_ROOT" -name "*.upstream")" ]'
check "skel keeps the upstream signature" 'signed_upstream "$SKEL/deb.example.org/debian/dists/trixie"'
autoclean
rm -rf "$SKEL/deb.example.org"  # the saved copy alone must be enough
"$SIGN" --restore deb.example.org > "$WORK/out"
check "restore puts the upstream signatures back" 'signed_upstream "$D"'
check "restore reports no missing file" '! grep -q "Not restored" "$WORK/out"'

echo "# restore falls back to skel when nothing was saved"
make_suite deb.example.org/debian trixie two
"$SIGN" deb.example.org >/dev/null
rm -rf "$STORE"
"$SIGN" --restore deb.example.org >/dev/null
check "restored from skel" 'signed_upstream "$D"'

echo "# without any upstream copy the signature is kept, never deleted"
make_suite deb.example.org/debian trixie three
"$SIGN" deb.example.org >/dev/null
rm -rf "$STORE"
printf 'Description: newer\n' > "$WORK/r" && mv "$WORK/r" "$SKEL/deb.example.org/debian/dists/trixie/Release"
"$SIGN" --restore deb.example.org > "$WORK/out"
check "InRelease and Release.gpg still there" '[ -f "$D/InRelease" ] && [ -f "$D/Release.gpg" ]'
check "still signed with our key" 'signed_by_us "$D"'
check "reported as not restored" 'grep -q "Not restored: 1 Release file" "$WORK/out"'

echo "# a saved copy for another Release is never used"
make_suite deb.example.org/debian trixie four
"$SIGN" deb.example.org >/dev/null
rm -rf "$SKEL/deb.example.org"
printf 'Origin: test\nDescription: changed after signing\n' > "$WORK/r" && mv "$WORK/r" "$D/Release"
"$SIGN" deb.example.org >/dev/null   # re-signs the changed Release (already ours: nothing saved)
"$SIGN" --restore deb.example.org > "$WORK/out"
check "mismatched copy not restored" 'signed_by_us "$D" && grep -q "Not restored: 1" "$WORK/out"'

echo "# dists.apt_mirror_new: the copy is saved under the published path"
make_suite deb.example.org/debian trixie six
N="$MIRROR_ROOT/deb.example.org/debian/dists.apt_mirror_new/trixie"
mkdir -p "$(dirname "$N")" && cp -a "$D" "$N"
"$SIGN" --dir "$(dirname "$N")" >/dev/null
check "new folder signed" 'signed_by_us "$N"'
check "copy saved under dists/" '[ -n "$(find "$STORE/deb.example.org/debian/dists/trixie" -name InRelease)" ]'
check "nothing saved under dists.apt_mirror_new" '[ ! -e "$STORE/deb.example.org/debian/dists.apt_mirror_new" ]'
rm -rf "$MIRROR_ROOT/deb.example.org/debian/dists" && mv "$(dirname "$N")" "$MIRROR_ROOT/deb.example.org/debian/dists"
rm -rf "$SKEL/deb.example.org"
"$SIGN" --restore deb.example.org >/dev/null
check "published folder restores" 'signed_upstream "$D"'

echo
if [ "$failures" -eq 0 ]; then echo "All sign-releases tests passed"; else echo "$failures test(s) failed"; exit 1; fi
