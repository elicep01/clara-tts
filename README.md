# Clara - Your Reading Companion

A desktop application for reading documents with text-to-speech capabilities and AI-powered question answering.

## Features

- Text-to-speech reading for PDF, TXT, and Markdown files
- Word-by-word highlighting during playback
- AI-powered document Q&A with local LLM
- Advanced multi-source table of contents extraction
  - Extracts from native PDF metadata (most accurate)
  - Parses table of contents pages (works with books, textbooks, manuals)
  - Font-based structural analysis (works with any PDF)
  - Supports 13+ TOC format patterns
  - Progressive loading for instant display
- Continuous scrolling through pages
- Dictionary lookup for words
- All AI processing happens locally on your machine

## First Launch

When you run Clara for the first time, it will automatically download a base AI model (approximately 2 GB). This one-time setup enables:

- Asking questions about your documents
- Smart table of contents extraction
- Intelligent text processing
- Context-aware reading features

The download takes about 5-10 minutes on a typical internet connection. You can skip this step, but Clara works best with AI features enabled.

## System Requirements

- Python 3.8 or higher
- Poppler (system library for PDF rendering)
- Internet connection (for initial setup only)

## Installation

### Quick Start

The easiest way to install Clara is to use the automated installation script:

**On macOS or Linux:**
```bash
bash install.sh
```

**On Windows:**
```cmd
install.bat
```

The script will install all Python dependencies and check for system requirements. If anything is missing, it will provide installation instructions.

### Manual Installation

If you prefer to install manually, follow these steps:

#### Step 1: Install Python Dependencies

```bash
pip install -r requirements.txt
```

#### Step 2: Install Poppler

Poppler is required for rendering PDF pages as images. Without it, PDFs will only display as text.

**On macOS:**

Install using Homebrew:
```bash
brew install poppler
```

If you don't have Homebrew, install it first from https://brew.sh

**On Windows:**

1. Download the latest release from: https://github.com/oschwartz10612/poppler-windows/releases/
2. Extract the ZIP file to `C:\Program Files\poppler`
3. Add the bin directory to your PATH:
   - Open System Properties (Win + X, then System)
   - Click "Advanced system settings"
   - Click "Environment Variables"
   - Under "System variables", find and select "Path"
   - Click "Edit"
   - Click "New"
   - Add: `C:\Program Files\poppler\Library\bin`
   - Click OK on all dialogs
4. Restart your computer for the PATH changes to take effect

