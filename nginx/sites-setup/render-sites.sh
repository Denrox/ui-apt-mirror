#!/bin/bash
# Renders the nginx sites from the image's templates; data/conf/nginx/custom/<name>
# overrides one. Run by entrypoint.sh. The paths can be changed for tests (see test.sh).
#
# "source render-sites.sh --lib" only defines the hash helpers (update-released-sites.sh).
set -e

# Stock configs are recognised by a hash of their text with the domain they were
# rendered for replaced by a placeholder. CRs, trailing spaces and a missing final
# newline are ignored, so an editor that only touched those does not count as an edit.
# $1 = the domain the text on stdin was rendered for.
site_normalise() {
    local re
    re=$(printf '%s' "$1" | sed 's/[][\.*^$/]/\\&/g')
    sed -e 's/\r$//' -e 's/[[:space:]]*$//' -e "s/$re/@DOMAIN@/g" -e '$a\'
}

site_hash() {
    site_normalise "$1" | sha256sum | cut -d' ' -f1
}

if [ "${1:-}" = --lib ]; then
    return 0 2>/dev/null || exit 0
fi

SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NGINX_TEMPLATES=${NGINX_TEMPLATES:-/etc/nginx/templates}
NGINX_HOSTCONF=${NGINX_HOSTCONF:-/etc/nginx/hostconf}
NGINX_SITES=${NGINX_SITES:-/etc/nginx/sites-available}
# The stock site configs of the previous release; replaced by update-released-sites.sh
RELEASED_SITES=${RELEASED_SITES:-$SELF_DIR/released-sites.sha256}
NGINX_CUSTOM="$NGINX_HOSTCONF/custom"
MIRROR_DOMAIN="${MIRROR_DOMAIN:-mirror.intra}"
ESCAPED_DOMAIN=$(printf '%s' "$MIRROR_DOMAIN" | sed 's/[&/\]/\\&/g')

render_site() {
    sed "s/mirror\.intra/${ESCAPED_DOMAIN}/g" "$1"
}

# The hashes the file would have as a stock config. An override is compared only as
# rendered for this install's domain or as the unrendered template (mirror.intra),
# never for the domain in its own server_name: a copy whose only edit is another
# host name is an edit, and must stay an override.
file_hashes() {
    local file=$1 domain
    for domain in "$MIRROR_DOMAIN" mirror.intra; do
        site_hash "$domain" < "$file"
        [ "$MIRROR_DOMAIN" != mirror.intra ] || break
    done
}

# Is the file the unedited <name> config of the previous release?
released_stock() {
    local file=$1 name=$2 hash
    [ -f "$RELEASED_SITES" ] || return 1
    for hash in $(file_hashes "$file"); do
        grep -qxF "$hash $name" "$RELEASED_SITES" && return 0
    done
    return 1
}

# Is the file this image's stock <name> config?
current_stock() {
    local file=$1 name=$2 tpl="$NGINX_TEMPLATES/$2" current hash
    [ -f "$tpl" ] || return 1
    current=$(site_hash mirror.intra < "$tpl")
    for hash in $(file_hashes "$file"); do
        [ "$hash" = "$current" ] && return 0
    done
    return 1
}

mkdir -p "$NGINX_CUSTOM"

# An override that is the previous release's stock config, unedited (copied from
# the container, or from the template), would keep that release's config forever:
# drop it so the current stock config is used.
for custom in "$NGINX_CUSTOM"/*.conf; do
    [ -f "$custom" ] || continue
    name=$(basename "$custom")
    [ -f "$NGINX_TEMPLATES/$name" ] || continue
    if released_stock "$custom" "$name" && ! current_stock "$custom" "$name"; then
        rm -f "$custom" "$NGINX_CUSTOM/$name.stock" "$NGINX_CUSTOM/.$name.stock-sha256"
        echo "⚠️  custom/$name was the previous release's stock config, unedited; removed it to use the current one"
    fi
done

# Overrides hide later stock fixes; keep the new stock copy until the user deletes it.
# .<name>.stock-sha256 holds the template the site used before it was overridden.
check_override() {
    local tpl=$1 name=$2
    local hash_file="$NGINX_CUSTOM/.$name.stock-sha256"
    local stock_copy="$NGINX_CUSTOM/$name.stock"
    local current recorded
    current=$(sha256sum "$tpl" | cut -d' ' -f1)
    recorded=$(cat "$hash_file" 2>/dev/null || true)
    if [ "$current" != "$recorded" ]; then
        render_site "$tpl" > "$stock_copy"
        echo "$current" > "$hash_file"
        if [ -z "$recorded" ]; then
            echo "⚠️  custom/$name: not known which version of the stock $name it was written against."
        else
            echo "⚠️  The stock $name changed since custom/$name was written; it may be missing fixes."
        fi
    fi
    if [ -f "$stock_copy" ]; then
        echo "⚠️  Compare custom/$name with custom/$name.stock, merge what you need, then delete $name.stock."
    fi
}

echo "🧩 Rendering nginx sites for $MIRROR_DOMAIN..."
mkdir -p "$NGINX_SITES"
for tpl in "$NGINX_TEMPLATES"/*.conf; do
    name=$(basename "$tpl")
    if [ -f "$NGINX_CUSTOM/$name" ]; then
        cp "$NGINX_CUSTOM/$name" "$NGINX_SITES/$name"
        echo "   $name: custom"
        check_override "$tpl" "$name"
    else
        render_site "$tpl" > "$NGINX_SITES/$name"
        # An override copied from this config later starts from this record
        sha256sum "$tpl" | cut -d' ' -f1 > "$NGINX_CUSTOM/.$name.stock-sha256"
        rm -f "$NGINX_CUSTOM/$name.stock"
    fi
done

find "$NGINX_CUSTOM" -user 0 -exec chown --reference="$NGINX_HOSTCONF" {} + 2>/dev/null || true
