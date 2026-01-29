#!/bin/bash

echo "Launching minimal Electron test..."
echo "You should see a purple window with 'Electron is Working!'"
echo "Press Ctrl+C to quit."
echo ""

cd "$(dirname "$0")"
env -u ELECTRON_RUN_AS_NODE ../node_modules/.bin/electron .
