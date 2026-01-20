# Python Version Compatibility Guide

## Recommended Python Version
Clara works best with **Python 3.10 or later**.

## Python 3.9 Support
If you're using Python 3.9.6, you need to use the compatible requirements file:

```bash
# Instead of:
pip install -r requirements.txt

# Use:
pip install -r requirements-py39.txt
```

## Known Issues with Python 3.9

### 1. Flask 3.0+ Not Compatible
- **Issue**: Flask 3.0 requires Python 3.10+
- **Solution**: Use Flask 2.3.x (included in requirements-py39.txt)

### 2. ChromaDB Compatibility
- **Issue**: ChromaDB 0.5+ may have issues on Python 3.9
- **Solution**: Use ChromaDB 0.4.x (included in requirements-py39.txt)

### 3. Type Hints and Pattern Matching
- **Issue**: Some code uses Python 3.10+ features
- **Solution**: These features are only in development scripts, not core Clara code

## Troubleshooting

### If features are missing after installation:

1. **Check Python version:**
   ```bash
   python3 --version
   ```

2. **Reinstall with correct requirements:**
   ```bash
   pip uninstall -y flask chromadb werkzeug sentence-transformers
   pip install -r requirements-py39.txt
   ```

3. **Verify all packages installed:**
   ```bash
   pip list | grep -E "flask|chromadb|pymupdf|pywebview"
   ```

4. **Check for import errors:**
   ```bash
   python3 -c "import flask; import fitz; import chromadb; import pywebview; print('All imports successful')"
   ```

### Missing Features Checklist

If your friend is missing features, check:

- ✅ **Dictionary (right-click on text)** - Requires PyWebView working
- ✅ **Table of Contents** - Requires PyMuPDF (fitz) installed
- ✅ **TTS Reading** - Requires edge-tts installed
- ✅ **Q&A Feature** - Requires chromadb and sentence-transformers

### Common Error Messages

**"No module named 'fitz'"**
```bash
pip install pymupdf
```

**"No module named 'chromadb'"**
```bash
pip install chromadb==0.4.24
```

**"Flask version incompatible"**
```bash
pip install flask==2.3.7
```

## Upgrading Python (Recommended)

For the best experience, upgrade to Python 3.10 or 3.11:

### macOS (using Homebrew):
```bash
brew install python@3.11
```

### Ubuntu/Debian:
```bash
sudo apt update
sudo apt install python3.11
```

### Windows:
Download from [python.org](https://www.python.org/downloads/)

## After Upgrading Python

```bash
# Create fresh virtual environment
python3.11 -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Install regular requirements
pip install -r requirements.txt

# Run Clara
python3 app.py
```

## Still Having Issues?

Open an issue on GitHub with:
1. Your Python version (`python3 --version`)
2. Your OS (macOS, Linux, Windows)
3. The error message you're seeing
4. Output of `pip list`
