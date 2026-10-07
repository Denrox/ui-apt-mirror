#!/bin/bash

# Periodic cleanup of nginx logs.
# Removes dated access logs (access-YYYY-MM-DD.log) older than RETENTION_DAYS,
# and rotates an error log once it is larger than ERROR_LOG_MAX_KB: the old
# lines move to <name>.error.log.1 (replacing the previous one).

NGINX_LOG_DIR="/var/log/nginx"
RETENTION_DAYS=30
ERROR_LOG_MAX_KB=10240  # 10 MB
CLEANUP_INTERVAL=86400  # 24h

rotate_error_logs() {
    find "$NGINX_LOG_DIR" -maxdepth 1 -type f -name '*error.log' \
        -size "+${ERROR_LOG_MAX_KB}k" -print 2>/dev/null |
    while IFS= read -r log; do
        # nginx keeps the file open, so copy it and truncate in place
        # rather than renaming it.
        cp -p "$log" "$log.1" && : > "$log"
    done
}

cleanup_once() {
    [ -d "$NGINX_LOG_DIR" ] || return 0
    find "$NGINX_LOG_DIR" -maxdepth 1 -type f \
        -name '*.access-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].log' \
        -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null
    rotate_error_logs
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
