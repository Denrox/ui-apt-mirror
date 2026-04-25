#!/bin/bash

# Periodic cleanup of old nginx access logs.
# Removes dated access logs (access-YYYY-MM-DD.log) older than RETENTION_DAYS.

NGINX_LOG_DIR="/var/log/nginx"
RETENTION_DAYS=30
CLEANUP_INTERVAL=86400  # 24h

cleanup_once() {
    [ -d "$NGINX_LOG_DIR" ] || return 0
    find "$NGINX_LOG_DIR" -maxdepth 1 -type f \
        -name '*.access-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].log' \
        -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null
}

case "${1:-continuous}" in
    "once")
        cleanup_once
        ;;
    "continuous")
        while true; do
            cleanup_once
            sleep "$CLEANUP_INTERVAL"
        done
        ;;
    *)
        echo "Usage: $0 {once|continuous}"
        exit 1
        ;;
esac
