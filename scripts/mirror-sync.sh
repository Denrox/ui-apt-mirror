#!/bin/bash

# apt-mirror2 sync script
# This script handles the synchronization of apt repositories using the Python version (apt-mirror2)

MIRROR_CONFIG="/etc/apt/mirror.list"
MIRROR_LOG="/var/log/apt-mirror/apt-mirror.log"
SYNC_FREQUENCY="${SYNC_FREQUENCY:-3600}"  # Default: 1 hour
LOCK_FILE="/var/run/apt-mirror.lock"
LOG_MAX_SIZE=2097152  # 2 MB
LOG_MAX_ROTATIONS=3

# Function to rotate log if it exceeds LOG_MAX_SIZE
rotate_log() {
    [ -f "$MIRROR_LOG" ] || return 0
    local size
    size=$(stat -c%s "$MIRROR_LOG" 2>/dev/null || echo 0)
    [ "$size" -lt "$LOG_MAX_SIZE" ] && return 0

    local i=$((LOG_MAX_ROTATIONS - 1))
    rm -f "${MIRROR_LOG}.${LOG_MAX_ROTATIONS}"
    while [ "$i" -ge 1 ]; do
        [ -f "${MIRROR_LOG}.${i}" ] && mv "${MIRROR_LOG}.${i}" "${MIRROR_LOG}.$((i + 1))"
        i=$((i - 1))
    done
    mv "$MIRROR_LOG" "${MIRROR_LOG}.1"
}

# Function to log messages
log() {
    # Ensure log directory exists
    mkdir -p "$(dirname "$MIRROR_LOG")"
    rotate_log
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$MIRROR_LOG"
}

# The lock holds the PID of the mirror-sync.sh run that owns the sync.
is_running() {
    [ -f "$LOCK_FILE" ] || return 1
    local pid
    pid=$(cat "$LOCK_FILE" 2>/dev/null)
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && grep -qa "mirror-sync" "/proc/$pid/cmdline" 2>/dev/null
}

has_enabled_repos() {
    grep -qE '^[[:space:]]*deb(-src)?[[:space:]]' "$MIRROR_CONFIG" 2>/dev/null
}

# Seconds until the next sync is due, counted from the last completed one.
seconds_until_due() {
    local stamp=/var/spool/apt-mirror/last-sync.txt
    if [ ! -f "$stamp" ]; then
        echo 0
        return
    fi
    local due=$(( $(stat -c %Y "$stamp") + SYNC_FREQUENCY - $(date +%s) ))
    [ "$due" -gt 0 ] && echo "$due" || echo 0
}

# Function to check if sync is already running
check_lock() {
    if is_running; then
        log "Sync already running (PID: $(cat "$LOCK_FILE" 2>/dev/null))"
        return 1
    fi
    if [ -f "$LOCK_FILE" ]; then
        log "Removing stale lock file"
        rm -f "$LOCK_FILE"
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
    exec 8>&-
}

# Function to perform sync
do_sync() {
    log "Starting apt-mirror2 sync..."
    
    if [ ! -f "$MIRROR_CONFIG" ]; then
        log "ERROR: Mirror configuration not found at $MIRROR_CONFIG"
        return 1
    fi
    
    # Held for the whole sync, so two runs can never overlap however they were started.
    exec 8>/var/run/apt-mirror.flock
    if ! flock -n 8; then
        log "Sync already running"
        return 1
    fi
    create_lock
    
    # Set environment variables for better performance
    export PYTHONUNBUFFERED=1
    export PYTHONIOENCODING=utf-8
    
    # Run apt-mirror2 using Python version with timeout
    rotate_log
    timeout 36000 apt-mirror "$MIRROR_CONFIG" 2>&1 | tee -a "$MIRROR_LOG"
    local exit_code=${PIPESTATUS[0]}
    if [ "$exit_code" -eq 0 ]; then
        log "Sync completed successfully"

        # Update symlink to ensure web server sees latest data
        if [ -d "/var/spool/apt-mirror/mirror" ]; then
            ln -sf /var/spool/apt-mirror/mirror /var/www/mirror.intra/mirror
            log "Updated web symlink"
        fi

        # Re-sign Release files for every host that has a GPG key registered.
        if [ -x /usr/local/bin/sign-releases.sh ]; then
            log "Signing Release files..."
            /usr/local/bin/sign-releases.sh 2>&1 | tee -a "$MIRROR_LOG" || \
                log "WARN: sign-releases.sh exited non-zero"
        fi

        # Update last sync timestamp
        date > /var/spool/apt-mirror/last-sync.txt
        
        # Log sync completion statistics
        log "Sync completed at $(date)"
        if [ -d "/var/spool/apt-mirror/mirror" ]; then
            local total_size=$(du -sh /var/spool/apt-mirror/mirror 2>/dev/null | cut -f1)
            log "Total mirror size: $total_size"
        fi
    else
        if [ "$exit_code" -eq 124 ]; then
            log "ERROR: Sync timed out after 10 hours"
        elif [ "$exit_code" -eq 143 ] || [ "$exit_code" -eq 137 ]; then
            log "Sync stopped before completion (exit code $exit_code)"
        else
            log "ERROR: Sync failed with exit code $exit_code"
        fi
        remove_lock
        return 1
    fi
    
    remove_lock
    return 0
}

# Function to run continuous sync
run_continuous() {
    log "Starting continuous sync with frequency: ${SYNC_FREQUENCY}s"

    # A restart (or upgrade) does not trigger a sync before one is due.
    local wait
    wait=$(seconds_until_due)
    if [ "$wait" -gt 0 ]; then
        log "Last sync is recent; next sync in ${wait}s"
        sleep "$wait"
    fi

    while true; do
        if ! has_enabled_repos; then
            log "No repositories enabled in mirror.list; nothing to sync"
        elif check_lock; then
            do_sync
        fi
        
        log "Waiting ${SYNC_FREQUENCY} seconds until next sync..."
        sleep "$SYNC_FREQUENCY"
    done
}

# Function to run single sync
run_once() {
    if ! has_enabled_repos; then
        log "No repositories enabled in mirror.list; nothing to sync"
        exit 1
    fi
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
        if is_running; then
            echo "Sync running (PID: $(cat "$LOCK_FILE"))"
        elif [ -f "$LOCK_FILE" ]; then
            echo "Stale lock file found"
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