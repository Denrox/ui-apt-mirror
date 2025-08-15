#!/bin/bash

# Stop mirror sync script
# This script stops all apt-mirror2 related processes

set -e

# Check if mirror is running
if [ ! -f "/var/run/apt-mirror.lock" ]; then
    echo "No mirror sync process running"
    exit 1
fi

echo "Stopping mirror sync..."

pid=$(pgrep -f "/usr/bin/python3.*apt-mirror" | head -1)
if [ -z "$pid" ]; then
    pid=$(pgrep -f "python3.*apt-mirror" | head -1)
fi
if [ -z "$pid" ]; then
    pid=$(pgrep -f "python.*apt-mirror" | head -1)
fi

if [ -n "$pid" ]; then
    echo "Found apt-mirror process with PID: $pid"
    
    echo "Sending TERM signal..."
    kill -TERM "$pid"
    
    sleep 3
    
    if kill -0 "$pid" 2>/dev/null; then
        echo "Process still running, sending KILL signal..."
        kill -KILL "$pid"
    fi
else
    echo "No apt-mirror process found, but lock file exists"
fi

echo "Killing any remaining apt-mirror2 processes..."
pkill -TERM -f "apt-mirror2" 2>/dev/null || true
sleep 2
pkill -KILL -f "apt-mirror2" 2>/dev/null || true

rm -f "/var/run/apt-mirror.lock"

echo "Mirror sync stopped successfully"
exit 0
