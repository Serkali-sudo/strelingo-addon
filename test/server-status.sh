#!/bin/bash
# Check Strelingo addon server status

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/server.pid"
LOG_FILE="$PROJECT_DIR/server.log"

if [ ! -f "$PID_FILE" ]; then
    echo "Server is not running (no PID file)"
    exit 1
fi

PID=$(cat "$PID_FILE")

if ! ps -p $PID > /dev/null 2>&1; then
    echo "Server is not running (stale PID file)"
    exit 1
fi

echo "Server is running (PID: $PID)"
echo "Log file: $LOG_FILE"
echo ""
echo "Last 10 lines of log:"
tail -10 "$LOG_FILE" 2>/dev/null || echo "(log file not found or empty)"
