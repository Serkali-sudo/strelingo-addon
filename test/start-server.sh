#!/bin/bash
# Start the Strelingo addon server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/server.pid"
LOG_FILE="$PROJECT_DIR/server.log"

# Check if server is already running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null 2>&1; then
        echo "Server is already running (PID: $PID)"
        exit 1
    else
        echo "Removing stale PID file"
        rm -f "$PID_FILE"
    fi
fi

# Start server
cd "$PROJECT_DIR"
echo "Starting server..."
echo "Log file: $LOG_FILE"

# Start node in background, redirect output to log file
nohup node index.js > "$LOG_FILE" 2>&1 &
PID=$!

# Save PID
echo $PID > "$PID_FILE"

# Wait for server to start responding (up to 60 seconds)
echo "Waiting for server to start responding..."
for i in {1..60}; do
    if ! ps -p $PID > /dev/null 2>&1; then
        echo "Server process died. Check $LOG_FILE for errors"
        rm -f "$PID_FILE"
        exit 1
    fi

    if curl -s http://localhost:7000 > /dev/null 2>&1; then
        echo "Server is ready and responding (PID: $PID)"
        echo "Access at: http://localhost:7000"
        echo "Logs: tail -f $LOG_FILE"
        exit 0
    fi

    sleep 1
done

echo "Server started but not responding after 60 seconds"
echo "Check logs: tail -f $LOG_FILE"
exit 1
