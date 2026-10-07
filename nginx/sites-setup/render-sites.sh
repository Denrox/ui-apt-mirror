#!/bin/bash
# Renders the nginx sites from the image's templates; data/conf/nginx/custom/<name>
# overrides one. Run by entrypoint.sh. The paths can be changed for tests.
set -e

NGINX_TEMPLATES=${NGINX_TEMPLATES:-/etc/nginx/templates}
NGINX_HOSTCONF=${NGINX_HOSTCONF:-/etc/nginx/hostconf}
NGINX_SITES=${NGINX_SITES:-/etc/nginx/sites-available}
NGINX_CUSTOM="$NGINX_HOSTCONF/custom"
MIRROR_DOMAIN="${MIRROR_DOMAIN:-mirror.intra}"
ESCAPED_DOMAIN=$(printf '%s' "$MIRROR_DOMAIN" | sed 's/[&/\]/\\&/g')

render_site() {
    sed "s/mirror\.intra/${ESCAPED_DOMAIN}/g" "$1"
}

mkdir -p "$NGINX_CUSTOM"

# One-time migration: edited legacy site configs become custom overrides.
LEGACY_SITES="$NGINX_HOSTCONF/sites-available"
if [ -d "$LEGACY_SITES" ]; then
    for legacy in "$LEGACY_SITES"/*.conf; do
        [ -f "$legacy" ] || continue
        name=$(basename "$legacy")
        tpl="$NGINX_TEMPLATES/$name"
        if [ -f "$tpl" ] && render_site "$tpl" | cmp -s - "$legacy"; then
            continue
        fi
        if [ ! -e "$NGINX_CUSTOM/$name" ]; then
            cp "$legacy" "$NGINX_CUSTOM/$name"
            echo "⚠️  Kept your modified nginx config as custom/$name (delete it to use the stock one)"
        fi
    done
    mv "$LEGACY_SITES" "$NGINX_HOSTCONF/sites-available.migrated-$(date +%Y%m%d%H%M%S)"
fi

# Overrides hide later stock fixes; keep the new stock copy until the user deletes it.
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
    fi
    if [ -f "$stock_copy" ]; then
        echo "⚠️  custom/$name may be missing fixes made to the stock $name since it was written."
        echo "   Compare it with custom/$name.stock, merge what you need, then delete $name.stock."
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
    fi
done

find "$NGINX_CUSTOM" -user 0 -exec chown --reference="$NGINX_HOSTCONF" {} + 2>/dev/null || true
