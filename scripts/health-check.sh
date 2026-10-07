#!/bin/bash

# Health check script for apt-mirror2 container
# This script monitors the health of nginx, the admin app and apt-mirror2

HEALTH_LOG="${HEALTH_LOG:-/var/log/health-check.log}"
NGINX_PID_FILE="/var/run/nginx.pid"
MIRROR_LOCK_FILE="/var/run/apt-mirror.lock"
HEALTH_STATUS_FILE="${HEALTH_STATUS_FILE:-/var/run/health.status}"

# Function to log health check messages
log_health() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$HEALTH_LOG"
}

# Function to check nginx status
check_nginx() {
    if [ -f "$NGINX_PID_FILE" ]; then
        local pid=$(cat "$NGINX_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            # Check if nginx is listening on port 80
            if netstat -tlnp 2>/dev/null | grep -q ":80.*nginx" || ss -tlnp 2>/dev/null | grep -q ":80.*nginx"; then
                echo "nginx:running:$pid"
                return 0
            else
                echo "nginx:not_listening:$pid"
                return 1
            fi
        else
            echo "nginx:not_running:"
            return 1
        fi
    else
        echo "nginx:no_pid_file:"
        return 1
    fi
}

# Function to check the admin app, which serves every host but the APT mirror
check_admin() {
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/ 2>/dev/null)
    if [ -n "$code" ] && [ "$code" != "000" ]; then
        echo "admin:running:$code"
        return 0
    fi
    echo "admin:not_responding:"
    return 1
}

# Function to check apt-mirror2 status
check_mirror() {
    if [ -f "$MIRROR_LOCK_FILE" ]; then
        local pid=$(cat "$MIRROR_LOCK_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "mirror:syncing:$pid"
            return 0
        else
            echo "mirror:stale_lock:$pid"
            return 1
        fi
    else
        echo "mirror:idle:"
        return 0
    fi
}

# Function to check disk usage
check_disk() {
    local usage=$(df /var/spool/apt-mirror | tail -1 | awk '{print $5}' | sed 's/%//')
    echo "disk:$usage%"
    if [ "${usage:-0}" -gt 90 ]; then
        return 1
    fi
    return 0
}

# Function to check last sync time
check_last_sync() {
    if [ -f "/var/spool/apt-mirror/last-sync.txt" ]; then
        local last_sync=$(cat "/var/spool/apt-mirror/last-sync.txt")
        echo "last_sync:$last_sync"
    else
        echo "last_sync:never"
    fi
}

# Function to get system uptime
get_uptime() {
    local uptime=$(uptime -p 2>/dev/null || echo "unknown")
    echo "uptime:$uptime"
}

# Function to get memory usage
get_memory() {
    local mem_info=$(free -m | grep Mem)
    local total=$(echo $mem_info | awk '{print $2}')
    local used=$(echo $mem_info | awk '{print $3}')
    local usage=$((used * 100 / total))
    echo "memory:${usage}%"
}

json_string() {
    local s=${1//\\/\\\\}
    printf '"%s"' "${s//\"/\\\"}"
}

# Function to perform comprehensive health check
do_health_check() {
    local status="healthy"
    local details=()
    
    # Check nginx
    local nginx_status=$(check_nginx)
    details+=("$nginx_status")
    if [[ "$nginx_status" != nginx:running:* ]]; then
        status="unhealthy"
    fi

    # Check the admin app
    local admin_status=$(check_admin)
    details+=("$admin_status")
    if [[ "$admin_status" != admin:running:* ]]; then
        status="unhealthy"
    fi

    # Check mirror
    local mirror_status=$(check_mirror)
    details+=("$mirror_status")

    # Check disk
    local disk_status
    if ! disk_status=$(check_disk) && [ "$status" = "healthy" ]; then
        status="warning"
    fi
    details+=("$disk_status")

    # Get additional info
    details+=("$(check_last_sync)")
    details+=("$(get_uptime)")
    details+=("$(get_memory)")

    # Each detail is "key:value"; write the file whole so readers never see half of it
    local detail sep="" json=""
    for detail in "${details[@]}"; do
        json+="$sep"$'\n'"        $(json_string "${detail%%:*}"): $(json_string "${detail#*:}")"
        sep=","
    done
    cat > "$HEALTH_STATUS_FILE.$$" << EOF
{
    "status": "$status",
    "timestamp": "$(date -Iseconds)",
    "details": {$json
    }
}
EOF
    mv -f "$HEALTH_STATUS_FILE.$$" "$HEALTH_STATUS_FILE"

    echo "$status"
}

# Function to run continuous monitoring
run_monitoring() {
    log_health "Starting health monitoring"
    local health_status last_status=""

    while true; do
        health_status=$(do_health_check)
        # Log changes only; the result is checked every 30 s
        if [ "$health_status" != "$last_status" ]; then
            log_health "Health check result: $health_status"
            last_status=$health_status
        fi

        # Sleep for 30 seconds before next check
        sleep 30
    done
}

# Function to run single health check
run_once() {
    local health_status=$(do_health_check)
    echo "$health_status"
    
    if [ "$health_status" = "healthy" ]; then
        exit 0
    else
        exit 1
    fi
}

# Function to get detailed status
get_status() {
    if [ -f "$HEALTH_STATUS_FILE" ]; then
        cat "$HEALTH_STATUS_FILE"
    else
        echo '{"status": "unknown", "timestamp": "", "details": {}}'
    fi
}

# Main execution
case "${1:-once}" in
    "once")
        run_once
        ;;
    "monitor")
        run_monitoring
        ;;
    "status")
        get_status
        ;;
    *)
        echo "Usage: $0 {once|monitor|status}"
        echo "  once    - Run health check once and exit"
        echo "  monitor - Run continuous health monitoring"
        echo "  status  - Get detailed status information"
        exit 1
        ;;
esac 