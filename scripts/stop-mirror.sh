#!/bin/bash

# Stop mirror sync script
# Stops the apt-mirror2 run of the sync that holds the lock when Stop is pressed, and nothing
# else: a sync started after this one ended (from another tab, while this script still waits)
# is left alone, and so is its lock.

set -e

LOCK_FILE="${MIRROR_SYNC_LOCK:-/var/run/apt-mirror.lock}"
STOP_FILE="${MIRROR_SYNC_STOP:-/var/run/apt-mirror.stop}"

# Check if mirror is running
if [ ! -f "$LOCK_FILE" ]; then
    echo "No mirror sync process running"
    exit 1
fi

echo "Stopping mirror sync..."

# The mirror-sync.sh run that owns the sync (its PID is in the lock).
sync_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
case "$sync_pid" in ''|*[!0-9]*) sync_pid="" ;; esac

# Whether that run is still the one in the lock and still alive.
sync_alive() {
    [ -n "$sync_pid" ] && kill -0 "$sync_pid" 2>/dev/null \
        && grep -qa "mirror-sync" "/proc/$sync_pid/cmdline" 2>/dev/null
}

# Every descendant of a process.
descendants() {
    local child
    for child in $(pgrep -P "$1" 2>/dev/null); do
        echo "$child"
        descendants "$child"
    done
}

# The apt-mirror run of this sync: the `timeout ... apt-mirror` child of mirror-sync.sh and
# everything below it (apt-mirror2 or the signing wrapper, and the signing it starts). The
# continuous loop's own `sleep` and the log `tee` are left alone.
runner_pids() {
    sync_alive || return 0
    local child
    for child in $(pgrep -P "$sync_pid" 2>/dev/null); do
        if tr '\0' ' ' < "/proc/$child/cmdline" 2>/dev/null | grep -q "^timeout .*apt-mirror"; then
            echo "$child"
            descendants "$child"
        fi
    done
}

# The apt-mirror python process itself (TERM goes there first).
apt_mirror_pid() {
    local pid
    for pid in $(runner_pids); do
        if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "^[^ ]*python[0-9.]* .*apt-mirror"; then
            echo "$pid"
            return 0
        fi
    done
}

if sync_alive; then
    # mirror-sync.sh treats the run as stopped even if apt-mirror exits 0 on TERM.
    touch "$STOP_FILE"
fi

pid=$(apt_mirror_pid)
if [ -n "$pid" ]; then
    echo "Found apt-mirror process with PID: $pid"

    echo "Sending TERM signal..."
    kill -TERM "$pid" 2>/dev/null || true

    sleep 3

    if [ "$(apt_mirror_pid)" = "$pid" ]; then
        echo "Process still running, sending KILL signal..."
        kill -KILL "$pid" 2>/dev/null || true
    fi
else
    echo "No apt-mirror process found, but lock file exists"
fi

echo "Killing any remaining apt-mirror2 processes..."
remaining=$(runner_pids)
if [ -n "$remaining" ]; then
    # shellcheck disable=SC2086
    kill -TERM $remaining 2>/dev/null || true
    sleep 2
    remaining=$(runner_pids)
    # shellcheck disable=SC2086
    [ -n "$remaining" ] && kill -KILL $remaining 2>/dev/null || true
fi

# Only the stopped run's lock: a sync started meanwhile wrote its own PID there.
if [ "$(cat "$LOCK_FILE" 2>/dev/null || true)" = "$sync_pid" ]; then
    rm -f "$LOCK_FILE"
fi

echo "Mirror sync stopped successfully"
exit 0
