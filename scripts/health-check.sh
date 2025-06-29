#!/bin/bash

# Health check script for apt-mirror container
# This script monitors the health of nginx and apt-mirror services

HEALTH_LOG="/var/log/health-check.log"
NGINX_PID_FILE="/var/run/nginx.pid"
MIRROR_LOCK_FILE="/var/run/apt-mirror.lock"
HEALTH_STATUS_FILE="/var/run/health.status"

# Function to log health check messages
log_health() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$HEALTH_LOG"
}

# Function to check nginx status
check_nginx() {
    if [ -f "$NGINX_PID_FILE" ]; then
        local pid=$(cat "$NGINX_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            # Check if nginx is responding
            if curl -f -s http://localhost/ > /dev/null 2>&1; then
                echo "nginx:running:$pid"
                return 0
            else
                echo "nginx:not_responding:$pid"
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

# Function to check apt-mirror status
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
    if [ "$usage" -gt 90 ]; then
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

# Function to perform comprehensive health check
do_health_check() {
    local status="healthy"
    local details=()
    
    # Check nginx
    local nginx_status=$(check_nginx)
    details+=("nginx:$nginx_status")
    if ! echo "$nginx_status" | grep -q "running"; then
        status="unhealthy"
    fi
    
    # Check mirror
    local mirror_status=$(check_mirror)
    details+=("mirror:$mirror_status")
    
    # Check disk
    local disk_status=$(check_disk)
    details+=("disk:$disk_status")
    if echo "$disk_status" | grep -q "9[0-9]%\|100%"; then
        status="warning"
    fi
    
    # Get additional info
    details+=("$(check_last_sync)")
    details+=("$(get_uptime)")
    details+=("$(get_memory)")
    
    # Write status to file
    cat > "$HEALTH_STATUS_FILE" << EOF
{
    "status": "$status",
    "timestamp": "$(date -Iseconds)",
    "details": {
        $(printf '%s\n' "${details[@]}" | sed 's/:/": "/; s/$/"/; s/^/        "/; s/:/": "/')
    }
}
EOF
    
    echo "$status"
}

# Function to run continuous monitoring
run_monitoring() {
    log_health "Starting health monitoring"
    
    while true; do
        local health_status=$(do_health_check)
        log_health "Health check result: $health_status"
        
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