# Clara - Your Reading Companion

A minimal, elegant desktop app for intelligent document reading with AI-powered comprehension assistance.

![Clara](https://via.placeholder.com/800x400/FAFAFA/0071E3?text=Clara)

## Features

- 🎧 **Natural Text-to-Speech** - Listen to your documents with high-quality voice synthesis
- 💬 **Ask Questions** - Get instant answers about your document content using AI
- 📄 **Multi-Format Support** - PDF, TXT, and Markdown files
- 🎨 **Beautiful Interface** - Minimal, Apple-inspired design
- 🔒 **Privacy-First** - Everything runs locally on your machine
- ⚡ **Fast & Responsive** - No cloud processing, instant responses

## Prerequisites

Before installing Clara, you need:

### 1. Python 3.8+
```bash
python3 --version
```

### 2. Piper TTS (for voice generation)

**macOS:**
```bash
brew install piper-tts
```

**Linux:**
Download from [Piper Releases](https://github.com/rhasspy/piper/releases)

**Recommended voices:**
- `en_US-lessac-medium` (female, clear)
- `en_US-amy-medium` (female, natural)
- `en_US-ryan-medium` (male, professional)

Download voices from: https://github.com/rhasspy/piper/releases/tag/v1.2.0

### 3. Ollama (for AI question answering)

**macOS/Linux:**
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Download the model
ollama pull llama3.2
```

Visit [ollama.ai](https://ollama.ai) for more info.

## Installation

### Quick Start

1. **Clone or download this repository**
```bash
cd clara
```

2. **Install Python dependencies**
```bash
pip install -r requirements.txt
```

3. **Run Clara**
```bash
python3 app.py
```

Or use the convenience script:
```bash
./run.sh
```

### Building Executable (Optional)

To create a standalone executable:

```bash
./setup.sh
```

This will create:
- **macOS**: `dist/Clara.app`
- **Linux/Windows**: `dist/Clara`

## Usage

### Starting Clara

1. Launch the app: `python3 app.py` or run the executable
2. Upload a document (PDF, TXT, or MD)
3. Click play to start listening
4. Ask questions anytime using the input box

### Keyboard Shortcuts

- **Space** - Play/Pause
- **←** - Previous section
- **→** - Next section
- **Enter** (in question box) - Ask question

### Supported File Types

- **PDF** - Extracts text from any PDF document
- **TXT** - Plain text files
- **MD** - Markdown documents

## How It Works

Clara uses a sophisticated pipeline to provide intelligent reading:

1. **Document Processing**
   - Extracts and chunks text semantically
   - Creates vector embeddings for efficient search

2. **Text-to-Speech**
   - Uses Piper TTS for natural voice synthesis
   - Streams audio chunk by chunk for smooth playback

3. **Question Answering (RAG)**
   - Retrieves relevant document sections using vector similarity
   - Generates contextual answers using Llama 3.2

## Architecture

```
┌─────────────────────────────────────┐
│         Clara Desktop App           │
│  ┌──────────────────────────────┐   │
│  │   PyWebView UI (HTML/CSS/JS) │   │
│  └──────────────────────────────┘   │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│      Flask Backend (Python)         │
│                                     │
│  ┌────────────┐  ┌──────────────┐  │
│  │ Document   │  │ Text         │  │
│  │ Parser     │→ │ Chunker      │  │
│  │ (pypdf)    │  │              │  │
│  └────────────┘  └──────────────┘  │
│         │               │           │
│         ▼               ▼           │
│  ┌────────────┐  ┌──────────────┐  │
│  │ Piper TTS  │  │ Ollama LLM   │  │
│  │ (audio)    │  │ + ChromaDB   │  │
│  └────────────┘  └──────────────┘  │
└─────────────────────────────────────┘
```

## Customization

### Change Voice

Edit `app.py` and modify the `voice` parameter in `generate_audio()`:

```python
def generate_audio(text, voice="en_US-lessac-medium"):
```

Available voices (download separately):
- `en_US-lessac-medium`
- `en_US-amy-medium`
- `en_US-ryan-medium`
- `en_US-ljspeech-medium`

### Change AI Model

Edit `app.py` and modify the model in `call_ollama()`:

```python
process = subprocess.Popen(
    ['ollama', 'run', 'llama3.2', full_prompt],  # Change 'llama3.2' here
```

Other options:
- `llama3.2` - Fast, efficient (default)
- `mistral` - Alternative, good quality
- `phi3` - Smaller, faster

### UI Customization

Edit `static/css/style.css` to change colors, fonts, or layout:

```css
:root {
    --color-accent: #0071E3;  /* Change primary color */
    --color-bg: #FAFAFA;       /* Background color */
    /* ... */
}
```

## Troubleshooting

### "Piper not found"
Install Piper TTS (see Prerequisites). Make sure it's in your PATH.

### "Ollama not found"
Install Ollama and pull a model:
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2
```

### "Failed to create embeddings"
The embedding model downloads automatically on first run. Ensure you have internet connection.

### Audio playback issues
- Check that Piper is installed correctly: `piper --version`
- Try a different voice model
- Ensure your system audio is working

### Slow performance
- Use a smaller Ollama model (phi3)
- Reduce chunk size in `chunk_text()` function
- Ensure you have enough RAM (4GB+ recommended)

## Development

### Project Structure
```
clara/
├── app.py              # Main application
├── templates/
│   └── index.html      # UI template
├── static/
│   ├── css/
│   │   └── style.css   # Styles
│   └── js/
│       └── app.js      # Client logic
├── requirements.txt    # Python deps
├── setup.sh           # Build script
├── run.sh             # Quick launcher
└── README.md          # This file
```

### Running in Development

```bash
# Install dev dependencies
pip install -r requirements.txt

# Run with debug mode
FLASK_DEBUG=1 python3 app.py
```

## Technical Details

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Python 3.8+, Flask
- **UI Framework**: PyWebView (native window)
- **TTS Engine**: Piper (fast, local)
- **LLM**: Ollama (local inference)
- **Embeddings**: sentence-transformers (all-MiniLM-L6-v2)
- **Vector DB**: ChromaDB (in-memory)

## Privacy & Data

Clara is built with privacy in mind:

- ✅ All processing happens locally
- ✅ No data sent to external servers
- ✅ No user tracking or analytics
- ✅ Documents stay on your machine
- ✅ Open source and auditable

## License

MIT License - feel free to modify and distribute.

## Credits

Built with:
- [Piper TTS](https://github.com/rhasspy/piper) - Fast, local text-to-speech
- [Ollama](https://ollama.ai) - Local LLM inference
- [ChromaDB](https://www.trychroma.com/) - Vector database
- [Sentence Transformers](https://www.sbert.net/) - Embeddings

---

Made with ❤️ for better reading experiences.
