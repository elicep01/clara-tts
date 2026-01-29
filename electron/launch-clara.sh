#!/bin/bash

# Kill any existing Electron processes
pkill -f "Electron.app" 2>/dev/null

echo "Starting Clara Electron..."
echo "================================"
echo ""
echo "If you don't see a window appear within 5 seconds,"
echo "there might be an issue with the renderer loading."
echo ""
echo "Press Ctrl+C to quit when done testing."
echo ""

cd "$(dirname "$0")"

# Launch with development mode and without the problematic env var
NODE_ENV=development env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
