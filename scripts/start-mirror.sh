#!/bin/bash

# Start mirror sync script
# This script starts the apt-mirror2 process in the background

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if mirror is already running
if [ -f "/var/run/apt-mirror.lock" ]; then
    echo "Mirror sync is already running"
    exit 1
fi

# Start the mirror sync process and properly detach it
echo "Starting mirror sync..."
nohup "$SCRIPT_DIR/mirror-sync.sh" &
disown

echo "Mirror sync started successfully"
exit 0
