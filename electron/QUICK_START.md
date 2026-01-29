# Clara Electron - Quick Start Guide

## Running the App

### Fast Launch (Recommended for Development)

```bash
# Quick launch (1-2 seconds - skips rebuild)
npm run quick
```

### Full Build + Launch (First Time or After Changes)

```bash
# Full build + launch (5-8 seconds)
npm start
```

### Watch Mode for Development

For the best development experience:

```bash
# Terminal 1: Start watch mode (auto-compiles on file save)
npm run watch

# Terminal 2: Quick launch whenever you want to test
npm run quick
```

## Important Environment Variable Issue

If you see an error like `Cannot read properties of undefined (reading 'whenReady')`, it means the `ELECTRON_RUN_AS_NODE` environment variable is set in your shell.

### Solution

The npm scripts automatically handle this by using `env -u ELECTRON_RUN_AS_NODE` to unset the variable before launching Electron. If you need to run electron directly, use:

```bash
env -u ELECTRON_RUN_AS_NODE electron .
```

### Permanently Fixing This Issue

If you have `ELECTRON_RUN_AS_NODE=1` set in your shell configuration (`.zshrc`, `.bashrc`, etc.), you may want to remove it or wrap it in a conditional that only sets it for specific tools.

## Which Command Should I Use?

- **`npm run quick`** - Use this most of the time for instant launch
- **`npm start`** - Use after code changes or first setup
- **`npm run watch`** - Keep running in background during development
- **`npm run dev`** - Alternative to start (builds then launches once)

## Building for Distribution

```bash
# macOS
npm run package:mac

# Windows
npm run package:win

# Linux
npm run package:linux
```

## Updating Frontend Files

If you make changes to the web version (in `../static/` or `../templates/`), run:

```bash
bash setup-renderer.sh
```

This will copy the latest frontend files and inject the Electron adapter.

## Troubleshooting

### Database Location

The SQLite database is stored at:
- macOS: `~/Library/Application Support/clara-electron/Clara/clara.db`
- Windows: `%APPDATA%/clara-electron/Clara/clara.db`
- Linux: `~/.config/clara-electron/Clara/clara.db`

### Native Modules

If you encounter issues with `better-sqlite3` or `canvas`, rebuild them:

```bash
npm run rebuild
```

Or manually:

```bash
./node_modules/.bin/electron-rebuild
```

## Project Structure

```
electron/
├── src/
│   ├── main/          # Main process (Node.js backend)
│   │   ├── index.ts   # Entry point
│   │   ├── database.ts  # SQLite database
│   │   ├── ipc.ts     # IPC handlers
│   │   ├── pdf.ts     # PDF processing
│   │   ├── tts.ts     # Text-to-speech
│   │   └── ai.ts      # AI integration
│   └── preload/       # Preload script (security bridge)
│       └── index.ts
├── renderer/          # Frontend (copied from ../static/)
│   ├── electron-adapter.js  # Fetch-to-IPC adapter
│   ├── css/
│   ├── js/
│   └── index.html
└── dist/              # Compiled TypeScript
    ├── main/
    └── preload/
```
