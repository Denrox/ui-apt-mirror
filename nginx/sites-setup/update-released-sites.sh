#!/bin/bash
# Replaces released-sites.sha256 with the hashes of a release's stock nginx site
# configs (nginx/sites/ at its tag), as render-sites.sh computes them. Upgrades are
# supported from the latest release only, so the next version only needs to tell
# that release's unedited configs from a user's edits.
#
# Release step: after tagging a release, run it with the new tag and commit the result:
#   nginx/sites-setup/update-released-sites.sh v3.0.1
#   git commit -m "List the stock nginx site configs of v3.0.1" nginx/sites-setup/released-sites.sha256
#
# --check only reports whether the committed list matches the tag it names.
set -euo pipefail

dir=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=render-sites.sh
. "$dir/render-sites.sh" --lib
list="$dir/released-sites.sha256"

cd "$(git -C "$dir" rev-parse --show-toplevel)"

header() {
    echo "# Stock nginx site configs of $1: <sha256> <site>. Written by update-released-sites.sh; do not edit."
}

generate() {
    local tag=$1 file
    header "$tag"
    git ls-tree --name-only "$tag" nginx/sites/ | grep '\.conf$' | while read -r file; do
        printf '%s %s\n' "$(git show "$tag:$file" | site_hash mirror.intra)" "$(basename "$file")"
    done
}

# The tag the list was written for (none before the first 3.x release is tagged)
listed_tag() {
    sed -n '1s/^# Stock nginx site configs of \(v[^:]*\):.*/\1/p' "$list"
}

case "${1:-}" in
    --check)
        tag=$(listed_tag)
        if [ -z "$tag" ]; then
            echo "released-sites.sha256 lists no release yet."
        elif ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
            echo "No tag $tag to check released-sites.sha256 against (git fetch --tags?)" >&2
            exit 1
        elif generate "$tag" | cmp -s - "$list"; then
            echo "released-sites.sha256 lists the configs of $tag."
        else
            echo "released-sites.sha256 does not match $tag; run nginx/sites-setup/update-released-sites.sh $tag" >&2
            exit 1
        fi
        ;;
    v*)
        tag=$1
        git rev-parse -q --verify "refs/tags/$tag" >/dev/null || { echo "No tag $tag" >&2; exit 1; }
        generate "$tag" > "$list"
        echo "Wrote $list ($(grep -vc '^#' "$list") configs of $tag)."
        ;;
    *)
        echo "Usage: $0 <release tag> | --check" >&2
        exit 2
        ;;
esac
