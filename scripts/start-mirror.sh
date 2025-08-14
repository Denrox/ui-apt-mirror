#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "/var/run/apt-mirror.lock" ]; then
    echo "Mirror sync is already running"
    exit 1
fi

echo "Starting mirror sync..."
"$SCRIPT_DIR/mirror-sync.sh" &

echo "Mirror sync started successfully"
exit 0
