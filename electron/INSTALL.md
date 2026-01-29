# Clara Electron - Installation Guide

Complete guide to set up and run the Electron version of Clara.

## Prerequisites

1. **Node.js 18+** and npm
   ```bash
   node --version  # Should be 18 or higher
   npm --version
   ```

2. **edge-tts** (for text-to-speech)
   ```bash
   pip install edge-tts
   edge-tts --version  # Verify installation
   ```

3. **Python 3.8+** (for edge-tts)
   ```bash
   python3 --version
   ```

## Installation Steps

### 1. Navigate to electron folder
```bash
cd electron
```

### 2. Install Node dependencies
```bash
npm install
```

This will install:
- Electron
- TypeScript
- better-sqlite3 (database)
- pdf-parse (PDF processing)
- pdf-lib (PDF utilities)
- socket.io (for study sessions)

### 3. Copy renderer files
```bash
chmod +x setup-renderer.sh
./setup-renderer.sh
```

This script copies all the frontend files (HTML, CSS, JS) from the web version and adapts them for Electron.

### 4. Build TypeScript
```bash
npm run build
```

This compiles the TypeScript main process and preload scripts.

### 5. Run the app
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

## Project Structure After Setup

```
electron/
├── src/                    # TypeScript source
│   ├── main/              # Main process (backend)
│   │   ├── index.ts       # Entry point
│   │   ├── database.ts    # SQLite DB
│   │   ├── ipc.ts         # IPC handlers
│   │   ├── pdf.ts         # PDF processing
│   │   ├── tts.ts         # Text-to-speech
│   │   └── ai.ts          # Gemini AI
│   └── preload/           # Preload scripts
│       └── index.ts       # IPC bridge
├── dist/                  # Compiled JS
├── renderer/              # Frontend files
│   ├── index.html
│   ├── electron-adapter.js
│   └── static/           # CSS, JS modules
├── node_modules/         # Dependencies
└── package.json
```

## Data Storage

All Clara data is stored in:
- **macOS**: `~/Library/Application Support/Clara/`
- **Windows**: `%APPDATA%/Clara/`
- **Linux**: `~/.config/Clara/`

## Building Distributables

### For current platform
```bash
npm run package
```

### For specific platforms
```bash
npm run package:mac     # macOS DMG/ZIP
npm run package:win     # Windows installer
npm run package:linux   # Linux AppImage/deb
```

Built apps will be in the `build/` folder.

## Troubleshooting

### "edge-tts not found"
Install edge-tts globally:
```bash
pip install edge-tts
```

### "Cannot find module 'better-sqlite3'"
Rebuild native modules:
```bash
npm rebuild better-sqlite3
```

### TypeScript errors in IDE
Install dependencies first:
```bash
npm install
```

### Frontend not loading
Re-run the setup script:
```bash
./setup-renderer.sh
```

## Development

### Watch mode for TypeScript
```bash
npm run build:main -- --watch
```

### Debug with DevTools
The app automatically opens DevTools in development mode.

## Features

All features from the web version work in Electron:
- ✅ PDF library management
- ✅ Text-to-speech with word highlighting
- ✅ Notes and annotations
- ✅ AI Q&A with Gemini
- ✅ Pomodoro timer
- ✅ Study sessions (collaborative reading)
- ✅ Smart table of contents
- ✅ Reading settings

## Performance

The Electron version is faster than the web version because:
- No Flask server overhead
- Native Node.js modules
- Direct file system access
- Better caching

## Next Steps

1. Run `npm install`
2. Run `./setup-renderer.sh`
3. Run `npm start`
4. Enjoy Clara as a native desktop app!
