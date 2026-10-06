#!/bin/bash
set -e

echo "🚀 Starting APT Mirror Container..."

cleanup() {
    echo "🛑 Shutting down services..."
    if [ -n "$NGINX_PID" ]; then
        kill $NGINX_PID
    fi
    if [ -n "$MIRROR_PID" ]; then
        kill $MIRROR_PID
    fi
    exit 0
}

trap cleanup SIGTERM SIGINT

mkdir -p /var/log/nginx
mkdir -p /var/log/apt-mirror
mkdir -p /var/spool/apt-mirror
mkdir -p /var/www/mirror.intra
mkdir -p /var/spool/apt-mirror/gpg/gnupg

chown -R www-data:www-data /var/www
chown -R www-data:www-data /var/spool/apt-mirror
chmod 700 /var/spool/apt-mirror/gpg/gnupg
[ -f /var/spool/apt-mirror/gpg/keys.json ] || echo '{}' > /var/spool/apt-mirror/gpg/keys.json
chown www-data:www-data /var/spool/apt-mirror/gpg/keys.json

if [ ! -L /var/www/mirror.intra/mirror ]; then
    ln -sf /var/spool/apt-mirror/mirror /var/www/mirror.intra/mirror
fi

# Render nginx sites from the image's templates; data/conf/nginx/custom/<name> overrides one.
NGINX_HOSTCONF=/etc/nginx/hostconf
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
        tpl="/etc/nginx/templates/$name"
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

find "$NGINX_CUSTOM" -user 0 -exec chown --reference="$NGINX_HOSTCONF" {} + 2>/dev/null || true

echo "🧩 Rendering nginx sites for $MIRROR_DOMAIN..."
for tpl in /etc/nginx/templates/*.conf; do
    name=$(basename "$tpl")
    if [ -f "$NGINX_CUSTOM/$name" ]; then
        cp "$NGINX_CUSTOM/$name" "/etc/nginx/sites-available/$name"
        echo "   $name: custom"
    else
        render_site "$tpl" > "/etc/nginx/sites-available/$name"
    fi
done

if [ -f /etc/nginx/sites-available/mirror.intra.conf ]; then
    echo "🔗 Enabling nginx sites..."
    rm -f /etc/nginx/sites-enabled/default
    ln -sf /etc/nginx/sites-available/mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    ln -sf /etc/nginx/sites-available/admin.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    ln -sf /etc/nginx/sites-available/files.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    ln -sf /etc/nginx/sites-available/npm.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    ln -sf /etc/nginx/sites-available/cheatsheets.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    echo "✅ Nginx sites enabled"
else
    echo "⚠️  Nginx configuration not found. Please ensure nginx config volume is mounted."
fi

echo "🌐 Starting admin server..."
cd /var/admin && npm run start &
ADMIN_PID=$!

sleep 2

echo "🌐 Starting nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!

sleep 2

if ! kill -0 $NGINX_PID 2>/dev/null; then
    echo "❌ Failed to start nginx"
    exit 1
fi

echo "✅ nginx started successfully (PID: $NGINX_PID)"

if [ -f /etc/apt/mirror.list ]; then
    echo "🔄 Starting apt-mirror2 sync..."
    /usr/local/bin/mirror-sync.sh &
    MIRROR_PID=$!
    echo "✅ apt-mirror2 sync started (PID: $MIRROR_PID)"
else
    echo "⚠️  No apt-mirror2 configuration found. Skipping sync."
fi

echo "🧹 Starting log cleanup service..."
/usr/local/bin/log-cleanup.sh &
LOG_CLEANUP_PID=$!

echo "🏥 Starting health check service..."
/usr/local/bin/health-check.sh &
HEALTH_PID=$!

echo "🎉 All services started successfully!"
echo "📊 Services running:"
echo "   - nginx (PID: $NGINX_PID)"
if [ -n "$MIRROR_PID" ]; then
    echo "   - apt-mirror2 sync (PID: $MIRROR_PID)"
fi
echo "   - health check (PID: $HEALTH_PID)"

wait

echo "❌ One of the services exited unexpectedly"
exit 1 