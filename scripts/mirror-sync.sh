#!/bin/bash

# apt-mirror sync script
# This script handles the synchronization of apt repositories

MIRROR_CONFIG="/etc/apt/mirror.list"
MIRROR_LOG="/var/log/apt-mirror/apt-mirror.log"
SYNC_FREQUENCY="${SYNC_FREQUENCY:-3600}"  # Default: 1 hour
LOCK_FILE="/var/run/apt-mirror.lock"

# Function to log messages
log() {
    # Ensure log directory exists
    mkdir -p "$(dirname "$MIRROR_LOG")"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$MIRROR_LOG"
}

# Function to check if sync is already running
check_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if kill -0 "$pid" 2>/dev/null; then
            log "Sync already running (PID: $pid)"
            return 1
        else
            log "Removing stale lock file"
            rm -f "$LOCK_FILE"
        fi
    fi
    return 0
}

# Function to create lock file
create_lock() {
    echo $$ > "$LOCK_FILE"
}

# Function to remove lock file
remove_lock() {
    rm -f "$LOCK_FILE"
}

# Function to perform sync
do_sync() {
    log "Starting apt-mirror sync..."
    
    if [ ! -f "$MIRROR_CONFIG" ]; then
        log "ERROR: Mirror configuration not found at $MIRROR_CONFIG"
        return 1
    fi
    
    # Create lock file
    create_lock
    
    # Run apt-mirror
    if apt-mirror "$MIRROR_CONFIG" 2>&1 | tee -a "$MIRROR_LOG"; then
        log "Sync completed successfully"
        
        # Update symlink to ensure web server sees latest data
        if [ -d "/var/spool/apt-mirror/mirror" ]; then
            ln -sf /var/spool/apt-mirror/mirror /var/www/mirror.intra/mirror
            log "Updated web symlink"
        fi
        
        # Update last sync timestamp
        date > /var/spool/apt-mirror/last-sync.txt
    else
        log "ERROR: Sync failed"
        remove_lock
        return 1
    fi
    
    remove_lock
    return 0
}

# Function to run continuous sync
run_continuous() {
    log "Starting continuous sync with frequency: ${SYNC_FREQUENCY}s"
    
    while true; do
        if check_lock; then
            do_sync
        fi
        
        log "Waiting ${SYNC_FREQUENCY} seconds until next sync..."
        sleep "$SYNC_FREQUENCY"
    done
}

# Function to run single sync
run_once() {
    if check_lock; then
        do_sync
    else
        exit 1
    fi
}

# Main execution
case "${1:-continuous}" in
    "once")
        run_once
        ;;
    "continuous")
        run_continuous
        ;;
    "status")
        if [ -f "$LOCK_FILE" ]; then
            local pid=$(cat "$LOCK_FILE")
            if kill -0 "$pid" 2>/dev/null; then
                echo "Sync running (PID: $pid)"
            else
                echo "Stale lock file found"
            fi
        else
            echo "No sync running"
        fi
        ;;
    *)
        echo "Usage: $0 {once|continuous|status}"
        echo "  once        - Run sync once and exit"
        echo "  continuous  - Run sync continuously (default)"
        echo "  status      - Check sync status"
        exit 1
        ;;
esac 