#!/bin/bash
set -e

echo "🚀 Starting APT Mirror Container..."

# Function to handle shutdown gracefully
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

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Create necessary directories if they don't exist
mkdir -p /var/log/nginx
mkdir -p /var/spool/apt-mirror
mkdir -p /var/www/mirror.intra

# Set proper permissions
chown -R www-data:www-data /var/www
chown -R www-data:www-data /var/spool/apt-mirror

# Create symlink for apt-mirror data if it doesn't exist
if [ ! -L /var/www/mirror.intra/mirror ]; then
    ln -sf /var/spool/apt-mirror/mirror /var/www/mirror.intra/mirror
fi

# Enable nginx sites if configs are mounted
if [ -f /etc/nginx/sites-available/mirror.intra.conf ]; then
    echo "🔗 Enabling nginx sites..."
    # Remove default site if it exists
    rm -f /etc/nginx/sites-enabled/default
    ln -sf /etc/nginx/sites-available/mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    ln -sf /etc/nginx/sites-available/admin.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    ln -sf /etc/nginx/sites-available/files.mirror.intra.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    echo "✅ Nginx sites enabled"
else
    echo "⚠️  Nginx configuration not found. Please ensure nginx config volume is mounted."
fi

# Check if htpasswd file exists
if [ ! -f /etc/nginx/.htpasswd ]; then
    echo "❌ htpasswd file not found. Please ensure data/conf/nginx/.htpasswd is mounted."
    exit 1
fi

echo "✅ htpasswd file found"

# Start nginx
echo "🌐 Starting nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Wait a moment for nginx to start
sleep 2

# Check if nginx started successfully
if ! kill -0 $NGINX_PID 2>/dev/null; then
    echo "❌ Failed to start nginx"
    exit 1
fi

echo "✅ nginx started successfully (PID: $NGINX_PID)"

# Start apt-mirror sync in background if configuration exists
if [ -f /etc/apt/mirror.list ]; then
    echo "🔄 Starting apt-mirror sync..."
    /usr/local/bin/mirror-sync.sh &
    MIRROR_PID=$!
    echo "✅ apt-mirror sync started (PID: $MIRROR_PID)"
else
    echo "⚠️  No apt-mirror configuration found. Skipping sync."
fi

# Start health check service
echo "🏥 Starting health check service..."
/usr/local/bin/health-check.sh &
HEALTH_PID=$!

echo "🎉 All services started successfully!"
echo "📊 Services running:"
echo "   - nginx (PID: $NGINX_PID)"
if [ -n "$MIRROR_PID" ]; then
    echo "   - apt-mirror sync (PID: $MIRROR_PID)"
fi
echo "   - health check (PID: $HEALTH_PID)"

# Wait for any process to exit
wait

# If we get here, something went wrong
echo "❌ One of the services exited unexpectedly"
exit 1 