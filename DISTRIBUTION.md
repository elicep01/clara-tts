# Clara - Share with Friends

## What's Included
Clara is a complete, self-contained app with:
- PDF/document reader with text-to-speech
- Word-by-word highlighting as it reads
- AI Q&A about your documents (downloads AI model on first run)
- Notes/annotations system
- Document library with folders

---

## For macOS

### Your App is Ready!
Find **Clara-macOS.zip** (~1GB) in the `dist` folder.

### How to Share
1. Upload to Google Drive, Dropbox, or [WeTransfer](https://wetransfer.com)
2. Send the download link to your friends

### Installation Instructions (for your friends)

**Step 1:** Download and unzip `Clara-macOS.zip`

**Step 2:** Drag `Clara.app` to the **Applications** folder

**Step 3:** First launch (important!):
- Right-click on Clara.app
- Select **"Open"** from the menu
- Click **"Open"** in the security dialog

This is required because the app isn't signed with an Apple developer certificate ($99/year). After the first launch, you can open it normally.

**Step 4:** On first run, Clara will:
- Create a folder at `~/Documents/Clara` for your documents
- Download the AI model (~670MB) - this takes a few minutes but only happens once

---

## For Windows

You need to build on a Windows computer (PyInstaller can't cross-compile).

### Quick Build Steps

1. Install Python from [python.org](https://python.org) (check "Add to PATH")

2. Copy the `clara_2` folder to the Windows computer

3. Open Command Prompt and run:
```cmd
cd path\to\clara_2
pip install -r requirements.txt pyinstaller
pyinstaller --name "Clara" --windowed --onedir --add-data "templates;templates" --add-data "static;static" app.py
```

4. Find `Clara.exe` in `dist\Clara\` folder

5. Zip the entire `Clara` folder and share!

### For Windows Users Installing
- Windows Defender may show "Windows protected your PC"
- Click **"More info"** → **"Run anyway"**
- This is normal for unsigned apps

---

## First Run Experience

When your friends open Clara for the first time:

1. **Clara creates its home folder** at `~/Documents/Clara`
2. **Downloads the AI model** (~670MB, ~2-5 min depending on internet)
3. **Ready to use!** Upload a PDF and start reading

The AI model download only happens once. After that, Clara works completely offline.

---

## Troubleshooting

**"Clara is damaged and can't be opened"**
→ Open Terminal and run: `xattr -cr /Applications/Clara.app`

**App won't start**
→ Make sure you right-clicked and chose "Open" the first time

**AI Q&A not working**
→ Check if the model downloaded successfully in `~/Documents/Clara/models/`

**TTS not working**
→ Requires internet for Microsoft Edge TTS voices
