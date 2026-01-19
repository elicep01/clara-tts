# Clara - Document Reader with TTS

A document reader application with text-to-speech capabilities and AI-powered question answering.

## Features

- Text-to-Speech reading for PDF, TXT, and Markdown files
- Word-by-word highlighting during playback
- Ask questions about document content using AI
- Continuous scrolling through pages
- Table of contents navigation
- Dictionary lookup for words

## Requirements

- Python 3.8 or higher
- Piper TTS for voice synthesis
- Ollama for AI question answering

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Install Piper TTS:
```bash
# macOS
brew install piper-tts

# Linux - download from https://github.com/rhasspy/piper/releases
```

3. Install Ollama and download a model:
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2
```

## Usage

Run the application:
```bash
python3 app.py
```

The app will open in a window. Upload a document and use the controls to read or navigate.

### Controls

- Play/Pause button to control reading
- Speed control for playback rate
- Previous/Next buttons to navigate pages
- Sync button to return to current reading position
- Question input to ask about document content

## Project Structure

```
clara_2/
├── app.py              # Main Flask application
├── templates/
│   └── index.html      # Main UI template
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       └── modules/    # Modular JavaScript components
└── requirements.txt
```

## Technical Details

- Backend: Python Flask
- Frontend: HTML, CSS, JavaScript (ES modules)
- TTS: Piper
- LLM: Ollama (local)
- Vector embeddings: sentence-transformers
- Vector database: ChromaDB

## License

MIT
