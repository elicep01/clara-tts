#!/bin/bash

# Script to copy web files to electron renderer folder

echo "Setting up Electron renderer..."

# Create renderer folder structure
mkdir -p renderer/static/css
mkdir -p renderer/static/js/modules
mkdir -p renderer/templates

# Copy static files from parent directory
echo "Copying static files..."
cp -r ../static/css/* renderer/static/css/
cp -r ../static/js/*.js renderer/static/js/
cp -r ../static/js/modules/* renderer/static/js/modules/

# Copy and modify index.html
echo "Copying HTML template..."
cp ../templates/index.html renderer/index.html

# Inject electron adapter before app.js
echo "Injecting Electron adapter..."
sed -i.bak 's|<script type="module" src="/static/js/app.js"></script>|<script src="./electron-adapter.js"></script>\n    <script type="module" src="./static/js/app.js"></script>|g' renderer/index.html

# Update paths in HTML (remove leading /)
sed -i.bak 's|href="/static/|href="./static/|g' renderer/index.html
sed -i.bak 's|src="/static/|src="./static/|g' renderer/index.html

# Remove backup file
rm renderer/index.html.bak

echo "✅ Renderer setup complete!"
echo ""
echo "Files copied:"
echo "  - CSS stylesheets"
echo "  - JavaScript modules"
echo "  - HTML template (with Electron adapter injected)"
echo ""
echo "Next steps:"
echo "  1. cd electron"
echo "  2. npm install"
echo "  3. npm run dev"
