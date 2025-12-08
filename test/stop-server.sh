#!/bin/bash
# Stop the Strelingo addon server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/server.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "Server is not running (no PID file found)"
    exit 0
fi

PID=$(cat "$PID_FILE")

if ! ps -p $PID > /dev/null 2>&1; then
    echo "Server is not running (process $PID not found)"
    rm -f "$PID_FILE"
    exit 0
fi

echo "Stopping server (PID: $PID)..."
kill $PID

# Wait for process to terminate
for i in {1..10}; do
    if ! ps -p $PID > /dev/null 2>&1; then
        echo "Server stopped successfully"
        rm -f "$PID_FILE"
        exit 0
    fi
    sleep 0.5
done

# Force kill if still running
if ps -p $PID > /dev/null 2>&1; then
    echo "Server not responding, forcing stop..."
    kill -9 $PID
    sleep 1
fi

rm -f "$PID_FILE"
echo "Server stopped"