**On Linux:**

Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install poppler-utils
```

Fedora:
```bash
sudo dnf install poppler-utils
```

Arch Linux:
```bash
sudo pacman -S poppler
```

#### Step 3: Verify Poppler Installation

Open a new terminal window and run:
```bash
pdftoppm -v
```

You should see the Poppler version information. If you get an error, review the installation steps above.

## Running Clara

After installation, start the application with:

```bash
python app.py
```

On startup, Clara will check all dependencies and display their status. If any required dependencies are missing, you will see detailed installation instructions.

The application will open in a desktop window. You can then upload documents and use the controls to read or navigate.

## Controls

- Play/Pause button: Start or stop reading
- Speed control: Adjust playback rate
- Previous/Next buttons: Navigate between pages
- Sync button: Jump to current reading position
- Question input: Ask questions about document content
- Table of Contents: Navigate to any section of your document

## Table of Contents Extraction

Clara uses a sophisticated multi-source approach to extract table of contents from any PDF:

### Extraction Methods (Priority Order)

1. **Native PDF TOC** - Reads embedded navigation from PDF metadata (most accurate)
2. **TOC Page Parsing** - Extracts actual page numbers from table of contents pages
   - Supports 13+ format patterns including:
     - "Chapter 1: Introduction ............... 15"
     - "1.1 Overview ........................... 42"
     - "Part I: Getting Started ------------- 15"
     - Tabbed formats, numbered sections, and more
3. **Font-Based Analysis** - Analyzes text styling to identify headings
   - Adaptive font size detection
   - Works with academic papers, novels, manuals, reports
   - Skips front matter to avoid confusion

### Progressive Loading

- Quick TOC displays in under 0.5 seconds for instant navigation
- Enhanced TOC loads in background with better accuracy
- Results are cached for fast subsequent access

### Works With

- Academic papers (Abstract, Introduction, Methods, Results)
- Textbooks and "For Dummies" series
- O'Reilly technical books
- Novels and fiction
- Corporate reports and manuals
- Technical documentation
- Any PDF with structured headings

## Dependencies

### Required Python Packages

These are installed automatically via `requirements.txt`:

- flask - Web framework for the application backend
- pywebview - Creates the desktop window
- pypdf - Parses PDF files
- pymupdf - Extracts table of contents and metadata
- pdf2image - Converts PDF pages to images (requires Poppler)
- sentence-transformers - AI embeddings for semantic search
- chromadb - Vector database for document storage
- werkzeug - WSGI utilities (Flask dependency)
- numpy - Numerical computing (AI dependency)

### Optional Python Packages

These enhance functionality but are not required:

- edge-tts - Microsoft neural voices for better text-to-speech quality (Falls back to system TTS if not installed)
- llama-cpp-python - Local AI for question answering (Falls back to search-only mode if not installed)

### System Dependencies

These must be installed separately on your system:

- Poppler - Required for PDF image rendering (see installation instructions above)

## Data Storage

Clara stores all data locally in `~/Documents/Clara/`:

- `documents/` - Uploaded document files
- `thumbnails/` - PDF page thumbnails
- `toc_cache/` - Table of contents extraction cache
- `voices/` - TTS voice cache
- `models/` - AI model files
- `audio_cache/` - Generated audio files
- `clara.db` - SQLite database
- `config.json` - Application configuration

## Troubleshooting

### Poppler Not Found

If you see "Poppler NOT FOUND" on startup:

1. Follow the Poppler installation instructions for your operating system (see Step 2 above)
2. Verify installation by running `pdftoppm -v` in a new terminal
3. On Windows, make sure you added the correct path: `C:\Program Files\poppler\Library\bin` (note the `\Library\bin` subdirectory)
4. On Windows, restart your computer after changing PATH
5. Restart Clara

### PDF Pages Show Text Instead of Images

This means Poppler is not properly installed. Follow the Poppler installation steps above.

### Import Errors

If you see errors like "ModuleNotFoundError: No module named 'flask'":

1. Make sure you installed all dependencies: `pip install -r requirements.txt`
2. If using a virtual environment, make sure it is activated
3. Try reinstalling: `pip install -r requirements.txt --force-reinstall`

### Edge TTS Not Available

This is normal if you haven't installed edge-tts. Clara will use your system's built-in text-to-speech. To use higher quality neural voices:

```bash
pip install edge-tts
```

### Permission Errors (macOS/Linux)

If you see permission errors during installation:

```bash
pip install --user -r requirements.txt
```

### Virtual Environment Setup (Optional)

If you want to use a virtual environment:

```bash
# Create virtual environment
python -m venv venv

# Activate it
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run Clara
python app.py
```

## Platform-Specific Notes

### macOS
- Tested on macOS 10.13 (High Sierra) and newer
- Uses WebKit (Safari) for rendering
- System TTS uses the `say` command as fallback

### Windows
- Tested on Windows 10 and newer
- Uses Edge WebView2 for rendering (included with Windows 10+)
- Poppler installation requires adding to PATH and restarting

### Linux
- Tested on Ubuntu, Fedora, and Arch Linux
- PyWebView requires GTK+ 3.0 (usually pre-installed)
- If needed, install GTK:
  - Ubuntu/Debian: `sudo apt-get install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.0`
  - Fedora: `sudo dnf install python3-gobject gtk3 webkit2gtk3`

## Project Structure

```
clara_2/
├── app.py                  # Main application file
├── requirements.txt        # Python dependencies
├── install.sh             # Installation script (macOS/Linux)
├── install.bat            # Installation script (Windows)
├── templates/
│   └── index.html         # Main UI template
└── static/
    ├── css/
    │   └── style.css
    └── js/
        ├── app.js
        └── modules/       # Modular JavaScript components
```

## Technical Details

- Backend: Python Flask
- Frontend: HTML, CSS, JavaScript (ES modules)
- Desktop UI: PyWebView (native window wrapper)
- Text-to-Speech: Edge TTS or system TTS
- AI: Local LLM via llama-cpp-python
- Vector Embeddings: sentence-transformers
- Vector Database: ChromaDB
- PDF Processing: PyMuPDF and pdf2image

## First Run

When you first run Clara:

1. Dependency Check: Clara will verify all dependencies and display their status
2. Storage Initialization: Creates the `~/Documents/Clara/` directory structure
3. Model Download: If using Q&A features, TinyLlama model (670MB) downloads automatically on first use
4. Ready: The application window opens and you can start uploading documents

## License

MIT
