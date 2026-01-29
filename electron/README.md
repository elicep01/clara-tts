# Clara Electron

Native desktop application version of Clara built with Electron and TypeScript.

## Features

- 📚 PDF document library management
- 🔊 Text-to-speech with word-by-word highlighting
- 📝 Notes and annotations
- 🤖 AI-powered Q&A with Gemini
- 📖 Smart table of contents extraction
- ⏱️ Pomodoro timer for focused reading
- 👥 Collaborative study sessions (real-time sync)
- 🎨 Beautiful, native UI

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

```bash
cd electron
npm install
```

## Development

```bash
npm run dev
```

## Building

### Build for current platform
```bash
npm run package
```

### Build for specific platform
```bash
npm run package:mac    # macOS
npm run package:win    # Windows
npm run package:linux  # Linux
```

## Project Structure

```
electron/
├── src/
│   ├── main/           # Main process (Node.js backend)
│   │   ├── index.ts    # Entry point
│   │   ├── database.ts # SQLite database
│   │   ├── pdf.ts      # PDF processing
│   │   ├── tts.ts      # Text-to-speech
│   │   ├── ai.ts       # AI/LLM integration
│   │   └── ipc.ts      # IPC handlers
│   ├── preload/        # Preload scripts
│   │   └── index.ts    # IPC bridge
│   └── renderer/       # Frontend (copied from web version)
├── dist/               # Compiled TypeScript
└── build/              # Built applications
```

## Data Storage

All data is stored in:
- **macOS**: `~/Library/Application Support/Clara/`
- **Windows**: `%APPDATA%/Clara/`
- **Linux**: `~/.config/Clara/`

## Differences from Web Version

- No Flask server - everything runs natively
- Better performance with native Node.js modules
- Offline-first architecture
- Native system integrations
- Auto-updates support

## License

MIT
