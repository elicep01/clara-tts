# Clara - Electron Desktop App

Your Reading Companion, now as a native desktop application!

## Features

✓ **PDF Library Management** - Organize and browse your documents
✓ **Text-to-Speech** - Listen to your documents with natural voices (edge-tts)
✓ **Word Highlighting** - Follow along as text is read with synchronized highlighting
✓ **AI Q&A** - Ask questions about your documents (Gemini-powered)
✓ **Notes & Highlights** - Annotate and mark up your PDFs
✓ **Pomodoro Timer** - Built-in focus timer
✓ **Reading Settings** - Customize highlighting and auto-advance
✓ **Study Sessions** - Collaborative reading (coming soon)

## Quick Start

### First Time Setup

```bash
cd electron
npm install
npm start
```

### Running the App

**Fast launch** (if already built):
```bash
npm run quick
```

**Full build + launch**:
```bash
npm start
```

**Development mode** (with auto-rebuild):
```bash
# Terminal 1 - Watch for changes
npm run watch

# Terminal 2 - Launch app
npm run quick
```

## Adding Documents

1. Launch the app
2. Click the **"+"** button in the library
3. Select a PDF file
4. The document will be processed and added to your library

## Using Text-to-Speech

1. Open a document
2. Click the **Play** button at the bottom
3. Select your preferred voice in **Settings** (⚙️ icon)
4. Adjust reading speed with the speed controls

## AI Features

**Ask Questions:**
1. Open the **Q&A panel** (💬 icon while reading)
2. Type your question about the document
3. Clara uses Gemini AI to provide answers based on the content

**Word Definitions:**
1. **Double-click** any word while reading
2. Get instant AI-powered definitions

## Keyboard Shortcuts

- **Space** - Play/Pause reading
- **←/→** - Previous/Next page
- **Esc** - Close modals
- **Double-click word** - Get definition

## File Locations

- **Database**: `~/Library/Application Support/clara-electron/Clara/clara.db`
- **Documents**: `~/Library/Application Support/clara-electron/Clara/documents/`
- **Audio Cache**: `~/Library/Application Support/clara-electron/Clara/audio_cache/`

## Troubleshooting

### Window doesn't appear

If the app launches but you don't see a window:
1. Look for the Electron icon in your macOS Dock
2. Click it to bring the window to front
3. Or press **Cmd+Tab** and select Electron

### TTS not working

Make sure edge-tts is installed:
```bash
pip install edge-tts
```

### Build errors

If you see TypeScript or native module errors:
```bash
npm run build
./node_modules/.bin/electron-rebuild
```

## Development

### Project Structure

```
electron/
├── src/
│   ├── main/          # Main process (Node.js backend)
│   │   ├── index.ts   # Entry point
│   │   ├── database.ts # SQLite database
│   │   ├── ipc.ts     # IPC handlers
│   │   ├── pdf.ts     # PDF processing
│   │   ├── tts.ts     # Text-to-speech
│   │   └── ai.ts      # Gemini AI
│   └── preload/       # Preload script (security bridge)
│       └── index.ts
├── renderer/          # Frontend
│   ├── clara.html
│   ├── electron-adapter.js
│   └── static/
├── scripts/           # Python scripts for PDF processing
│   ├── extract_pdf_text.py
│   └── extract_pdf_words.py
└── dist/              # Compiled TypeScript
```

### Scripts

- `npm run build:main` - Compile main process
- `npm run build:preload` - Compile preload script
- `npm run build` - Compile everything
- `npm start` - Build and launch
- `npm run quick` - Launch without building
- `npm run watch` - Watch mode for development

## Tech Stack

- **Electron** - Desktop framework
- **TypeScript** - Type-safe JavaScript
- **better-sqlite3** - Fast SQLite database
- **PDF.js** - PDF rendering
- **PyMuPDF** - Accurate word extraction (via Python scripts)
- **edge-tts** - Microsoft Edge TTS engine
- **Gemini AI** - Google's AI for Q&A

## Prerequisites

- **Node.js** (v18+)
- **Python 3** with PyMuPDF: `pip install pymupdf`
- **edge-tts**: `pip install edge-tts`

## Building for Distribution

```bash
npm run package:mac     # macOS
npm run package:win     # Windows
npm run package:linux   # Linux
```

(Note: electron-builder not yet configured)

---

**Enjoy reading with Clara! 📚**
