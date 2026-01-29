#!/bin/bash

echo "Launching Electron test app..."
echo "======================================"

cd "$(dirname "$0")"

# Kill any existing Electron processes
pkill -f "Electron.app" 2>/dev/null
sleep 1

# Launch in background
env -u ELECTRON_RUN_AS_NODE ../node_modules/.bin/electron . &
ELECTRON_PID=$!

echo "Waiting for app to start..."
sleep 3

echo ""
echo "Attempting to activate window using AppleScript..."
osascript -e 'tell application "System Events"
    set frontmost of first process whose name contains "Electron" to true
end tell' 2>/dev/null && echo "✓ Activated Electron" || echo "✗ Could not activate"

echo ""
echo "======================================"
echo "The app is running!"
echo ""
echo "If you still don't see a window:"
echo "1. Look for Electron icon in your Dock"
echo "2. Click the Electron icon"
echo "3. Or press Cmd+Tab and select Electron"
echo ""
echo "Press Enter to quit..."
read
echo "Shutting down..."
kill $ELECTRON_PID 2>/dev/null
pkill -f "Electron.app" 2>/dev/null
