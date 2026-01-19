#!/bin/bash

echo "🎧 Starting Clara..."
echo ""

# Check dependencies
if ! command -v piper &> /dev/null; then
    echo "⚠ Warning: Piper TTS not found"
    echo "Install from: https://github.com/rhasspy/piper"
    echo ""
fi

if ! command -v ollama &> /dev/null; then
    echo "⚠ Warning: Ollama not found"
    echo "Install from: https://ollama.ai"
    echo ""
fi

# Install Python dependencies if needed
if ! python3 -c "import flask" 2>/dev/null; then
    echo "📦 Installing dependencies..."
    pip install -r requirements.txt --break-system-packages --quiet
fi

# Run Clara
python3 app.py
