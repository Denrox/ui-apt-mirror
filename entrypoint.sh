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
# Access log names contain the date, so nginx workers (www-data) open them per request.
chown www-data:www-data /var/log/nginx
find /var/log/nginx -maxdepth 1 -name '*access-*.log' ! -user www-data -exec chown www-data:www-data {} + 2>/dev/null || true
# Password hashes; only the admin app (root) reads them
[ -f /var/auth/.htpasswd ] && chmod 600 /var/auth/.htpasswd
mkdir -p /var/log/apt-mirror
mkdir -p /var/spool/apt-mirror
# nginx serves mirror/: until the first sync creates it, / is a 404 and its access log can't be written
if [ ! -d /var/spool/apt-mirror/mirror ]; then
    mkdir -p /var/spool/apt-mirror/mirror
    chown --reference=/var/spool/apt-mirror /var/spool/apt-mirror/mirror 2>/dev/null || true
fi
mkdir -p /var/www/mirror.intra
mkdir -p /var/spool/apt-mirror/gpg/gnupg

# nginx (www-data) only reads the served trees; everything else runs as root.
chmod o+x /var/spool/apt-mirror 2>/dev/null || true
chmod o+rx /var/www/files /var/spool/apt-mirror/mirror 2>/dev/null || true
chmod 700 /var/spool/apt-mirror/gpg/gnupg
# gpg runs as root and warns on every call about a homedir it does not own
chown -R root:root /var/spool/apt-mirror/gpg/gnupg
if [ ! -f /var/spool/apt-mirror/gpg/keys.json ]; then
    echo '{}' > /var/spool/apt-mirror/gpg/keys.json
    chown --reference=/var/spool/apt-mirror /var/spool/apt-mirror/gpg/keys.json 2>/dev/null || true
fi

if [ ! -L /var/www/mirror.intra/mirror ]; then
    ln -sfn /var/spool/apt-mirror/mirror /var/www/mirror.intra/mirror
fi

# Render nginx sites from the image's templates; data/conf/nginx/custom/<name> overrides one.
bash /etc/nginx/sites-setup/render-sites.sh

if [ -f /etc/nginx/sites-available/mirror.intra.conf ]; then
    echo "🔗 Enabling nginx sites..."
    rm -f /etc/nginx/sites-enabled/default
    ln -sf /etc/nginx/sites-available/mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    ln -sf /etc/nginx/sites-available/admin.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    ln -sf /etc/nginx/sites-available/files.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    if [ "$NPM_PROXY_ENABLED" = "true" ]; then
        ln -sf /etc/nginx/sites-available/npm.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    else
        rm -f /etc/nginx/sites-enabled/npm.mirror.intra.conf
        echo "   npm proxy disabled (NPM_PROXY_ENABLED=${NPM_PROXY_ENABLED:-unset})"
    fi
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
    echo "🔄 Starting the sync scheduler (it syncs when one is due)..."
    /usr/local/bin/mirror-sync.sh &
    MIRROR_PID=$!
    echo "✅ Sync scheduler started (PID: $MIRROR_PID)"
else
    echo "⚠️  No apt-mirror2 configuration found. Skipping sync."
fi

echo "🧹 Starting log cleanup service..."
/usr/local/bin/log-cleanup.sh &
LOG_CLEANUP_PID=$!

echo "🏥 Starting health check service..."
/usr/local/bin/health-check.sh monitor &
HEALTH_PID=$!

echo "🎉 All services started successfully!"
echo "📊 Services running:"
echo "   - nginx (PID: $NGINX_PID)"
if [ -n "$MIRROR_PID" ]; then
    echo "   - sync scheduler (PID: $MIRROR_PID)"
fi
echo "   - health check (PID: $HEALTH_PID)"

# Without the admin app or nginx no host works: end the container so its
# restart policy starts it again.
wait -n "$ADMIN_PID" "$NGINX_PID" || true

echo "❌ One of the services exited unexpectedly"
exit 1 