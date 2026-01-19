#!/bin/bash

echo "🎧 Clara Setup Script"
echo "====================="
echo ""

# Check Python version
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "✓ Found Python $python_version"

# Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."
pip install -r requirements.txt --break-system-packages --quiet

if [ $? -eq 0 ]; then
    echo "✓ Python dependencies installed"
else
    echo "✗ Failed to install Python dependencies"
    exit 1
fi

# Check for Piper
echo ""
echo "🔍 Checking for Piper TTS..."
if command -v piper &> /dev/null; then
    echo "✓ Piper TTS found"
else
    echo "✗ Piper TTS not found"
    echo ""
    echo "Please install Piper TTS:"
    echo "  macOS: brew install piper-tts"
    echo "  Linux: Download from https://github.com/rhasspy/piper/releases"
    echo ""
fi

# Check for Ollama
echo ""
echo "🔍 Checking for Ollama..."
if command -v ollama &> /dev/null; then
    echo "✓ Ollama found"
    
    # Check if llama3.2 model is available
    echo "  Checking for llama3.2 model..."
    if ollama list | grep -q "llama3.2"; then
        echo "  ✓ llama3.2 model found"
    else
        echo "  ⚠ llama3.2 model not found"
        echo "  Run: ollama pull llama3.2"
    fi
else
    echo "✗ Ollama not found"
    echo ""
    echo "Please install Ollama from https://ollama.ai"
    echo "Then run: ollama pull llama3.2"
    echo ""
fi

echo ""
echo "🔨 Building executable with PyInstaller..."
pip install pyinstaller --break-system-packages --quiet

# Create spec file for better control
cat > clara.spec << 'EOF'
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('templates', 'templates'),
        ('static', 'static'),
    ],
    hiddenimports=[
        'flask',
        'pywebview',
        'pypdf',
        'sentence_transformers',
        'chromadb',
        'werkzeug',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='Clara',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

app = BUNDLE(
    exe,
    name='Clara.app',
    icon=None,
    bundle_identifier='com.clara.readingcompanion',
)
EOF

pyinstaller clara.spec --clean --noconfirm

if [ $? -eq 0 ]; then
    echo "✓ Executable built successfully"
    echo ""
    echo "📍 Location: dist/Clara.app (macOS) or dist/Clara (Linux/Windows)"
else
    echo "✗ Build failed"
    exit 1
fi

echo ""
echo "✨ Setup complete!"
echo ""
echo "To run Clara:"
echo "  python3 app.py"
echo ""
echo "Or use the executable:"
echo "  ./dist/Clara.app/Contents/MacOS/Clara (macOS)"
echo "  ./dist/Clara (Linux)"
echo ""
