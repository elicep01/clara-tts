#!/bin/bash
# Clara TTS Startup Script

cd "$(dirname "$0")"

echo "🎧 Starting Clara..."
echo ""

# Check if pdf2image is installed
python3 -c "from pdf2image import convert_from_path" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️  Warning: pdf2image not installed"
    echo "   Install it with: pip install pdf2image>=1.16.0"
    echo ""
fi

# Check if poppler is installed
if ! command -v pdftoppm &> /dev/null; then
    echo "⚠️  Warning: poppler not installed"
    echo "   On macOS: brew install poppler"
    echo "   On Linux: sudo apt-get install poppler-utils"
    echo ""
fi

# Start the application
python3 app.py
