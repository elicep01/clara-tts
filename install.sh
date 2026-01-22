#!/bin/bash
# Clara Installation Script for macOS/Linux
# Run with: bash install.sh

set -e  # Exit on error

echo "=================================================="
echo "Clara Installation Script"
echo "=================================================="
echo ""

# Check Python version
echo "Checking Python version..."
if command -v python3 &> /dev/null; then
    PYTHON_CMD=python3
    PIP_CMD=pip3
elif command -v python &> /dev/null; then
    PYTHON_CMD=python
    PIP_CMD=pip
else
    echo "❌ Python not found. Please install Python 3.8 or higher."
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
echo "✓ Found Python $PYTHON_VERSION"

# Check pip
echo ""
echo "Checking pip..."
if ! command -v $PIP_CMD &> /dev/null; then
    echo "❌ pip not found. Please install pip."
    exit 1
fi
echo "✓ pip is available"

# Install Python dependencies
echo ""
echo "Installing Python dependencies..."
echo "This may take a few minutes..."
$PIP_CMD install -r requirements.txt

echo ""
echo "✓ Python dependencies installed!"

# Check for poppler
echo ""
echo "Checking for poppler..."
if command -v pdftoppm &> /dev/null; then
    POPPLER_VERSION=$(pdftoppm -v 2>&1 | head -n 1)
    echo "✓ Poppler is installed: $POPPLER_VERSION"
else
    echo "⚠️  Poppler NOT found!"
    echo ""

    # Detect OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macOS detected"
        echo ""
        echo "Poppler is required for PDF image rendering."
        echo ""

        # Check for Homebrew
        if command -v brew &> /dev/null; then
            echo "Homebrew detected. Installing poppler..."
            brew install poppler
            echo "✓ Poppler installed successfully!"
        else
            echo "To install poppler, you need Homebrew."
            echo ""
            echo "Option 1: Install Homebrew, then poppler (recommended)"
            echo "  1. Install Homebrew:"
            echo "     /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
            echo "  2. Install poppler:"
            echo "     brew install poppler"
            echo ""
            echo "Option 2: Use MacPorts"
            echo "  sudo port install poppler"
            echo ""
            read -p "Would you like to open Homebrew installation page? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                open "https://brew.sh"
            fi
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Linux detected"
        echo ""
        echo "Poppler is required for PDF image rendering."
        echo ""

        # Detect Linux distribution
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            case "$ID" in
                ubuntu|debian)
                    echo "Installing poppler for Ubuntu/Debian..."
                    sudo apt-get update
                    sudo apt-get install -y poppler-utils
                    ;;
                fedora|rhel|centos)
                    echo "Installing poppler for Fedora/RHEL..."
                    sudo dnf install -y poppler-utils
                    ;;
                arch|manjaro)
                    echo "Installing poppler for Arch..."
                    sudo pacman -S --noconfirm poppler
                    ;;
                *)
                    echo "Please install poppler manually for your distribution:"
                    echo "  Ubuntu/Debian: sudo apt-get install poppler-utils"
                    echo "  Fedora/RHEL:   sudo dnf install poppler-utils"
                    echo "  Arch:          sudo pacman -S poppler"
                    ;;
            esac
        fi
    fi
fi

# Final check
echo ""
echo "=================================================="
echo "Installation Complete!"
echo "=================================================="
echo ""

# Run dependency check
echo "Running final dependency check..."
echo ""
$PYTHON_CMD app.py --check-deps 2>/dev/null || true

echo ""
echo "=================================================="
echo "To start Clara, run:"
echo "   $PYTHON_CMD app.py"
echo "=================================================="
echo ""
