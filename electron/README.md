# Clara (Electron)

Calm PDF reading app with read-aloud, word highlight sync, notes, dictionary, and in-context AI Q&A.

## Quick Start

```bash
npm install
npm run build
npm start
```

## Install Links (Clickable)

- macOS installer (local after build): [Install Clara for macOS](./release/Clara-Installer.dmg)

Notes:
- The macOS link above works after you run `npm run dist:mac:clickable`.

For fast relaunch after build:

```bash
npm run quick
```

## Main Scripts

- `npm run build` - compile main + preload
- `npm start` - build and launch Electron
- `npm run quick` - launch without rebuilding
- `npm run watch` - watch TypeScript builds
- `npm run icons` - regenerate app icons
- `npm run dist:mac` - build a macOS DMG (per-arch)
- `npm run dist:mac:arm64` - build Apple Silicon DMG
- `npm run dist:mac:x64` - build Intel DMG
- `npm run dist:mac:universal` - build a universal macOS DMG
- `npm run dist:mac:clickable` - build DMG and create stable clickable file at `release/Clara-Installer.dmg`

## App Data (macOS)

- `~/Library/Application Support/clara-electron/Clara/clara.db`
- `~/Library/Application Support/clara-electron/Clara/documents/`
- `~/Library/Application Support/clara-electron/Clara/audio_cache/`

To run as first-time app again, remove that `Clara` folder and relaunch.

## Notes

- PDF rendering and text/word extraction are fully in Electron/Node (`pdfjs-dist`), no Python scripts required.
- TTS uses Edge voices (`edge-tts` CLI must be installed and available in PATH).
- Local Q&A uses the app's integrated AI flow (Gemini + local context extraction).

## macOS DMG Packaging

1. Install dependencies once:
```bash
npm install
```

2. Build icons and app:
```bash
npm run icons
npm run dist:mac:clickable
```

3. Find output in:
```bash
release/
```

Then open/click:
- `release/Clara-Installer.dmg`

Optional signing/notarization env vars for trusted macOS distribution:
- `CSC_NAME` (Developer ID Application certificate)
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## Project Layout

```
src/main/        Electron main process (IPC, DB, PDF, TTS, AI)
src/preload/     Secure bridge API
renderer/        UI (HTML/CSS/JS modules)
scripts/         Utility scripts (icon generation)
build/icons/     App icons
```
