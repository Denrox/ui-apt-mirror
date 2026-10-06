#!/bin/bash

# Start mirror sync script
# This script starts the apt-mirror2 process in the background

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Script directory: $SCRIPT_DIR"

cd "$SCRIPT_DIR"

if ./mirror-sync.sh status | grep -q "^Sync running" || ! flock -n /var/run/apt-mirror.flock true; then
    echo "Mirror sync is already running"
    exit 1
fi

if ! grep -qE '^[[:space:]]*deb(-src)?[[:space:]]' /etc/apt/mirror.list 2>/dev/null; then
    echo "No repositories are enabled"
    exit 1
fi

# One sync in the background; the scheduled loop started at boot keeps running on its own.
nohup ./mirror-sync.sh once > /dev/null 2>&1 &

echo "Mirror sync started successfully"
exit 0
