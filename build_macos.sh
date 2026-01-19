#!/bin/bash
#
# Clara Desktop App - macOS Build Script
# Creates a distributable .app bundle for macOS
#

set -e

echo "================================"
echo "Clara - macOS Build Script"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}Error: This script must be run on macOS${NC}"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check Python
echo "Checking Python..."
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    exit 1
fi
PYTHON_VERSION=$(python3 --version)
echo -e "${GREEN}Found: $PYTHON_VERSION${NC}"

# Create/activate virtual environment
echo ""
echo "Setting up virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

# Install dependencies
echo ""
echo "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

# Clean previous builds
echo ""
echo "Cleaning previous builds..."
rm -rf build dist

# Build the app
echo ""
echo "Building Clara.app..."
echo "This may take several minutes..."
echo ""

pyinstaller clara.spec --clean --noconfirm

# Check if build was successful
if [ -d "dist/Clara.app" ]; then
    echo ""
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}Build successful!${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo "Your app is ready at:"
    echo "  $SCRIPT_DIR/dist/Clara.app"
    echo ""
    echo "To share with friends:"
    echo "  1. Right-click on Clara.app and choose 'Compress'"
    echo "  2. Share the Clara.zip file"
    echo ""
    echo "To install:"
    echo "  1. Drag Clara.app to the Applications folder"
    echo "  2. On first run, right-click and choose 'Open'"
    echo "     (required because the app is not code-signed)"
    echo ""

    # Open the dist folder
    open dist/
else
    echo ""
    echo -e "${RED}Build failed!${NC}"
    echo "Check the output above for errors."
    exit 1
fi
