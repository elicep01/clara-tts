# Clara - Quick Start Guide

## 🚀 Getting Started in 3 Steps

### Step 1: Install Prerequisites

```bash
# Install Piper TTS (for voice)
# macOS:
brew install piper-tts

# Download a voice model (choose one):
# Female voices: en_US-lessac-medium, en_US-amy-medium  
# Male voices: en_US-ryan-medium, en_US-danny-medium
# Get from: https://github.com/rhasspy/piper/releases/tag/v1.2.0

# Install Ollama (for AI)
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2
```

### Step 2: Install Python Dependencies

```bash
cd clara
pip install -r requirements.txt
```

### Step 3: Run Clara

```bash
# Quick run:
./run.sh

# Or manually:
python3 app.py

# Test UI without Piper/Ollama:
python3 demo.py
```

---

## 📱 How to Use

1. **Upload a Document**
   - Drag & drop or click to browse
   - Supports: PDF, TXT, MD

2. **Listen**
   - Click the play button
   - Use ← → to navigate sections

3. **Ask Questions**
   - Type in the bottom input
   - Get instant AI answers

---

## 🎨 What Makes Clara Special

- **Minimal Design** - Clean, Apple-inspired interface
- **Local & Private** - Everything runs on your machine
- **Smart AI** - Understands context, answers questions
- **Natural Voice** - High-quality text-to-speech
- **No Accounts** - Just download and use

---

## 🔧 Troubleshooting

**"Piper not found"**
→ Install Piper and add to PATH

**"Ollama not found"**
→ Install Ollama and run `ollama pull llama3.2`

**Want to test the UI first?**
→ Run `python3 demo.py` (no Piper/Ollama needed)

---

## 📂 Project Structure

```
clara/
├── app.py              Main application (full version)
├── demo.py             Demo version (UI testing)
├── run.sh              Quick launcher
├── setup.sh            Build executable
├── requirements.txt    Python dependencies
├── README.md           Full documentation
├── templates/
│   └── index.html      UI template
└── static/
    ├── css/
    │   └── style.css   Styles (customize here!)
    └── js/
        └── app.js      Client logic
```

---

## 💡 Pro Tips

**Change Voice:**
Edit `app.py` line 106:
```python
def generate_audio(text, voice="en_US-lessac-medium"):
```

**Change Colors:**
Edit `static/css/style.css` lines 3-10:
```css
:root {
    --color-accent: #0071E3;  /* Your color here */
}
```

**Use Different AI Model:**
Edit `app.py` line 193:
```python
['ollama', 'run', 'llama3.2', full_prompt]
              # ↑ Change to: mistral, phi3, etc.
```

---

## 🎯 Next Steps

1. Try the demo: `python3 demo.py`
2. Install Piper & Ollama
3. Run full version: `python3 app.py`
4. Build executable: `./setup.sh`
5. Customize the design to your taste!

---

**Need help?** Check the full README.md for detailed instructions.

**Love it?** Share it with someone who reads a lot!
