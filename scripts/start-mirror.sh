#!/bin/bash

# Start mirror sync script
# This script starts the apt-mirror2 process in the background

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Script directory: $SCRIPT_DIR"

# Check if mirror is already running
if [ -f "/var/run/apt-mirror.lock" ]; then
    echo "Mirror sync is already running"
    exit 1
fi

echo "Executing: $SCRIPT_DIR/mirror-sync.sh"

# Start the process and immediately exit
cd "$SCRIPT_DIR"
nohup ./mirror-sync.sh > /dev/null 2>&1 &

echo "Mirror sync started successfully"
exit 0
