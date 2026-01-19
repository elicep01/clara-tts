# Clara - Troubleshooting Guide

## Issue: Questions return 500 error

**Problem:** Ollama is not running

**Fix:**
```bash
# Start Ollama in a separate terminal
ollama serve

# Or run in background
ollama serve &

# Verify it's running
curl http://localhost:11434
```

## Issue: Slow loading when uploading documents

**Fixed!** The new version loads the first page immediately and processes embeddings in the background.

## Issue: Voice quality not great

**Try different voices:**

Clara now supports multiple macOS voices. To change the default voice, edit `app.py` line ~106:

```python
def generate_audio(text, voice="Samantha"):  # Change "Samantha" to:
```

**Available voices:**
- `Samantha` - Female, natural (DEFAULT)
- `Karen` - Female, Australian (more expressive)
- `Moira` - Female, Irish (warm)
- `Tessa` - Female, South African (clear)
- `Alex` - Male, clear
- `Daniel` - Male, British

**Test voices:**
```bash
# Try different voices
say -v Samantha "Hello, this is Samantha"
say -v Karen "Hello, this is Karen"
say -v Moira "Hello, this is Moira"
say -v Tessa "Hello, this is Tessa"
```

## Issue: Better voice quality needed

For production-quality voices, you have two options:

### Option 1: ElevenLabs (cloud, costs money)
- Sign up at elevenlabs.io
- Get API key
- Modify Clara to use ElevenLabs API

### Option 2: Coqui TTS (free, local)
```bash
pip install TTS
```

Then update `generate_audio()` in app.py

## Running Clara

```bash
# Terminal 1: Start Ollama
ollama serve

# Terminal 2: Run Clara
cd ~/Downloads/clara
python3 app.py
```

## Common Commands

```bash
# Check if Ollama is running
curl http://localhost:11434

# Pull AI model
ollama pull llama3.2

# List available voices
say -v ?

# Test Clara without opening browser
curl http://localhost:5555/status
```

## Performance Tips

1. **Faster embeddings**: The app now processes them in background
2. **Faster responses**: Use a smaller Ollama model like `phi3`
3. **Better voice**: Try `Karen` or `Moira` for more natural sound

## Still having issues?

1. Check Python version: `python3 --version` (should be 3.8+)
2. Check Ollama: `ollama list`
3. Check logs in terminal where Clara is running
