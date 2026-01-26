"""
Clara - Your Reading Companion
A minimal, elegant desktop app for intelligent document reading
"""

import os
import sys
import threading
import queue
import sqlite3
import uuid
import io
import re
import hashlib
from pathlib import Path
from datetime import datetime
import webview
from flask import Flask, render_template, request, jsonify, Response, send_file
from werkzeug.utils import secure_filename
import pypdf
from sentence_transformers import SentenceTransformer
import chromadb
from chromadb.config import Settings
import subprocess
import tempfile
import time

# Import PyMuPDF for PDF processing and TOC extraction
try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False
    print("Warning: PyMuPDF not installed. PDF TOC extraction will be limited.")

# Import pdf2image for PDF page rendering
try:
    from pdf2image import convert_from_path
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False
    print("Warning: pdf2image not installed. PDF pages will display as text only.")

# Configuration
CLARA_HOME = Path.home() / 'Documents' / 'Clara'
DOCUMENTS_FOLDER = CLARA_HOME / 'documents'
THUMBNAILS_FOLDER = CLARA_HOME / 'thumbnails'
VOICES_FOLDER = CLARA_HOME / 'voices'
MODELS_FOLDER = CLARA_HOME / 'models'
AUDIO_CACHE_FOLDER = CLARA_HOME / 'audio_cache'
TOC_CACHE_FOLDER = CLARA_HOME / 'toc_cache'
DATABASE_PATH = CLARA_HOME / 'clara.db'
CONFIG_PATH = CLARA_HOME / 'config.json'
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'md'}

# TOC memory cache for ultra-fast repeated access
_toc_memory_cache = {}

# TTS configuration - using edge-tts for high quality neural voices
EDGE_TTS_AVAILABLE = False
TTS_VOICES = {
    'female': 'en-US-JennyNeural',  # Natural female voice
    'male': 'en-US-GuyNeural'        # Natural male voice
}

# Gemini API configuration (free tier, fast!)
# Key is obfuscated to prevent casual copying - use GEMINI_API_KEY env var to override
def _get_gemini_key():
    """Get Gemini API key from environment or use built-in default"""
    import base64
    # Users can set their own key via environment variable
    env_key = os.environ.get('GEMINI_API_KEY')
    if env_key:
        return env_key
    # Built-in free tier key (obfuscated) - for demo/personal use
    _k = ['QUl6YVN5QV9wVW9s', 'V2hCUDNIUFByU3Vu', 'YVpDYk1MaDhYLTU2', 'Um9F']
    return base64.b64decode(''.join(_k)).decode()

GEMINI_API_KEY = _get_gemini_key()
GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

# Local LLM configuration
LOCAL_LLM = None
LLM_MODEL_NAME = 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf'
LLM_AVAILABLE = False
CURRENT_LLM_ID = None  # Track which LLM is currently loaded

# Available LLM models catalog
AVAILABLE_LLMS = [
    {
        'id': 'tinyllama-1.1b',
        'name': 'TinyLlama 1.1B',
        'filename': 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        'url': 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        'size_mb': 670,
        'description': 'Fast and lightweight. Good for basic Q&A.',
        'parameters': '1.1B',
        'context_length': 2048
    },
    {
        'id': 'phi-2',
        'name': 'Phi-2',
        'filename': 'phi-2.Q4_K_M.gguf',
        'url': 'https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf',
        'size_mb': 1600,
        'description': 'Microsoft\'s compact model. Excellent reasoning.',
        'parameters': '2.7B',
        'context_length': 2048
    },
    {
        'id': 'mistral-7b',
        'name': 'Mistral 7B Instruct',
        'filename': 'mistral-7b-instruct-v0.2.Q4_K_M.gguf',
        'url': 'https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf',
        'size_mb': 4370,
        'description': 'High quality responses. Requires more memory.',
        'parameters': '7B',
        'context_length': 8192
    },
    {
        'id': 'llama-3.2-1b',
        'name': 'Llama 3.2 1B',
        'filename': 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        'url': 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        'size_mb': 750,
        'description': 'Meta\'s latest small model. Fast and capable.',
        'parameters': '1B',
        'context_length': 4096
    },
    {
        'id': 'llama-3.2-3b',
        'name': 'Llama 3.2 3B',
        'filename': 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        'url': 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        'size_mb': 2000,
        'description': 'Great balance of speed and quality.',
        'parameters': '3B',
        'context_length': 4096
    }
]

# Base model configuration - Downloaded on first launch
BASE_MODEL_ID = 'llama-3.2-3b'  # 2GB, good balance of speed and quality
BASE_MODEL = next((m for m in AVAILABLE_LLMS if m['id'] == BASE_MODEL_ID), AVAILABLE_LLMS[4])

# Download progress tracking
download_progress = {}

# First launch and configuration management
def load_config():
    """Load Clara configuration"""
    if not CONFIG_PATH.exists():
        return {
            'first_launch_complete': False,
            'base_model_downloaded': False,
            'version': '1.0.0'
        }
    try:
        import json
        return json.loads(CONFIG_PATH.read_text())
    except Exception as e:
        print(f"[CONFIG] Error loading config: {e}")
        return {'first_launch_complete': False, 'base_model_downloaded': False}

def save_config(config):
    """Save Clara configuration"""
    try:
        import json
        CONFIG_PATH.write_text(json.dumps(config, indent=2))
    except Exception as e:
        print(f"[CONFIG] Error saving config: {e}")

def is_first_launch():
    """Check if this is the first time Clara is running"""
    config = load_config()
    return not config.get('first_launch_complete', False)

def check_base_model_exists():
    """Check if base model is downloaded"""
    base_model_path = MODELS_FOLDER / BASE_MODEL['filename']
    return base_model_path.exists()

def mark_first_launch_complete():
    """Mark first launch as complete"""
    config = load_config()
    config['first_launch_complete'] = True
    config['base_model_downloaded'] = check_base_model_exists()
    save_config(config)

def check_system_dependencies():
    """
    Check all system-level dependencies and provide helpful installation instructions.
    This ensures Clara runs smoothly on both Windows and macOS without runtime errors.
    """
    import platform

    issues = []
    warnings = []
    system = platform.system()

    print("\n" + "="*60)
    print("Checking System Dependencies")
    print("="*60)

    # Check Python version
    python_version = sys.version_info
    print(f"[OK] Python {python_version.major}.{python_version.minor}.{python_version.micro}")
    if python_version < (3, 8):
        issues.append("Python 3.8 or higher is required")

    # Check Poppler (required for pdf2image)
    poppler_ok = False
    if PDF2IMAGE_AVAILABLE:
        try:
            from pdf2image import convert_from_path
            # Try to actually use it with a test
            test_result = subprocess.run(
                ['pdftoppm', '-v'],
                capture_output=True,
                text=True,
                timeout=2
            )
            poppler_ok = test_result.returncode == 0
        except FileNotFoundError:
            poppler_ok = False
        except Exception:
            poppler_ok = False

    if poppler_ok:
        print("[OK] Poppler (PDF rendering)")
    else:
        print("[MISSING] Poppler NOT FOUND (required for PDF image rendering)")
        if system == "Darwin":  # macOS
            issues.append("""
Poppler is required for PDF rendering with images.

Installation on macOS:
  1. Install Homebrew if not installed: https://brew.sh
  2. Run: brew install poppler
  3. Restart the application

Without poppler, PDFs will display as text only.
""")
        elif system == "Windows":
            issues.append("""
Poppler is required for PDF rendering with images.

Installation on Windows:
  1. Download poppler from: https://github.com/oschwartz10612/poppler-windows/releases/
  2. Extract to C:\\Program Files\\poppler
  3. Add C:\\Program Files\\poppler\\Library\\bin to your PATH environment variable
  4. Restart your computer
  5. Restart the application

Detailed guide: https://github.com/oschwartz10612/poppler-windows

Without poppler, PDFs will display as text only.
""")
        else:  # Linux
            issues.append("""
Poppler is required for PDF rendering with images.

Installation on Linux:
  Ubuntu/Debian: sudo apt-get install poppler-utils
  Fedora: sudo dnf install poppler-utils
  Arch: sudo pacman -S poppler

Without poppler, PDFs will display as text only.
""")

    # Check PyMuPDF
    if PYMUPDF_AVAILABLE:
        print("[OK] PyMuPDF (PDF processing)")
    else:
        warnings.append("PyMuPDF not available - install with: pip install pymupdf")
        print("[WARNING] PyMuPDF not installed (PDF TOC extraction limited)")

    # Check sentence-transformers
    try:
        from sentence_transformers import SentenceTransformer
        print("[OK] Sentence Transformers (AI embeddings)")
    except ImportError:
        issues.append("sentence-transformers not installed - run: pip install sentence-transformers")
        print("[MISSING] Sentence Transformers missing")

    # Check ChromaDB
    try:
        import chromadb
        print("[OK] ChromaDB (vector database)")
    except ImportError:
        issues.append("chromadb not installed - run: pip install chromadb")
        print("[MISSING] ChromaDB missing")

    # Check Flask
    try:
        from flask import Flask
        print("[OK] Flask (web framework)")
    except ImportError:
        issues.append("flask not installed - run: pip install flask")
        print("[MISSING] Flask missing")

    # Check webview
    try:
        import webview
        print("[OK] PyWebView (desktop UI)")
    except ImportError:
        issues.append("pywebview not installed - run: pip install pywebview")
        print("[MISSING] PyWebView missing")

    # Check edge-tts (optional but recommended)
    if EDGE_TTS_AVAILABLE:
        print("[OK] Edge TTS (neural voices)")
    else:
        warnings.append("edge-tts not installed - for better TTS quality: pip install edge-tts")
        print("[WARNING] Edge TTS not installed (using system TTS)")

    # Check llama-cpp-python (optional)
    try:
        from llama_cpp import Llama
        print("[OK] llama-cpp-python (local AI)")
    except ImportError:
        warnings.append("llama-cpp-python not installed - for local AI: pip install llama-cpp-python")
        print("[WARNING] llama-cpp-python not installed (Q&A feature limited)")

    print("="*60)

    # Display warnings
    if warnings:
        print("\nWARNINGS (optional features):")
        for warning in warnings:
            print(f"  - {warning}")

    # Display critical issues
    if issues:
        print("\nCRITICAL ISSUES FOUND:")
        print("\nThe following dependencies are missing or incorrectly installed:\n")
        for i, issue in enumerate(issues, 1):
            print(f"{i}. {issue}")

        print("\n" + "="*60)
        print("Please install the missing dependencies and restart Clara.")
        print("See README.md for detailed installation instructions.")
        print("="*60)

        # Don't exit immediately, allow graceful error handling
        return False

    if not warnings:
        print("\nAll dependencies OK! Clara is ready to run.\n")
    else:
        print(f"\nCore dependencies OK! ({len(warnings)} optional features unavailable)\n")

    return True

def init_tts():
    """Initialize TTS engine"""
    global EDGE_TTS_AVAILABLE
    try:
        import edge_tts
        EDGE_TTS_AVAILABLE = True
        print("[OK] Edge TTS available (Microsoft Neural Voices)")
    except ImportError:
        print("[WARNING] edge-tts not installed. Install with: pip install edge-tts")
        print("  Falling back to macOS TTS")
        EDGE_TTS_AVAILABLE = False

def download_llm_model():
    """Download the LLM model if not present"""
    import urllib.request

    model_path = MODELS_FOLDER / LLM_MODEL_NAME

    if model_path.exists():
        return True

    # TinyLlama model URL from Hugging Face
    model_url = "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

    print(f"  Downloading LLM model (~670MB)...")
    print(f"  This only happens once on first run.")

    try:
        # Download with progress
        def report_progress(block_num, block_size, total_size):
            downloaded = block_num * block_size
            percent = min(100, (downloaded / total_size) * 100)
            mb_downloaded = downloaded / (1024 * 1024)
            mb_total = total_size / (1024 * 1024)
            print(f"\r  Progress: {percent:.1f}% ({mb_downloaded:.1f}/{mb_total:.1f} MB)", end='', flush=True)

        urllib.request.urlretrieve(model_url, model_path, reporthook=report_progress)
        print()  # New line after progress
        print("[OK] LLM model downloaded successfully!")
        return True

    except Exception as e:
        print(f"\n[ERROR] Failed to download LLM model: {e}")
        print("  Q&A feature will be limited to context search only")
        if model_path.exists():
            model_path.unlink()  # Remove partial download
        return False

def init_llm():
    """Initialize local LLM using llama-cpp-python"""
    global LOCAL_LLM, LLM_AVAILABLE, CURRENT_LLM_ID, LLM_MODEL_NAME

    # Check for default model in database first
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, filename FROM llm_models WHERE is_default = 1')
        default_model = cursor.fetchone()
        conn.close()

        if default_model:
            model_id = default_model['id']
            model_filename = default_model['filename']
            model_info = next((llm for llm in AVAILABLE_LLMS if llm['id'] == model_id), None)
        else:
            # Fall back to TinyLlama as default
            model_id = 'tinyllama-1.1b'
            model_filename = LLM_MODEL_NAME
            model_info = next((llm for llm in AVAILABLE_LLMS if llm['id'] == model_id), None)
    except Exception:
        # Database not ready yet, use default
        model_id = 'tinyllama-1.1b'
        model_filename = LLM_MODEL_NAME
        model_info = next((llm for llm in AVAILABLE_LLMS if llm['id'] == model_id), None)

    model_path = MODELS_FOLDER / model_filename

    # Try to download if not present (only for TinyLlama as starter model)
    if not model_path.exists():
        if model_id == 'tinyllama-1.1b':
            if not download_llm_model():
                LLM_AVAILABLE = False
                return
        else:
            print(f"[WARNING] Default model {model_filename} not found. Please download it from Settings.")
            LLM_AVAILABLE = False
            return

    try:
        from llama_cpp import Llama

        context_length = model_info['context_length'] if model_info else 2048
        model_name = model_info['name'] if model_info else 'Unknown'

        print(f"  Loading local LLM ({model_name})...")
        LOCAL_LLM = Llama(
            model_path=str(model_path),
            n_ctx=context_length,
            n_threads=4,
            n_gpu_layers=0,
            verbose=False
        )
        LLM_AVAILABLE = True
        CURRENT_LLM_ID = model_id
        LLM_MODEL_NAME = model_filename

        # Register in database if not already there
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM llm_models WHERE id = ?', (model_id,))
            if not cursor.fetchone() and model_info:
                cursor.execute('''
                    INSERT INTO llm_models (id, name, filename, size_mb, downloaded_at, is_default)
                    VALUES (?, ?, ?, ?, ?, 1)
                ''', (model_id, model_info['name'], model_info['filename'],
                      model_info['size_mb'], datetime.now()))
                conn.commit()
            conn.close()
        except Exception:
            pass  # Database might not be fully initialized yet

        print(f"[OK] Local LLM loaded ({model_name})")
    except Exception as e:
        print(f"[ERROR] Failed to load LLM: {e}")
        LLM_AVAILABLE = False

def init_storage():
    """Initialize Clara's persistent storage"""
    CLARA_HOME.mkdir(parents=True, exist_ok=True)
    DOCUMENTS_FOLDER.mkdir(exist_ok=True)
    THUMBNAILS_FOLDER.mkdir(exist_ok=True)
    VOICES_FOLDER.mkdir(exist_ok=True)
    MODELS_FOLDER.mkdir(exist_ok=True)
    AUDIO_CACHE_FOLDER.mkdir(exist_ok=True)
    TOC_CACHE_FOLDER.mkdir(exist_ok=True)
    init_database()

def init_database():
    """Initialize SQLite database with schema"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # Folders table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE SET NULL
        )
    ''')

    # Documents table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            original_filename TEXT,
            folder_id TEXT,
            file_path TEXT,
            total_chunks INTEGER DEFAULT 0,
            last_position INTEGER DEFAULT 0,
            last_opened_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
        )
    ''')

    # Annotations/Notes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            page_num INTEGER NOT NULL,
            content TEXT NOT NULL,
            question TEXT,
            anchor_type TEXT DEFAULT 'selection',
            anchor_x REAL,
            anchor_y REAL,
            anchor_width REAL,
            anchor_height REAL,
            anchor_text TEXT,
            color TEXT DEFAULT '#FFE066',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )
    ''')

    # Settings table for app preferences
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Downloaded LLM models table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS llm_models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            filename TEXT NOT NULL,
            size_mb INTEGER,
            downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_default BOOLEAN DEFAULT 0
        )
    ''')

    conn.commit()
    conn.close()

def get_db():
    """Get database connection with row factory"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# Global state
current_document = None
current_chunks = []
audio_queue = queue.Queue()
is_playing = False
current_position = 0

# Initialize Flask app
app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = DOCUMENTS_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Disable caching for static files to ensure fresh JS/CSS loads
@app.after_request
def add_no_cache_headers(response):
    """Add headers to prevent caching of static files during development"""
    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

# Initialize ChromaDB for RAG
chroma_client = chromadb.Client(Settings(
    anonymized_telemetry=False,
    is_persistent=False
))

# Initialize embedding model (lightweight)
embedder = None
collection = None

def init_embedder():
    """Initialize the sentence transformer model"""
    global embedder
    try:
        embedder = SentenceTransformer('all-MiniLM-L6-v2')
        print("[OK] Embedding model loaded")
    except Exception as e:
        print(f"[ERROR] Failed to load embedding model: {e}")
        embedder = None

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def parse_pdf(filepath, max_pages=None):
    """Extract text from PDF with optional page limit for lazy loading"""
    try:
        reader = pypdf.PdfReader(filepath)
        text = ""
        pages_to_read = reader.pages if max_pages is None else reader.pages[:max_pages]
        for page in pages_to_read:
            text += page.extract_text() + "\n\n"
        return text
    except Exception as e:
        raise Exception(f"Failed to parse PDF: {str(e)}")

def parse_pdf_pages(filepath, start_page, end_page):
    """Extract text from specific pages of a PDF"""
    try:
        reader = pypdf.PdfReader(filepath)
        text = ""
        for i in range(start_page, min(end_page, len(reader.pages))):
            text += reader.pages[i].extract_text() + "\n\n"
        return text
    except Exception as e:
        raise Exception(f"Failed to parse PDF pages: {str(e)}")

def parse_text_file(filepath):
    """Read plain text or markdown file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        raise Exception(f"Failed to read file: {str(e)}")

def chunk_text(text, chunk_size=500):
    """Split text into semantic chunks"""
    # Simple paragraph-based chunking
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    
    chunks = []
    current_chunk = ""
    
    for para in paragraphs:
        if len(current_chunk) + len(para) < chunk_size:
            current_chunk += para + "\n\n"
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = para + "\n\n"
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    return chunks

def create_embeddings(chunks):
    """Create vector embeddings and store in ChromaDB"""
    global collection, embedder
    
    if embedder is None:
        init_embedder()
    
    if embedder is None:
        return False
    
    try:
        # Reset collection
        try:
            chroma_client.delete_collection("clara_doc")
        except:
            pass
        
        collection = chroma_client.create_collection(
            name="clara_doc",
            metadata={"hnsw:space": "cosine"}
        )
        
        # Generate embeddings
        embeddings = embedder.encode(chunks).tolist()
        
        # Store in ChromaDB
        collection.add(
            embeddings=embeddings,
            documents=chunks,
            ids=[f"chunk_{i}" for i in range(len(chunks))]
        )
        
        print(f"[OK] Created {len(chunks)} embeddings")
        return True
    except Exception as e:
        print(f"[ERROR] Embedding creation failed: {e}")
        return False

def query_document(question, n_results=3):
    """Query the document using RAG"""
    global collection, embedder
    
    if collection is None or embedder is None:
        return []
    
    try:
        # Get query embedding
        query_embedding = embedder.encode([question]).tolist()
        
        # Search for relevant chunks
        results = collection.query(
            query_embeddings=query_embedding,
            n_results=n_results
        )
        
        return results['documents'][0] if results['documents'] else []
    except Exception as e:
        print(f"[ERROR] Query failed: {e}")
        return []

def get_saved_voice():
    """Get the user's saved voice preference from database"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = 'tts_voice'")
        result = cursor.fetchone()
        conn.close()
        if result:
            return result['value']
    except Exception:
        pass
    # Default voice
    return 'en-US-JennyNeural' if EDGE_TTS_AVAILABLE else 'Samantha'

def generate_audio_with_timings(text, voice=None, timeout=30):
    """
    Generate audio AND capture word timings from the SAME Edge TTS stream.
    This ensures perfect synchronization between audio and word highlighting.

    Returns: (audio_path, word_timings_list)
    """
    global EDGE_TTS_AVAILABLE

    # Resolve voice
    if voice is None:
        voice_name = get_saved_voice()
    elif voice in ('female', 'male'):
        voice_name = TTS_VOICES.get(voice, TTS_VOICES['female'])
    else:
        voice_name = voice

    word_timings = []

    try:
        if EDGE_TTS_AVAILABLE:
            import edge_tts
            import asyncio

            temp_audio = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False)
            temp_audio.close()

            async def generate_with_timings():
                """Stream audio and capture word boundaries from the SAME stream"""
                nonlocal word_timings
                communicate = edge_tts.Communicate(text, voice_name)

                audio_chunks = []

                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_chunks.append(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        # Convert 100-nanosecond units to seconds
                        offset_sec = chunk["offset"] / 10_000_000
                        duration_sec = chunk["duration"] / 10_000_000
                        word_timings.append({
                            "text": chunk["text"],
                            "offset": offset_sec,
                            "duration": duration_sec
                        })

                # Write all audio chunks to file
                with open(temp_audio.name, 'wb') as f:
                    for audio_chunk in audio_chunks:
                        f.write(audio_chunk)

            try:
                asyncio.run(asyncio.wait_for(generate_with_timings(), timeout=timeout))
            except asyncio.TimeoutError:
                raise Exception(f"Audio generation timed out after {timeout} seconds.")

            print(f"[TTS] Generated audio with {len(word_timings)} synchronized word timings")
            return temp_audio.name, word_timings
        else:
            # Fallback to macOS TTS (no word timings available)
            temp_audio = tempfile.NamedTemporaryFile(suffix='.aiff', delete=False)
            temp_audio.close()

            macos_voice = voice_name if voice_name in ('Samantha', 'Alex') else 'Samantha'

            subprocess.run(
                ['say', '-v', macos_voice, '-o', temp_audio.name, text],
                capture_output=True,
                text=True,
                check=True,
                timeout=timeout
            )

            return temp_audio.name, []  # No timings for macOS TTS

    except Exception as e:
        raise Exception(f"Audio generation failed: {str(e)}")

def generate_audio(text, voice=None, timeout=30):
    """
    Generate audio using edge-tts (Microsoft Neural Voices) or fallback to macOS
    Legacy wrapper - just returns audio path, ignoring timings.
    """
    audio_path, _ = generate_audio_with_timings(text, voice, timeout)
    return audio_path

def call_local_llm(prompt, context="", is_page_specific=False):
    """Call local LLM for question answering with context awareness"""
    global LOCAL_LLM, LLM_AVAILABLE

    if not LLM_AVAILABLE or LOCAL_LLM is None:
        # Return context-based answer without LLM
        if context:
            if is_page_specific and "summarize" in prompt.lower():
                # Simple summarization fallback
                sentences = context.split('.')
                summary = '. '.join(sentences[:3]) + '.'
                return summary if summary else context[:400] + "..."
            return f"Based on the document:\n\n{context[:800]}..."
        raise Exception("LLM not available and no context found")

    try:
        # Enhanced prompt based on question type
        if is_page_specific:
            system_prompt = """You are Clara, a helpful reading assistant. The user is asking about the current page they are reading. 
When they say "this page", "current page", or "summarize this", they mean the page content provided in the context.
Provide a clear, helpful answer focused on the current page content. For summarization requests, create a concise summary of the key points."""
        else:
            system_prompt = """You are Clara, a helpful reading assistant. Answer questions based on the provided context from the document. 
Be concise and accurate. If the question refers to "this" or "current", use the current page context provided."""
        
        # TinyLlama chat format
        full_prompt = f"""<|system|>
{system_prompt}</s>
<|user|>
Context from the document:
{context[:2000]}

Question: {prompt}</s>
<|assistant|>
"""

        # Use more tokens for summarization tasks
        max_tokens = 300 if "summarize" in prompt.lower() else 256

        response = LOCAL_LLM(
            full_prompt,
            max_tokens=max_tokens,
            temperature=0.7,
            stop=["</s>", "<|user|>", "<|system|>"],
            echo=False
        )

        answer = response['choices'][0]['text'].strip()
        return answer if answer else "I couldn't find a clear answer in the document."

    except Exception as e:
        raise Exception(f"LLM query failed: {str(e)}")

def call_ai_with_fallback(prompt, context="", is_page_specific=False):
    """
    Call local LLM for document Q&A (100% free and private!)
    """
    global LLM_AVAILABLE

    # Use local LLM if available
    if LLM_AVAILABLE:
        try:
            print("[Q&A] Using local LLM")
            return call_local_llm(prompt, context, is_page_specific)
        except Exception as e:
            raise Exception(f"AI query failed: {str(e)}")

    # No AI available - return context excerpt
    if context:
        return f"Based on the document:\n\n{context[:800]}..."
    raise Exception("No AI service available and no context found")

# Routes

@app.route('/')
def index():
    """Serve the main UI"""
    return render_template('index.html')

@app.route('/first-launch-status')
def first_launch_status():
    """Check if first launch setup is needed"""
    return jsonify({
        'is_first_launch': is_first_launch(),
        'has_base_model': check_base_model_exists(),
        'base_model': {
            'id': BASE_MODEL['id'],
            'name': BASE_MODEL['name'],
            'size_mb': BASE_MODEL['size_mb'],
            'description': BASE_MODEL['description']
        }
    })

@app.route('/mark-first-launch-complete', methods=['POST'])
def mark_first_launch_complete_endpoint():
    """Mark first launch as complete"""
    mark_first_launch_complete()
    return jsonify({'success': True})

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle document upload with persistent storage"""
    global current_document, current_chunks, current_position

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    folder_id = request.form.get('folder_id')  # Optional folder to upload into

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Use PDF, TXT, or MD'}), 400

    try:
        # Generate unique ID for document
        doc_id = str(uuid.uuid4())
        original_filename = secure_filename(file.filename)
        extension = original_filename.rsplit('.', 1)[1].lower()
        stored_filename = f"{doc_id}.{extension}"
        filepath = DOCUMENTS_FOLDER / stored_filename

        # Save file to persistent storage
        file.save(filepath)

        # Lazy load: for PDFs, parse only first 5 pages initially
        if extension == 'pdf':
            # Quick parse for immediate response
            text = parse_pdf(filepath, max_pages=5)
            initial_chunks = chunk_text(text)

            # Check total pages for background processing
            reader = pypdf.PdfReader(filepath)
            total_pages = len(reader.pages)

            if total_pages > 5:
                # Parse remaining pages in background
                def parse_remaining_pages():
                    global current_chunks
                    try:
                        remaining_text = parse_pdf_pages(filepath, 5, total_pages)
                        remaining_chunks = chunk_text(remaining_text)
                        all_chunks = initial_chunks + remaining_chunks

                        # Update in-memory chunks
                        current_chunks = all_chunks

                        # Update database with correct chunk count
                        conn = get_db()
                        cursor = conn.cursor()
                        cursor.execute('UPDATE documents SET total_chunks = ? WHERE id = ?',
                                      (len(all_chunks), doc_id))
                        conn.commit()
                        conn.close()

                        # Create embeddings for all chunks
                        create_embeddings(all_chunks)
                        print(f"[OK] Finished processing all {total_pages} pages ({len(all_chunks)} chunks)")
                    except Exception as e:
                        print(f"[ERROR] Background parsing failed: {e}")

                threading.Thread(target=parse_remaining_pages, daemon=True).start()
                chunks = initial_chunks
            else:
                chunks = initial_chunks
                # Create embeddings in background
                threading.Thread(target=lambda: create_embeddings(chunks), daemon=True).start()
        else:
            text = parse_text_file(filepath)
            chunks = chunk_text(text)
            # Create embeddings in background
            threading.Thread(target=lambda: create_embeddings(chunks), daemon=True).start()

        # Save to database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO documents (id, name, original_filename, folder_id, file_path, total_chunks, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (doc_id, original_filename.rsplit('.', 1)[0], original_filename,
              folder_id if folder_id else None, str(filepath), len(chunks), datetime.now()))
        conn.commit()
        conn.close()

        # Update state immediately with chunks
        current_document = {
            'id': doc_id,
            'name': original_filename,
            'path': str(filepath),
            'text': text if extension != 'pdf' else ''
        }
        current_chunks = chunks
        current_position = 0

        # Return immediately with first chunk
        return jsonify({
            'success': True,
            'id': doc_id,
            'filename': original_filename,
            'chunks': len(chunks),
            'preview': chunks[0][:200] + '...' if chunks else ''
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/play', methods=['POST'])
def play():
    """Start or resume reading"""
    global current_chunks, current_position, is_playing

    if not current_chunks:
        return jsonify({'error': 'No document loaded'}), 400

    data = request.get_json()
    position = data.get('position', current_position)
    voice = data.get('voice', 'female')  # 'female' or 'male'

    if position >= len(current_chunks):
        return jsonify({'error': 'End of document reached'}), 400

    is_playing = True
    current_position = position

    try:
        # Get current chunk
        chunk = current_chunks[position]

        # Generate audio with selected voice
        audio_path = generate_audio(chunk, voice)

        # Read audio file
        with open(audio_path, 'rb') as f:
            audio_data = f.read()

        # Clean up temp file
        os.unlink(audio_path)

        # Determine mimetype based on file extension
        if audio_path.endswith('.mp3'):
            mimetype = 'audio/mpeg'
        elif audio_path.endswith('.wav'):
            mimetype = 'audio/wav'
        else:
            mimetype = 'audio/aiff'
        return Response(audio_data, mimetype=mimetype)

    except Exception as e:
        is_playing = False
        return jsonify({'error': str(e)}), 500

@app.route('/chunk/<int:position>', methods=['GET'])
def get_chunk(position):
    """Get a specific chunk"""
    global current_chunks
    
    if not current_chunks or position >= len(current_chunks):
        return jsonify({'error': 'Invalid position'}), 400
    
    return jsonify({
        'text': current_chunks[position],
        'position': position,
        'total': len(current_chunks)
    })

@app.route('/voices', methods=['GET'])
def get_voices():
    """Get available macOS voices"""
    return jsonify({
        'voices': [
            {'name': 'Samantha', 'description': 'Female, US English (natural)', 'default': True},
            {'name': 'Alex', 'description': 'Male, US English (clear)'},
            {'name': 'Karen', 'description': 'Female, Australian English'},
            {'name': 'Moira', 'description': 'Female, Irish English'},
            {'name': 'Tessa', 'description': 'Female, South African English'},
            {'name': 'Daniel', 'description': 'Male, British English'}
        ]
    })

@app.route('/pause', methods=['POST'])
def pause():
    """Pause reading"""
    global is_playing
    is_playing = False
    return jsonify({'success': True})

@app.route('/ask', methods=['POST'])
def ask_question():
    """Answer a question about the document with context awareness"""
    data = request.get_json()
    question = data.get('question', '')
    current_page_num = data.get('page_num')  # Current page number (optional)
    current_page_text = data.get('page_text', '')  # Current page text (optional)
    doc_id = data.get('doc_id', '')  # Document ID (optional)

    if not question:
        return jsonify({'error': 'No question provided'}), 400

    # Check if we have enough context to answer
    if not current_document and not current_page_text:
        return jsonify({'error': 'No document context available'}), 400

    try:
        # Detect if question refers to current page/chapter
        question_lower = question.lower()
        is_page_specific = any(phrase in question_lower for phrase in [
            'this page', 'current page', 'this chapter', 'current chapter',
            'summarize this', 'summarize the page', 'what is on this page',
            'what does this page say', 'explain this page', 'what is this page about'
        ])

        context_chunks = []

        # If question is about current page and we have page text, prioritize it
        if is_page_specific and current_page_text:
            # Use current page as primary context
            context = current_page_text[:2000]  # Use up to 2000 chars of current page
            # Also get some relevant chunks from RAG for additional context (if embeddings exist)
            if current_document:
                context_chunks = query_document(question, n_results=2)
                if context_chunks:
                    context += "\n\nAdditional context:\n" + "\n\n".join(context_chunks[:2])
        elif current_page_text:
            # Use page text as primary context even for general questions
            context = f"Document content:\n{current_page_text[:2000]}"
            # Try RAG if available
            if current_document:
                context_chunks = query_document(question, n_results=3)
                if context_chunks:
                    context += "\n\nAdditional relevant sections:\n" + "\n\n".join(context_chunks)
        else:
            # Standard RAG approach (requires current_document)
            context_chunks = query_document(question, n_results=3)
            context = "\n\n".join(context_chunks)

        # Get answer from AI (local LLM)
        answer = call_ai_with_fallback(question, context, is_page_specific=is_page_specific)

        return jsonify({
            'answer': answer,
            'context_used': len(context_chunks) if not is_page_specific else 1
        })

    except Exception as e:
        print(f"Ask error: {e}")  # Log for debugging
        return jsonify({'error': f'Question failed: {str(e)}'}), 500

@app.route('/dictionary/llm-define', methods=['POST'])
def llm_contextual_define():
    """
    Free AI fallback for dictionary lookups using Gemini API
    Uses Google's free tier - fast and smart!
    """
    import json
    import requests

    data = request.get_json()

    word = data.get('word', '')
    original_word = data.get('original_word', '')
    context_sentence = data.get('context_sentence', '')
    full_context = data.get('full_context', '')

    if not word:
        return jsonify({'error': 'No word provided'}), 400

    # TRY 1: Gemini API (free tier, fast and smart!)
    try:
        print(f"[Dictionary] Trying Gemini API for '{word}'")

        # Build prompt for Gemini
        prompt = f"""Define the word "{word}" as used in this context: "{context_sentence if context_sentence else 'general usage'}"

Return ONLY a JSON object in this exact format (no markdown, no code fences):
{{"word":"{word}","meanings":[{{"partOfSpeech":"noun/verb/adjective/etc","definitions":[{{"definition":"Clear 1-2 sentence definition"}}]}}]}}

Rules:
- If it's an acronym, expand it first
- If it's technical jargon, explain simply
- Keep definition concise (under 2 sentences)
- Return ONLY the JSON, nothing else"""

        gemini_url = f"{GEMINI_API_URL}?key={GEMINI_API_KEY}"
        gemini_payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 500
            }
        }

        response = requests.post(gemini_url, json=gemini_payload, timeout=5)

        if response.status_code == 200:
            gemini_data = response.json()

            # Extract text from Gemini response
            if 'candidates' in gemini_data and len(gemini_data['candidates']) > 0:
                candidate = gemini_data['candidates'][0]
                if 'content' in candidate and 'parts' in candidate['content']:
                    text = candidate['content']['parts'][0]['text'].strip()

                    # Clean markdown code fences if present
                    import re
                    text = re.sub(r'```json\s*', '', text)
                    text = re.sub(r'```\s*', '', text)
                    text = text.strip()

                    # Parse JSON
                    definition_data = json.loads(text)

                    if 'meanings' in definition_data and definition_data['meanings']:
                        print(f"[Dictionary] Gemini found {len(definition_data['meanings'])} meanings for '{word}'")
                        return jsonify(definition_data)

    except Exception as e:
        print(f"[Dictionary] Gemini failed: {e}")

    # TRY 2: Wiktionary API (free backup)
    try:
        print(f"[Dictionary] Trying Wiktionary for '{word}'")
        url = f"https://en.wiktionary.org/api/rest_v1/page/definition/{word}"
        headers = {'User-Agent': 'Clara/1.0 (Reading App)'}

        response = requests.get(url, headers=headers, timeout=5)

        if response.status_code == 200:
            wikt_data = response.json()

            # Parse Wiktionary response
            meanings = []
            for lang_section in wikt_data.get('en', []):
                part_of_speech = lang_section.get('partOfSpeech', 'unknown')

                definitions = []
                for defn in lang_section.get('definitions', [])[:2]:  # Max 2 definitions
                    def_text = defn.get('definition', '')
                    # Clean HTML tags
                    import re
                    def_text = re.sub('<[^<]+?>', '', def_text)

                    definitions.append({
                        'definition': def_text
                    })

                if definitions:
                    meanings.append({
                        'partOfSpeech': part_of_speech,
                        'definitions': definitions
                    })

            if meanings:
                print(f"[Dictionary] Wiktionary found {len(meanings)} meanings for '{word}'")
                return jsonify({
                    'word': word,
                    'meanings': meanings
                })

    except Exception as e:
        print(f"[Dictionary] Wiktionary failed: {e}")

    # FALLBACK: Show word in context
    print(f"[Dictionary] Showing context for '{word}'")

    if context_sentence:
        contextual_def = f"As used here: {context_sentence}"
    elif full_context:
        contextual_def = f"Context: {full_context[:200]}..."
    else:
        contextual_def = "No definition or context available"

    return jsonify({
        'word': word,
        'meanings': [
            {
                'partOfSpeech': 'contextual usage',
                'definitions': [
                    {
                        'definition': contextual_def
                    }
                ]
            }
        ]
    })

@app.route('/status', methods=['GET'])
def status():
    """Get current playback status"""
    return jsonify({
        'is_playing': is_playing,
        'position': current_position,
        'total_chunks': len(current_chunks),
        'document': current_document['name'] if current_document else None
    })

# ============================================================
# AI SETTINGS ENDPOINTS
# ============================================================

# ============================================================
# LIBRARY ENDPOINTS
# ============================================================

@app.route('/library', methods=['GET'])
def get_library():
    """Get full library structure (folders and documents)"""
    conn = get_db()
    cursor = conn.cursor()

    # Get all folders
    cursor.execute('SELECT id, name, parent_id, created_at FROM folders ORDER BY name')
    folders = [dict(row) for row in cursor.fetchall()]

    # Get all documents
    cursor.execute('''
        SELECT id, name, original_filename, folder_id, total_chunks,
               last_position, last_opened_at, created_at
        FROM documents ORDER BY last_opened_at DESC NULLS LAST, created_at DESC
    ''')
    documents = [dict(row) for row in cursor.fetchall()]

    conn.close()

    # Calculate progress for each document
    for doc in documents:
        if doc['total_chunks'] and doc['total_chunks'] > 0:
            doc['progress'] = round((doc['last_position'] / doc['total_chunks']) * 100)
        else:
            doc['progress'] = 0

    return jsonify({
        'folders': folders,
        'documents': documents
    })

@app.route('/library/folder', methods=['POST'])
def create_folder():
    """Create a new folder"""
    data = request.get_json()
    name = data.get('name', '').strip()
    parent_id = data.get('parent_id')

    if not name:
        return jsonify({'error': 'Folder name is required'}), 400

    # Check nesting depth (max 3 levels)
    if parent_id:
        conn = get_db()
        cursor = conn.cursor()
        depth = 1
        current_parent = parent_id
        while current_parent:
            cursor.execute('SELECT parent_id FROM folders WHERE id = ?', (current_parent,))
            row = cursor.fetchone()
            if row and row['parent_id']:
                depth += 1
                current_parent = row['parent_id']
            else:
                break
        conn.close()
        if depth >= 3:
            return jsonify({'error': 'Maximum folder depth (3 levels) reached'}), 400

    folder_id = str(uuid.uuid4())
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO folders (id, name, parent_id, created_at)
        VALUES (?, ?, ?, ?)
    ''', (folder_id, name, parent_id, datetime.now()))
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'id': folder_id,
        'name': name,
        'parent_id': parent_id
    })

@app.route('/library/folder/<folder_id>', methods=['PUT'])
def update_folder(folder_id):
    """Rename a folder"""
    data = request.get_json()
    name = data.get('name', '').strip()

    if not name:
        return jsonify({'error': 'Folder name is required'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE folders SET name = ? WHERE id = ?', (name, folder_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

@app.route('/library/folder/<folder_id>', methods=['DELETE'])
def delete_folder(folder_id):
    """Delete a folder (moves contents to parent)"""
    conn = get_db()
    cursor = conn.cursor()

    # Get folder's parent
    cursor.execute('SELECT parent_id FROM folders WHERE id = ?', (folder_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Folder not found'}), 404

    parent_id = row['parent_id']

    # Move all documents to parent folder
    cursor.execute('UPDATE documents SET folder_id = ? WHERE folder_id = ?', (parent_id, folder_id))

    # Move all subfolders to parent folder
    cursor.execute('UPDATE folders SET parent_id = ? WHERE parent_id = ?', (parent_id, folder_id))

    # Delete the folder
    cursor.execute('DELETE FROM folders WHERE id = ?', (folder_id,))

    conn.commit()
    conn.close()

    return jsonify({'success': True})

@app.route('/library/document/<doc_id>/move', methods=['PUT'])
def move_document(doc_id):
    """Move a document to a different folder"""
    data = request.get_json()
    folder_id = data.get('folder_id')  # None means root level

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE documents SET folder_id = ? WHERE id = ?', (folder_id, doc_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

@app.route('/library/folder/<folder_id>/move', methods=['PUT'])
def move_folder(folder_id):
    """Move a folder to a different parent (nest/unnest)"""
    data = request.get_json()
    new_parent_id = data.get('parent_id')  # None means root level

    # Prevent moving folder into itself or its descendants
    if new_parent_id:
        conn = get_db()
        cursor = conn.cursor()

        # Check if new_parent_id is a descendant of folder_id
        def is_descendant(potential_parent, folder):
            if potential_parent == folder:
                return True
            cursor.execute('SELECT parent_id FROM folders WHERE id = ?', (potential_parent,))
            row = cursor.fetchone()
            if row and row['parent_id']:
                return is_descendant(row['parent_id'], folder)
            return False

        if is_descendant(new_parent_id, folder_id):
            conn.close()
            return jsonify({'error': 'Cannot move folder into its own subfolder'}), 400

        cursor.execute('UPDATE folders SET parent_id = ? WHERE id = ?', (new_parent_id, folder_id))
        conn.commit()
        conn.close()
    else:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE folders SET parent_id = NULL WHERE id = ?', (folder_id,))
        conn.commit()
        conn.close()

    return jsonify({'success': True})

@app.route('/library/document/<doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    """Delete a document"""
    conn = get_db()
    cursor = conn.cursor()

    # Get file path to delete the actual file
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    if row and row['file_path']:
        try:
            Path(row['file_path']).unlink(missing_ok=True)
        except Exception:
            pass  # File might already be deleted

    # Delete from database
    cursor.execute('DELETE FROM documents WHERE id = ?', (doc_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

@app.route('/library/document/<doc_id>/rename', methods=['PUT'])
def rename_document(doc_id):
    """Rename a document"""
    data = request.get_json()
    name = data.get('name', '').strip()

    if not name:
        return jsonify({'error': 'Name is required'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE documents SET name = ? WHERE id = ?', (name, doc_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

@app.route('/document/<doc_id>', methods=['GET'])
def get_document(doc_id):
    """Get document metadata and load it for reading"""
    global current_document, current_chunks, current_position

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, name, original_filename, file_path, total_chunks, last_position
        FROM documents WHERE id = ?
    ''', (doc_id,))
    row = cursor.fetchone()

    if not row:
        conn.close()
        return jsonify({'error': 'Document not found'}), 404

    doc = dict(row)

    # Update last opened timestamp
    cursor.execute('UPDATE documents SET last_opened_at = ? WHERE id = ?', (datetime.now(), doc_id))
    conn.commit()
    conn.close()

    # Load document into memory
    filepath = doc['file_path']
    try:
        if filepath.endswith('.pdf'):
            text = parse_pdf(filepath)
        else:
            text = parse_text_file(filepath)

        chunks = chunk_text(text)

        current_document = {
            'id': doc_id,
            'name': doc['original_filename'],
            'path': filepath,
            'text': text
        }
        current_chunks = chunks
        current_position = doc['last_position'] or 0

        # Create embeddings in background
        def create_embeddings_background():
            create_embeddings(chunks)
        threading.Thread(target=create_embeddings_background, daemon=True).start()

        return jsonify({
            'success': True,
            'id': doc_id,
            'name': doc['name'],
            'filename': doc['original_filename'],
            'total_chunks': len(chunks),
            'last_position': current_position,
            'preview': chunks[current_position][:200] + '...' if chunks else ''
        })

    except Exception as e:
        return jsonify({'error': f'Failed to load document: {str(e)}'}), 500

@app.route('/document/<doc_id>/position', methods=['PUT'])
def save_position(doc_id):
    """Save the current reading position"""
    global current_position

    data = request.get_json()
    position = data.get('position', 0)

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE documents SET last_position = ? WHERE id = ?', (position, doc_id))
    conn.commit()
    conn.close()

    current_position = position

    return jsonify({'success': True})

# ============================================================
# PDF VIEWER ENDPOINTS
# ============================================================

@app.route('/document/<doc_id>/info', methods=['GET'])
def get_document_info(doc_id):
    """Get document info including page count for PDFs"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path, original_filename FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Document not found'}), 404

    filepath = row['file_path']
    filename = row['original_filename']
    is_pdf = filepath.endswith('.pdf')

    result = {
        'id': doc_id,
        'filename': filename,
        'is_pdf': is_pdf,
        'page_count': 0
    }

    if is_pdf:
        try:
            reader = pypdf.PdfReader(filepath)
            result['page_count'] = len(reader.pages)
        except Exception as e:
            result['error'] = str(e)

    return jsonify(result)

@app.route('/document/<doc_id>/page/<int:page_num>', methods=['GET'])
def get_pdf_page(doc_id, page_num):
    """Render a PDF page as an image"""
    print(f"\n[PDF Page Request] doc_id={doc_id}, page={page_num}")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        print(f"[PDF Page Request] Document not found: {doc_id}")
        return jsonify({'error': 'Document not found'}), 404

    filepath = row['file_path']
    print(f"[PDF Page Request] File path: {filepath}")

    if not filepath.endswith('.pdf'):
        print(f"[PDF Page Request] Not a PDF: {filepath}")
        return jsonify({'error': 'Not a PDF document'}), 400

    try:
        # Try using pdf2image (requires poppler)
        if PDF2IMAGE_AVAILABLE:
            try:
                print(f"[PDF Render] Converting page {page_num} to image for doc {doc_id}")
                images = convert_from_path(filepath, first_page=page_num + 1, last_page=page_num + 1, dpi=150)
                if images:
                    img_buffer = io.BytesIO()
                    images[0].save(img_buffer, format='PNG')
                    img_buffer.seek(0)
                    response = send_file(
                        img_buffer,
                        mimetype='image/png',
                        as_attachment=False,
                        download_name=f'page_{page_num}.png'
                    )
                    # Prevent caching to ensure fresh images
                    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                    response.headers['Pragma'] = 'no-cache'
                    response.headers['Expires'] = '0'
                    print(f"[PDF Render] Successfully rendered page {page_num} as image")
                    return response
                else:
                    print(f"[PDF Render] No images returned for page {page_num}")
                    return jsonify({'error': 'Failed to convert PDF page to image'}), 500
            except Exception as pdf_err:
                print(f"[PDF Render ERROR] Failed to convert page {page_num}: {pdf_err}")
                import traceback
                traceback.print_exc()
                # Don't fall through - return error so frontend can handle it
                return jsonify({'error': f'PDF conversion failed: {str(pdf_err)}'}), 500
        else:
            print(f"[PDF Render] pdf2image not available, cannot render as image")
            return jsonify({'error': 'pdf2image not available - install Poppler'}), 500

    except Exception as e:
        print(f"[PDF Render ERROR] Unexpected error in get_pdf_page: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/document/<doc_id>/thumbnail/<int:page_num>', methods=['GET'])
def get_pdf_thumbnail(doc_id, page_num):
    """Get a thumbnail for a PDF page"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Document not found'}), 404

    filepath = row['file_path']
    if not filepath.endswith('.pdf'):
        return jsonify({'error': 'Not a PDF document'}), 400

    # Check cache
    thumb_path = THUMBNAILS_FOLDER / f"{doc_id}_page_{page_num}.png"
    if thumb_path.exists():
        return send_file(thumb_path, mimetype='image/png')

    if not PDF2IMAGE_AVAILABLE:
        return jsonify({'error': 'pdf2image not available', 'page': page_num}), 200

    try:
        images = convert_from_path(filepath, first_page=page_num + 1, last_page=page_num + 1, dpi=50)
        if images:
            # Resize for thumbnail
            thumb = images[0]
            thumb.thumbnail((120, 160))
            thumb.save(thumb_path, format='PNG')
            return send_file(thumb_path, mimetype='image/png')
    except Exception as e:
        print(f"Error creating thumbnail for page {page_num}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/document/<doc_id>/page/<int:page_num>/text', methods=['GET'])
def get_page_text(doc_id, page_num):
    """Get cleaned text content of a specific PDF page for TTS.

    Uses the same filtering as /words endpoint to ensure TTS reads
    only the main content (not headers, footers, copyright, etc.)
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Document not found'}), 404

    filepath = row['file_path']

    try:
        if filepath.endswith('.pdf'):
            import fitz  # PyMuPDF

            doc = fitz.open(filepath)
            if page_num >= len(doc):
                doc.close()
                return jsonify({'error': 'Page not found'}), 404

            page = doc[page_num]
            page_rect = page.rect
            page_height = page_rect.height
            page_width = page_rect.width

            # Same filtering as /words endpoint
            TOP_MARGIN = 0.04      # Skip top 4% (page numbers, running headers)
            BOTTOM_MARGIN = 0.94   # Skip bottom 6% (footers, page numbers)
            LEFT_MARGIN = 0.05
            RIGHT_MARGIN = 0.95
            MIN_FONT_HEIGHT = 5.5  # Lowered to capture research paper body text (6-7pt)

            words_data = page.get_text("words")

            # Smart filtering: skip non-content text that humans wouldn't read
            import re
            def should_skip_word(text, rel_y, rel_x, is_isolated=False):
                """Intelligently skip page numbers, citations, metadata, etc."""
                text = text.strip()
                if not text:
                    return True

                # Skip standalone page numbers (near edges)
                if re.match(r'^\d{1,4}$', text):
                    if rel_y < 0.08 or rel_y > 0.92 or rel_x < 0.08 or rel_x > 0.92:
                        return True
                    if len(text) <= 2 and is_isolated:
                        return True

                # Skip citation references [1], [23], [1,2], [1-5], [1e5]
                if re.match(r'^\[\d+[\d,\-e\s]*\]$', text):
                    return True

                # Skip parenthetical refs (1), (23)
                if re.match(r'^\(\d{1,3}\)$', text):
                    return True

                # Skip metadata in margins
                if rel_y < 0.1 or rel_y > 0.9:
                    metadata_patterns = [
                        r'^©', r'^\d{4}$', r'^doi[:.]', r'^https?://', r'^www\.',
                        r'^ISSN', r'^ISBN', r'^Vol\.', r'^No\.', r'^pp\.',
                    ]
                    for pattern in metadata_patterns:
                        if re.match(pattern, text, re.IGNORECASE):
                            return True

                # Skip footnote markers when isolated
                if is_isolated and len(text) == 1 and text in '*†‡§¶':
                    return True

                # Skip isolated superscript letters (author affiliations like a, b, c)
                if is_isolated and re.match(r'^[a-j]$', text):
                    return True

                return False

            # Filter words
            word_list = []
            for w in words_data:
                x0, y0, x1, y1, text, block, line, word_idx = w
                rel_y = y0 / page_height
                rel_x = x0 / page_width
                rel_x_end = x1 / page_width
                font_height = y1 - y0

                if rel_y < TOP_MARGIN or rel_y > BOTTOM_MARGIN:
                    continue
                if rel_x < LEFT_MARGIN or rel_x_end > RIGHT_MARGIN:
                    continue
                if font_height < MIN_FONT_HEIGHT:
                    continue
                if not text.strip():
                    continue

                word_list.append({
                    'text': text, 'line': line, 'block': block,
                    'y': y0, 'rel_y': rel_y, 'rel_x': rel_x
                })

            # Second pass: apply smart filtering and join hyphenated words
            filtered_words = []
            i = 0
            while i < len(word_list):
                word = word_list[i]
                text = word['text']

                # Check if word is isolated (different block from neighbors)
                is_isolated = True
                if i > 0 and word_list[i-1]['block'] == word['block']:
                    is_isolated = False
                if i < len(word_list) - 1 and word_list[i+1]['block'] == word['block']:
                    is_isolated = False

                # Apply smart filtering
                if should_skip_word(text, word['rel_y'], word['rel_x'], is_isolated):
                    i += 1
                    continue

                # Handle hyphenated words
                if text.endswith('-') and i + 1 < len(word_list):
                    next_word = word_list[i + 1]
                    is_continuation = (
                        next_word['line'] == word['line'] + 1 or
                        (next_word['block'] == word['block'] + 1 and next_word['line'] == 0) or
                        next_word['y'] > word['y'] + 5
                    )
                    if is_continuation:
                        filtered_words.append(text[:-1] + next_word['text'])
                        i += 2
                        continue

                filtered_words.append(text)
                i += 1

            doc.close()
            text = ' '.join(filtered_words)

        else:
            with open(filepath, 'r', encoding='utf-8') as f:
                text = f.read()

        return jsonify({
            'page': page_num,
            'text': text
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/document/<doc_id>/page/<int:page_num>/words', methods=['GET'])
def get_page_words(doc_id, page_num):
    """Get word positions from a PDF page for highlighting overlay.

    Smart filtering removes:
    - Page numbers, citation references [1], (2)
    - Headers/footers with publication metadata
    - Footnote markers, isolated superscripts
    - Very small text (copyright, etc.)

    Also joins hyphenated words split across lines.
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Document not found'}), 404

    filepath = row['file_path']
    if not filepath.endswith('.pdf'):
        return jsonify({'error': 'Word positions only available for PDFs'}), 400

    try:
        import fitz  # PyMuPDF
        import re

        doc = fitz.open(filepath)
        if page_num >= len(doc):
            doc.close()
            return jsonify({'error': 'Page not found'}), 404

        page = doc[page_num]
        page_rect = page.rect
        page_height = page_rect.height
        page_width = page_rect.width

        # Define content area boundaries
        TOP_MARGIN = 0.04
        BOTTOM_MARGIN = 0.94
        LEFT_MARGIN = 0.05
        RIGHT_MARGIN = 0.95
        MIN_FONT_HEIGHT = 5.5

        # Smart filtering function (same as /text endpoint)
        def should_skip_word(text, rel_y, rel_x, is_isolated=False):
            """Intelligently skip page numbers, citations, metadata, etc."""
            text = text.strip()
            if not text:
                return True

            # Skip standalone page numbers (near edges)
            if re.match(r'^\d{1,4}$', text):
                if rel_y < 0.08 or rel_y > 0.92 or rel_x < 0.08 or rel_x > 0.92:
                    return True
                if len(text) <= 2 and is_isolated:
                    return True

            # Skip citation references [1], [23], [1,2], [1-5], [1e5]
            if re.match(r'^\[\d+[\d,\-e\s]*\]$', text):
                return True

            # Skip parenthetical refs (1), (23)
            if re.match(r'^\(\d{1,3}\)$', text):
                return True

            # Skip metadata in margins
            if rel_y < 0.1 or rel_y > 0.9:
                metadata_patterns = [
                    r'^©', r'^\d{4}$', r'^doi[:.]', r'^https?://', r'^www\.',
                    r'^ISSN', r'^ISBN', r'^Vol\.', r'^No\.', r'^pp\.',
                ]
                for pattern in metadata_patterns:
                    if re.match(pattern, text, re.IGNORECASE):
                        return True

            # Skip footnote markers when isolated
            if is_isolated and len(text) == 1 and text in '*†‡§¶':
                return True

            # Skip isolated superscript letters (author affiliations)
            if is_isolated and re.match(r'^[a-j]$', text):
                return True

            return False

        words_data = page.get_text("words")

        # First pass: basic position filtering
        raw_words = []
        for w in words_data:
            x0, y0, x1, y1, text, block, line, word_idx = w
            rel_y = y0 / page_height
            rel_x = x0 / page_width
            rel_x_end = x1 / page_width
            font_height = y1 - y0

            if rel_y < TOP_MARGIN or rel_y > BOTTOM_MARGIN:
                continue
            if rel_x < LEFT_MARGIN or rel_x_end > RIGHT_MARGIN:
                continue
            if font_height < MIN_FONT_HEIGHT:
                continue
            if not text.strip():
                continue

            raw_words.append({
                'text': text,
                'x': (x0 / page_width) * 100,
                'y': (y0 / page_height) * 100,
                'w': ((x1 - x0) / page_width) * 100,
                'h': ((y1 - y0) / page_height) * 100,
                'block': block,
                'line': line,
                'rel_y': rel_y,
                'rel_x': rel_x
            })

        # Second pass: smart filtering and hyphen joining
        words = []
        i = 0
        while i < len(raw_words):
            word = raw_words[i]
            text = word['text']

            # Check if word is isolated
            is_isolated = True
            if i > 0 and raw_words[i-1]['block'] == word['block']:
                is_isolated = False
            if i < len(raw_words) - 1 and raw_words[i+1]['block'] == word['block']:
                is_isolated = False

            # Apply smart filtering
            if should_skip_word(text, word['rel_y'], word['rel_x'], is_isolated):
                i += 1
                continue

            # Handle hyphenated words
            if text.endswith('-') and i + 1 < len(raw_words):
                next_word = raw_words[i + 1]
                is_continuation = (
                    next_word['line'] == word['line'] + 1 or
                    (next_word['block'] == word['block'] + 1 and next_word['line'] == 0) or
                    next_word['y'] > word['y'] + word['h'] * 0.5
                )
                if is_continuation:
                    words.append({
                        'text': text[:-1] + next_word['text'],
                        'x': word['x'],
                        'y': word['y'],
                        'w': word['w'],
                        'h': word['h']
                    })
                    i += 2
                    continue

            words.append({
                'text': text,
                'x': word['x'],
                'y': word['y'],
                'w': word['w'],
                'h': word['h']
            })
            i += 1

        doc.close()

        return jsonify({
            'page': page_num,
            'width': page_width,
            'height': page_height,
            'words': words
        })

    except ImportError:
        return jsonify({'error': 'PyMuPDF not installed'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/play-text', methods=['POST'])
def play_text():
    """Generate audio for arbitrary text (used for page-based reading) with caching.

    Now captures word timings from the SAME Edge TTS stream as audio for perfect sync!
    """
    data = request.get_json()
    text = data.get('text', '')
    voice = data.get('voice', 'female')

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    # Create cache key from text + voice
    cache_key = hashlib.md5(f"{text}:{voice}".encode()).hexdigest()
    cache_file = AUDIO_CACHE_FOLDER / f"{cache_key}.mp3"
    timings_cache_file = AUDIO_CACHE_FOLDER / f"{cache_key}_timings.json"

    # Check cache first
    if cache_file.exists():
        print(f"[TTS CACHE HIT] Returning cached audio ({cache_key[:8]}...)")
        return send_file(cache_file, mimetype='audio/mpeg')

    # Log text length for debugging
    word_count = len(text.split())
    char_count = len(text)
    print(f"[TTS CACHE MISS] Generating audio + timings: {word_count} words, {char_count} chars")

    # Generous timeout - NEVER fail, reading must always work
    base_timeout = 60
    timeout = min(base_timeout + (word_count * 0.2), 180)
    print(f"[TTS] Timeout: {timeout:.0f}s for {word_count} words")

    # Progressive fallback: try full text, then truncate if timeout
    attempts = [
        (text, word_count, "full text"),
        (' '.join(text.split()[:400]), 400, "400 words"),
        (' '.join(text.split()[:250]), 250, "250 words"),
        (' '.join(text.split()[:100]), 100, "100 words")
    ]

    last_error = None
    for attempt_text, attempt_words, attempt_desc in attempts:
        try:
            print(f"[TTS] Attempting: {attempt_desc}")
            start_time = time.time()
            # Use new unified function that captures BOTH audio and timings
            audio_path, word_timings = generate_audio_with_timings(attempt_text, voice, timeout=timeout)
            gen_time = time.time() - start_time
            print(f"[TTS] SUCCESS: {gen_time:.2f}s ({attempt_words} words, {len(word_timings)} timing events)")

            with open(audio_path, 'rb') as f:
                audio_data = f.read()

            os.unlink(audio_path)

            # Save BOTH audio and timings to cache for perfect sync
            try:
                cache_file.write_bytes(audio_data)
                # Cache timings alongside audio with matching key
                if word_timings:
                    import json
                    timings_cache_file.write_text(json.dumps(word_timings))
                    print(f"[TTS] Cached audio + {len(word_timings)} word timings: {cache_key[:8]}...")
                else:
                    print(f"[TTS] Cached audio (no timings available): {cache_key[:8]}...")
            except Exception as cache_error:
                print(f"[TTS] Warning: Failed to cache: {cache_error}")

            mimetype = 'audio/mpeg' if audio_path.endswith('.mp3') else 'audio/wav'
            return Response(audio_data, mimetype=mimetype)

        except Exception as e:
            last_error = e
            print(f"[TTS] Failed {attempt_desc}: {e}")
            if attempt_words > 100:
                print(f"[TTS] Retrying with shorter text...")
                continue
            else:
                break

    # All attempts failed
    print(f"[TTS] FATAL: All attempts failed: {last_error}")
    return jsonify({'error': f'TTS failed after multiple attempts: {str(last_error)}'}), 500

@app.route('/word-timings', methods=['POST'])
def word_timings():
    """Get word-level timing data synchronized with the generated audio.

    IMPORTANT: These timings are now captured from the SAME Edge TTS stream
    as the audio (via /play-text), ensuring perfect synchronization.
    """
    data = request.get_json()
    text = data.get('text', '')
    voice = data.get('voice', 'female')

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    import json

    # Use the SAME cache key as /play-text to get synchronized timings
    cache_key = hashlib.md5(f"{text}:{voice}".encode()).hexdigest()
    timings_cache_file = AUDIO_CACHE_FOLDER / f"{cache_key}_timings.json"

    # Check for synchronized timings (created by /play-text)
    if timings_cache_file.exists():
        print(f"[TIMING] Using synchronized timings from audio generation ({cache_key[:8]}...)")
        try:
            timings_data = json.loads(timings_cache_file.read_text())
            print(f"[TIMING] Returning {len(timings_data)} perfectly synchronized word timings")
            return jsonify(timings_data)
        except Exception as e:
            print(f"[TIMING] Cache read error: {e}")

    # Fallback: check old-style timing cache
    old_cache_key = hashlib.md5(f"{text}:{voice}:timings".encode()).hexdigest()
    old_cache_file = AUDIO_CACHE_FOLDER / f"{old_cache_key}.json"
    if old_cache_file.exists():
        print(f"[TIMING] Using legacy timing cache ({old_cache_key[:8]}...)")
        try:
            timings_data = json.loads(old_cache_file.read_text())
            return jsonify(timings_data)
        except Exception as e:
            print(f"[TIMING] Legacy cache read error: {e}")

    # No cached timings - generate new ones (this shouldn't happen normally
    # since /play-text generates timings, but it's a fallback)
    if not EDGE_TTS_AVAILABLE:
        print("[TIMING] Edge TTS not available, returning empty (frontend will estimate)")
        return jsonify([])

    try:
        import edge_tts
        import asyncio

        voice_name = TTS_VOICES.get(voice, TTS_VOICES['female'])
        word_count = len(text.split())
        print(f"[TIMING] Generating fallback timings for {word_count} words")

        async def get_timings():
            timings = []
            communicate = edge_tts.Communicate(text, voice_name)
            async for chunk in communicate.stream():
                if chunk["type"] == "WordBoundary":
                    offset_sec = chunk["offset"] / 10_000_000
                    duration_sec = chunk["duration"] / 10_000_000
                    timings.append({
                        "text": chunk["text"],
                        "offset": offset_sec,
                        "duration": duration_sec
                    })
            return timings

        timeout = min(60 + (word_count * 0.2), 180)

        try:
            timings_data = asyncio.run(
                asyncio.wait_for(get_timings(), timeout=timeout)
            )
        except asyncio.TimeoutError:
            print(f"[TIMING] Timeout after {timeout}s, returning empty")
            return jsonify([])

        print(f"[TIMING] Got {len(timings_data)} word boundaries")

        if len(timings_data) > 0:
            print(f"[TIMING] First 3 words: {timings_data[:3]}")
            print(f"[TIMING] Last word ends at: {timings_data[-1]['offset'] + timings_data[-1]['duration']:.2f}s")

        # Cache the timing data
        try:
            cache_file.write_text(json.dumps(timings_data))
            print(f"[TIMING] Cached timings: {cache_key[:8]}...")
        except Exception as cache_error:
            print(f"[TIMING] Warning: Failed to cache timings: {cache_error}")

        return jsonify(timings_data)

    except Exception as e:
        print(f"[TIMING] Error generating timings: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

def split_into_sentence_chunks(text, sentences_per_chunk=3):
    """Split text into small sentence chunks for fast initial playback"""
    import re

    # Split into sentences (handle common patterns)
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
    sentences = [s.strip() for s in sentences if s.strip()]

    # If no proper sentences found, split by periods anyway
    if len(sentences) == 1 and len(text) > 100:
        sentences = [s.strip() + '.' for s in text.split('.') if s.strip()]

    chunks = []
    for i in range(0, len(sentences), sentences_per_chunk):
        chunk = ' '.join(sentences[i:i + sentences_per_chunk])
        if chunk:
            chunks.append(chunk)

    return chunks if chunks else [text]  # Fallback to full text if splitting fails

def split_into_chunks(text, max_words=30):
    """Split text into chunks, preferring sentence boundaries"""
    import re

    # Split into sentences
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current_chunk = []
    current_word_count = 0

    for sentence in sentences:
        words = sentence.split()
        word_count = len(words)

        # If adding this sentence exceeds max_words and we have content, start new chunk
        if current_word_count + word_count > max_words and current_chunk:
            chunks.append(' '.join(current_chunk))
            current_chunk = [sentence]
            current_word_count = word_count
        else:
            current_chunk.append(sentence)
            current_word_count += word_count

    # Add remaining chunk
    if current_chunk:
        chunks.append(' '.join(current_chunk))

    return chunks

@app.route('/play-text-chunked', methods=['POST'])
def play_text_chunked():
    """Generate audio for specific chunk - optimized for fast initial playback"""
    data = request.get_json()
    text = data.get('text', '')
    voice = data.get('voice', 'female')
    chunk_index = data.get('chunk_index', 0)

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    try:
        # Split into sentence-based chunks (3 sentences each for ~1-2 second generation)
        chunks = split_into_sentence_chunks(text, sentences_per_chunk=3)

        print(f"[TTS-Chunked] Total chunks: {len(chunks)}, Requesting: {chunk_index}")

        # If requesting a specific chunk
        if chunk_index < len(chunks):
            chunk_text = chunks[chunk_index]
            word_count = len(chunk_text.split())
            print(f"[TTS-Chunked] Chunk {chunk_index}: {word_count} words")

            start_time = time.time()
            audio_path = generate_audio(chunk_text, voice, timeout=10)
            gen_time = time.time() - start_time
            print(f"[TTS-Chunked] Generated in {gen_time:.2f}s")

            with open(audio_path, 'rb') as f:
                audio_data = f.read()

            os.unlink(audio_path)

            if audio_path.endswith('.mp3'):
                mimetype = 'audio/mpeg'
            elif audio_path.endswith('.wav'):
                mimetype = 'audio/wav'
            else:
                mimetype = 'audio/aiff'

            # Return audio with metadata
            response = Response(audio_data, mimetype=mimetype)
            response.headers['X-Total-Chunks'] = str(len(chunks))
            response.headers['X-Current-Chunk'] = str(chunk_index)
            response.headers['X-Chunk-Words'] = str(word_count)
            return response
        else:
            return jsonify({'error': 'Invalid chunk index'}), 400

    except Exception as e:
        print(f"[TTS-Chunked] Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/tts/status', methods=['GET'])
def tts_status():
    """Get TTS engine status"""
    return jsonify({
        'edge_tts_available': EDGE_TTS_AVAILABLE,
        'engine': 'edge-tts' if EDGE_TTS_AVAILABLE else 'macos',
        'voices': {
            'female': 'Jenny (Neural)' if EDGE_TTS_AVAILABLE else 'Samantha (macOS)',
            'male': 'Guy (Neural)' if EDGE_TTS_AVAILABLE else 'Alex (macOS)'
        }
    })

# Cache for voices list
_voices_cache = None

@app.route('/tts/voices', methods=['GET'])
def get_tts_voices():
    """Get all available TTS voices grouped by language"""
    global _voices_cache

    if not EDGE_TTS_AVAILABLE:
        return jsonify({
            'engine': 'macos',
            'voices': [
                {'id': 'Samantha', 'name': 'Samantha', 'gender': 'Female', 'locale': 'en-US', 'language': 'English (US)'},
                {'id': 'Alex', 'name': 'Alex', 'gender': 'Male', 'locale': 'en-US', 'language': 'English (US)'}
            ]
        })

    try:
        import edge_tts
        import asyncio

        # Use cache if available
        if _voices_cache is not None:
            return jsonify({'engine': 'edge-tts', 'voices': _voices_cache})

        async def fetch_voices():
            return await edge_tts.list_voices()

        voices_raw = asyncio.run(fetch_voices())

        # Process voices into a cleaner format
        voices = []
        for v in voices_raw:
            locale = v.get('Locale', 'unknown')

            # Map locale to friendly language name
            language_map = {
                'en-US': 'English (US)', 'en-GB': 'English (UK)', 'en-AU': 'English (Australia)',
                'en-IN': 'English (India)', 'en-CA': 'English (Canada)', 'en-IE': 'English (Ireland)',
                'en-NZ': 'English (New Zealand)', 'en-ZA': 'English (South Africa)',
                'es-ES': 'Spanish (Spain)', 'es-MX': 'Spanish (Mexico)',
                'fr-FR': 'French (France)', 'fr-CA': 'French (Canada)',
                'de-DE': 'German', 'it-IT': 'Italian', 'pt-BR': 'Portuguese (Brazil)',
                'zh-CN': 'Chinese (Mandarin)', 'ja-JP': 'Japanese', 'ko-KR': 'Korean',
                'hi-IN': 'Hindi', 'ar-SA': 'Arabic', 'ru-RU': 'Russian'
            }
            language = language_map.get(locale, locale)

            # Get voice personality/style if available
            voice_tag = v.get('VoiceTag', {})
            styles = voice_tag.get('VoicePersonalities', [])
            style = styles[0] if styles else ''

            voices.append({
                'id': v['ShortName'],
                'name': v['ShortName'].replace('Neural', '').replace(locale + '-', '').strip(),
                'gender': v.get('Gender', 'Unknown'),
                'locale': locale,
                'language': language,
                'style': style
            })

        # Sort by language, then gender, then name
        voices.sort(key=lambda x: (x['language'], x['gender'], x['name']))

        _voices_cache = voices
        return jsonify({'engine': 'edge-tts', 'voices': voices})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Sample sentences for voice preview
PREVIEW_SENTENCES = [
    "Hello! I'm Clara, your reading companion. I can read any document aloud with natural, expressive speech.",
    "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet.",
    "Reading is to the mind what exercise is to the body. Let me help you explore the world of knowledge.",
]

@app.route('/tts/preview', methods=['POST'])
def preview_voice():
    """Preview a voice with a sample sentence - streams audio without saving"""
    data = request.get_json()
    voice_id = data.get('voice_id')
    sample_index = data.get('sample_index', 0)
    custom_text = data.get('text')  # Optional custom preview text

    if not voice_id:
        return jsonify({'error': 'voice_id is required'}), 400

    # Use custom text or sample sentence
    text = custom_text if custom_text else PREVIEW_SENTENCES[sample_index % len(PREVIEW_SENTENCES)]

    try:
        if EDGE_TTS_AVAILABLE:
            import edge_tts
            import asyncio

            temp_audio = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False)
            temp_audio.close()

            async def generate():
                communicate = edge_tts.Communicate(text, voice_id)
                await communicate.save(temp_audio.name)

            asyncio.run(generate())

            with open(temp_audio.name, 'rb') as f:
                audio_data = f.read()

            os.unlink(temp_audio.name)
            return Response(audio_data, mimetype='audio/mpeg')
        else:
            # macOS fallback
            temp_audio = tempfile.NamedTemporaryFile(suffix='.aiff', delete=False)
            temp_audio.close()

            subprocess.run(['say', '-v', voice_id, '-o', temp_audio.name, text], capture_output=True)

            with open(temp_audio.name, 'rb') as f:
                audio_data = f.read()

            os.unlink(temp_audio.name)
            return Response(audio_data, mimetype='audio/aiff')

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/tts/samples', methods=['GET'])
def get_preview_samples():
    """Get available sample sentences for voice preview"""
    return jsonify({'samples': PREVIEW_SENTENCES})

@app.route('/tts/voice', methods=['GET'])
def get_current_voice():
    """Get the currently selected TTS voice"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'tts_voice'")
    result = cursor.fetchone()
    conn.close()

    if result:
        return jsonify({'voice_id': result['value']})
    else:
        # Default voice
        default = 'en-US-JennyNeural' if EDGE_TTS_AVAILABLE else 'Samantha'
        return jsonify({'voice_id': default})

@app.route('/tts/voice', methods=['POST'])
def set_current_voice():
    """Set the TTS voice preference"""
    data = request.get_json()
    voice_id = data.get('voice_id')

    if not voice_id:
        return jsonify({'error': 'voice_id is required'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES ('tts_voice', ?, ?)
    ''', (voice_id, datetime.now()))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'voice_id': voice_id})

# ============================================================
# ANNOTATIONS/NOTES ENDPOINTS
# ============================================================

@app.route('/document/<doc_id>/notes', methods=['GET'])
def get_document_notes(doc_id):
    """Get all notes/annotations for a document"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, page_num, content, question, anchor_type,
               anchor_x, anchor_y, anchor_width, anchor_height,
               anchor_text, color, created_at, updated_at
        FROM annotations
        WHERE document_id = ?
        ORDER BY page_num, created_at
    ''', (doc_id,))
    notes = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify({'notes': notes})

@app.route('/document/<doc_id>/notes/page/<int:page_num>', methods=['GET'])
def get_page_notes(doc_id, page_num):
    """Get notes for a specific page"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, page_num, content, question, anchor_type,
               anchor_x, anchor_y, anchor_width, anchor_height,
               anchor_text, color, created_at, updated_at
        FROM annotations
        WHERE document_id = ? AND page_num = ?
        ORDER BY created_at
    ''', (doc_id, page_num))
    notes = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify({'notes': notes})

@app.route('/document/<doc_id>/notes', methods=['POST'])
def create_note(doc_id):
    """Create a new note/annotation"""
    data = request.get_json()

    content = data.get('content', '').strip()
    if not content:
        return jsonify({'error': 'Note content is required'}), 400

    page_num = data.get('page_num', 0)
    question = data.get('question', '')
    anchor_type = data.get('anchor_type', 'selection')
    anchor_x = data.get('anchor_x')
    anchor_y = data.get('anchor_y')
    anchor_width = data.get('anchor_width')
    anchor_height = data.get('anchor_height')
    anchor_text = data.get('anchor_text', '')
    color = data.get('color', '#FFE066')

    note_id = str(uuid.uuid4())
    now = datetime.now()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO annotations (
            id, document_id, page_num, content, question,
            anchor_type, anchor_x, anchor_y, anchor_width, anchor_height,
            anchor_text, color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (note_id, doc_id, page_num, content, question,
          anchor_type, anchor_x, anchor_y, anchor_width, anchor_height,
          anchor_text, color, now, now))
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'id': note_id,
        'page_num': page_num,
        'content': content,
        'question': question,
        'anchor_type': anchor_type,
        'anchor_x': anchor_x,
        'anchor_y': anchor_y,
        'anchor_width': anchor_width,
        'anchor_height': anchor_height,
        'anchor_text': anchor_text,
        'color': color,
        'created_at': now.isoformat(),
        'updated_at': now.isoformat()
    })

@app.route('/notes/<note_id>', methods=['PUT'])
def update_note(note_id):
    """Update an existing note"""
    data = request.get_json()

    content = data.get('content', '').strip()
    if not content:
        return jsonify({'error': 'Note content is required'}), 400

    color = data.get('color')
    now = datetime.now()

    conn = get_db()
    cursor = conn.cursor()

    if color:
        cursor.execute('''
            UPDATE annotations
            SET content = ?, color = ?, updated_at = ?
            WHERE id = ?
        ''', (content, color, now, note_id))
    else:
        cursor.execute('''
            UPDATE annotations
            SET content = ?, updated_at = ?
            WHERE id = ?
        ''', (content, now, note_id))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'updated_at': now.isoformat()})

@app.route('/notes/<note_id>/position', methods=['PUT'])
def update_note_position(note_id):
    """Update a note's position (for drag and drop)"""
    data = request.get_json()

    anchor_x = data.get('anchor_x')
    anchor_y = data.get('anchor_y')
    anchor_text = data.get('anchor_text', '')
    now = datetime.now()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE annotations
        SET anchor_x = ?, anchor_y = ?, anchor_text = ?, updated_at = ?
        WHERE id = ?
    ''', (anchor_x, anchor_y, anchor_text, now, note_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'updated_at': now.isoformat()})

@app.route('/notes/<note_id>', methods=['DELETE'])
def delete_note(note_id):
    """Delete a note"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM annotations WHERE id = ?', (note_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

# ============================================================
# LLM MANAGEMENT ENDPOINTS
# ============================================================

@app.route('/llm/available', methods=['GET'])
def get_available_llms():
    """Get list of available LLMs (catalog + download status)"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, is_default FROM llm_models')
    downloaded = {row['id']: row['is_default'] for row in cursor.fetchall()}
    conn.close()

    models = []
    for llm in AVAILABLE_LLMS:
        model_info = llm.copy()
        model_info['downloaded'] = llm['id'] in downloaded
        model_info['is_default'] = downloaded.get(llm['id'], False)
        model_info['is_active'] = (CURRENT_LLM_ID == llm['id'])
        models.append(model_info)

    return jsonify({
        'models': models,
        'current_model': CURRENT_LLM_ID,
        'llm_available': LLM_AVAILABLE
    })

@app.route('/llm/downloaded', methods=['GET'])
def get_downloaded_llms():
    """Get list of downloaded LLMs"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM llm_models ORDER BY downloaded_at DESC')
    models = [dict(row) for row in cursor.fetchall()]
    conn.close()

    # Enrich with catalog info
    for model in models:
        catalog_info = next((llm for llm in AVAILABLE_LLMS if llm['id'] == model['id']), None)
        if catalog_info:
            model['description'] = catalog_info['description']
            model['parameters'] = catalog_info['parameters']
            model['context_length'] = catalog_info['context_length']
        model['is_active'] = (CURRENT_LLM_ID == model['id'])

    return jsonify({
        'models': models,
        'current_model': CURRENT_LLM_ID,
        'llm_available': LLM_AVAILABLE
    })

@app.route('/llm/download/<model_id>', methods=['POST'])
def download_llm(model_id):
    """Download a specific LLM model"""
    global download_progress

    # Find model in catalog
    model_info = next((llm for llm in AVAILABLE_LLMS if llm['id'] == model_id), None)
    if not model_info:
        return jsonify({'error': 'Model not found'}), 404

    model_path = MODELS_FOLDER / model_info['filename']

    # Check if already downloaded
    if model_path.exists():
        # Add to database if not already there
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM llm_models WHERE id = ?', (model_id,))
        if not cursor.fetchone():
            cursor.execute('''
                INSERT INTO llm_models (id, name, filename, size_mb, downloaded_at)
                VALUES (?, ?, ?, ?, ?)
            ''', (model_id, model_info['name'], model_info['filename'],
                  model_info['size_mb'], datetime.now()))
            conn.commit()
        conn.close()
        return jsonify({'success': True, 'message': 'Model already downloaded'})

    # Check if download is already in progress
    if model_id in download_progress and download_progress[model_id].get('in_progress'):
        return jsonify({'error': 'Download already in progress'}), 400

    # Start download in background thread
    download_progress[model_id] = {'in_progress': True, 'percent': 0, 'error': None}

    def do_download():
        try:
            import urllib.request

            def report_progress(block_num, block_size, total_size):
                downloaded = block_num * block_size
                percent = min(100, (downloaded / total_size) * 100)
                download_progress[model_id]['percent'] = round(percent, 1)
                download_progress[model_id]['downloaded_mb'] = round(downloaded / (1024 * 1024), 1)
                download_progress[model_id]['total_mb'] = round(total_size / (1024 * 1024), 1)

            urllib.request.urlretrieve(model_info['url'], model_path, reporthook=report_progress)

            # Add to database
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO llm_models (id, name, filename, size_mb, downloaded_at)
                VALUES (?, ?, ?, ?, ?)
            ''', (model_id, model_info['name'], model_info['filename'],
                  model_info['size_mb'], datetime.now()))
            conn.commit()
            conn.close()

            download_progress[model_id]['in_progress'] = False
            download_progress[model_id]['complete'] = True
            print(f"[OK] Downloaded {model_info['name']}")

        except Exception as e:
            download_progress[model_id]['in_progress'] = False
            download_progress[model_id]['error'] = str(e)
            if model_path.exists():
                model_path.unlink()
            print(f"[ERROR] Download failed for {model_info['name']}: {e}")

    threading.Thread(target=do_download, daemon=True).start()

    return jsonify({'success': True, 'message': 'Download started'})

@app.route('/llm/download/<model_id>/progress', methods=['GET'])
def get_download_progress(model_id):
    """Get download progress for a model"""
    if model_id not in download_progress:
        return jsonify({'in_progress': False, 'percent': 0})
    return jsonify(download_progress[model_id])

@app.route('/llm/delete/<model_id>', methods=['DELETE'])
def delete_llm(model_id):
    """Delete a downloaded LLM model"""
    global LOCAL_LLM, LLM_AVAILABLE, CURRENT_LLM_ID

    # Find model in catalog
    model_info = next((llm for llm in AVAILABLE_LLMS if llm['id'] == model_id), None)
    if not model_info:
        return jsonify({'error': 'Model not found'}), 404

    model_path = MODELS_FOLDER / model_info['filename']

    # If this is the active model, unload it first
    if CURRENT_LLM_ID == model_id:
        LOCAL_LLM = None
        LLM_AVAILABLE = False
        CURRENT_LLM_ID = None

    # Delete file
    if model_path.exists():
        try:
            model_path.unlink()
        except Exception as e:
            return jsonify({'error': f'Failed to delete file: {e}'}), 500

    # Remove from database
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM llm_models WHERE id = ?', (model_id,))
    conn.commit()
    conn.close()

    # Clear from progress tracking
    if model_id in download_progress:
        del download_progress[model_id]

    return jsonify({'success': True})

@app.route('/llm/switch/<model_id>', methods=['POST'])
def switch_llm(model_id):
    """Switch to a different LLM model"""
    global LOCAL_LLM, LLM_AVAILABLE, CURRENT_LLM_ID, LLM_MODEL_NAME

    # Find model in catalog
    model_info = next((llm for llm in AVAILABLE_LLMS if llm['id'] == model_id), None)
    if not model_info:
        return jsonify({'error': 'Model not found'}), 404

    model_path = MODELS_FOLDER / model_info['filename']

    # Check if model is downloaded
    if not model_path.exists():
        return jsonify({'error': 'Model not downloaded'}), 400

    try:
        from llama_cpp import Llama

        # Unload current model
        LOCAL_LLM = None

        # Load new model
        print(f"  Loading {model_info['name']}...")
        LOCAL_LLM = Llama(
            model_path=str(model_path),
            n_ctx=model_info['context_length'],
            n_threads=4,
            n_gpu_layers=0,
            verbose=False
        )

        LLM_AVAILABLE = True
        CURRENT_LLM_ID = model_id
        LLM_MODEL_NAME = model_info['filename']

        print(f"[OK] Switched to {model_info['name']}")

        return jsonify({
            'success': True,
            'model': model_info['name'],
            'model_id': model_id
        })

    except Exception as e:
        LLM_AVAILABLE = False
        CURRENT_LLM_ID = None
        return jsonify({'error': f'Failed to load model: {e}'}), 500

@app.route('/llm/set-default/<model_id>', methods=['POST'])
def set_default_llm(model_id):
    """Set a model as the default to load on startup"""
    # Verify model is downloaded
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM llm_models WHERE id = ?', (model_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Model not downloaded'}), 400

    # Clear all defaults and set new one
    cursor.execute('UPDATE llm_models SET is_default = 0')
    cursor.execute('UPDATE llm_models SET is_default = 1 WHERE id = ?', (model_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

@app.route('/llm/status', methods=['GET'])
def get_llm_status():
    """Get current LLM status with downloaded and available models for settings UI"""
    # Get downloaded models from database
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM llm_models ORDER BY downloaded_at DESC')
    downloaded_rows = cursor.fetchall()
    conn.close()

    # Build downloaded models list with catalog info
    downloaded_models = []
    downloaded_ids = set()
    for row in downloaded_rows:
        model = dict(row)
        downloaded_ids.add(model['id'])
        catalog_info = next((llm for llm in AVAILABLE_LLMS if llm['id'] == model['id']), None)
        if catalog_info:
            model['description'] = catalog_info.get('description', '')
            model['parameters'] = catalog_info.get('parameters', '')
            model['context_length'] = catalog_info.get('context_length', 0)
        model['is_active'] = (CURRENT_LLM_ID == model['id'])
        downloaded_models.append(model)

    # Build available models list (all models from catalog)
    available_models = []
    for llm in AVAILABLE_LLMS:
        model_info = llm.copy()
        model_info['downloaded'] = llm['id'] in downloaded_ids
        model_info['is_active'] = (CURRENT_LLM_ID == llm['id'])
        available_models.append(model_info)

    # Get current model name
    current_model_name = None
    if CURRENT_LLM_ID:
        current_model = next((llm for llm in AVAILABLE_LLMS if llm['id'] == CURRENT_LLM_ID), None)
        if current_model:
            current_model_name = current_model['name']

    return jsonify({
        'llm_available': LLM_AVAILABLE,
        'current_model': current_model_name,
        'current_model_id': CURRENT_LLM_ID,
        'downloaded_models': downloaded_models,
        'available_models': available_models
    })

@app.route('/document/<doc_id>/toc', methods=['GET'])
def get_document_toc(doc_id):
    """Get table of contents (outline) from a PDF document.

    Uses multiple strategies to extract TOC:
    1. Built-in PDF outline/bookmarks
    2. Smart text analysis for chapters, sections, and headings
    3. Research paper structure detection
    """
    print(f"\n[TOC] Request for document: {doc_id}")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        print(f"[TOC] Document not found: {doc_id}")
        return jsonify({'error': 'Document not found'}), 404

    filepath = row['file_path']
    print(f"[TOC] File path: {filepath}")

    if not filepath.endswith('.pdf'):
        print(f"[TOC] Not a PDF file: {filepath}")
        return jsonify({'error': 'TOC only available for PDFs', 'toc': []}), 200

    if not PYMUPDF_AVAILABLE:
        print(f"[TOC] PyMuPDF not available")
        return jsonify({'error': 'PyMuPDF not installed', 'toc': []}), 200

    try:
        print(f"[TOC] Opening PDF: {filepath}")
        doc = fitz.open(filepath)
        print(f"[TOC] PDF has {len(doc)} pages")

        # Always use manual extraction for better accuracy
        # The native PDF TOC is often incomplete or incorrect
        toc_items = extract_smart_toc(doc)
        doc.close()

        print(f"[TOC] Extracted {len(toc_items)} TOC items")
        print(f"[TOC] Returning response: {len(toc_items)} items")

        return jsonify({
            'toc': toc_items,
            'has_toc': len(toc_items) > 0,
            'source': 'text_analysis' if toc_items else 'none'
        })

    except Exception as e:
        print(f"[TOC] Error extracting TOC: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'toc': []}), 200


def extract_smart_toc(doc):
    """Extract TOC by analyzing text content, fonts, and patterns.

    Focuses on clean, hierarchical extraction by detecting:
    1. Parts/chapters at top of pages
    2. Major section headings (large font, isolated lines)
    3. Numbered sections

    Filters out body text aggressively.
    """
    toc_items = []
    total_pages = len(doc)

    # First pass: detect average body text font size
    body_text_sizes = []
    for page_num in range(min(10, total_pages)):
        page = doc[page_num]
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    if len(span["text"].strip()) > 20:  # Longer text is likely body
                        body_text_sizes.append(span["size"])

    avg_body_size = sum(body_text_sizes) / len(body_text_sizes) if body_text_sizes else 12
    heading_threshold = avg_body_size + 1.0  # Headings should be at least 1pt larger

    print(f"[TOC] Average body text size: {avg_body_size:.1f}pt, heading threshold: {heading_threshold:.1f}pt")

    # Common research paper sections
    research_sections = [
        'preface', 'foreword', 'abstract', 'introduction', 'background', 'related work',
        'literature review', 'methodology', 'methods', 'materials and methods',
        'experimental setup', 'experiment', 'experiments', 'approach',
        'proposed method', 'proposed approach', 'model', 'architecture',
        'implementation', 'results', 'evaluation', 'analysis',
        'discussion', 'conclusion', 'conclusions', 'future work',
        'acknowledgment', 'acknowledgments', 'acknowledgement', 'acknowledgements',
        'references', 'bibliography', 'appendix', 'appendices'
    ]

    # Chapter/section patterns
    patterns = {
        # "Part 1", "PART I" - highest level
        'part': re.compile(r'^(?:part)\s*(\d+|[ivxlc]+|one|two|three|four|five)[\s:.\-]*(.*)$', re.IGNORECASE),
        # "Chapter 1", "CHAPTER I"
        'chapter': re.compile(r'^(?:chapter|chap\.?)\s*(\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)[\s:.\-]*(.*)$', re.IGNORECASE),
        # "1. Introduction", "1 Introduction"
        'numbered_section': re.compile(r'^(\d{1,2})[\.\s]+([A-Z][A-Za-z\s]{2,50})$'),
        # "1.1 Background"
        'subsection': re.compile(r'^(\d{1,2}\.\d{1,2})[\.\s]+([A-Z][A-Za-z\s]{2,50})$'),
        # "1.1.1 Details"
        'subsubsection': re.compile(r'^(\d{1,2}\.\d{1,2}\.\d{1,2})[\.\s]+([A-Z][A-Za-z\s]{2,50})$'),
    }

    seen_titles = set()
    page_headings = []

    # Scan pages
    pages_to_scan = min(total_pages, 100)
    print(f"[TOC] Scanning {pages_to_scan} pages out of {total_pages} total")

    for page_num in range(pages_to_scan):
        page = doc[page_num]

        # Get text blocks with font information
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

        page_height = page.rect.height
        page_width = page.rect.width

        for block in blocks:
            if "lines" not in block:
                continue

            for line in block["lines"]:
                # Get line text and font info
                line_text = ""
                max_font_size = 0
                is_bold = False

                for span in line["spans"]:
                    line_text += span["text"]
                    font_size = span["size"]
                    font_name = span.get("font", "").lower()

                    if font_size > max_font_size:
                        max_font_size = font_size

                    if "bold" in font_name or "heavy" in font_name or "black" in font_name:
                        is_bold = True

                line_text = line_text.strip()

                # Skip empty or very short lines
                if len(line_text) < 3:
                    continue

                # Skip lines that are too long (likely body text)
                if len(line_text) > 80:
                    continue

                # Get line position
                line_y = line["bbox"][1]
                rel_y = line_y / page_height

                # Skip headers (top 5%) and footers (bottom 10%) - often page numbers
                if rel_y < 0.05 or rel_y > 0.90:
                    continue

                # Check for heading patterns
                heading_info = detect_heading(line_text, max_font_size, is_bold,
                                             patterns, research_sections, rel_y, heading_threshold)

                if heading_info:
                    level, title = heading_info

                    # Normalize title for deduplication
                    norm_title = title.lower().strip()
                    if norm_title in seen_titles:
                        continue
                    seen_titles.add(norm_title)

                    page_headings.append({
                        'level': level,
                        'title': title,
                        'page': page_num,
                        'y_position': rel_y,  # Store the relative y position (0-1) on the page
                        'font_size': max_font_size,
                        'is_bold': is_bold
                    })
                    print(f"[TOC] Found heading on page {page_num + 1}: {title} (level={level}, size={max_font_size:.1f}, bold={is_bold})")

    # Post-process headings to normalize levels
    if page_headings:
        toc_items = normalize_heading_levels(page_headings)
        print(f"[TOC] Found {len(toc_items)} headings")
    else:
        print(f"[TOC] No headings found")

    return toc_items


def detect_heading(text, font_size, is_bold, patterns, research_sections, rel_y, heading_threshold):
    """Detect if a line is a heading and return (level, title) or None.

    Much more selective - only returns headings that are clearly structural markers.
    """
    text = text.strip()

    # Skip common non-heading patterns
    skip_patterns = [
        r'^\d+$',  # Just a number
        r'^page\s*\d+',  # "Page 1"
        r'^\d+\s*of\s*\d+',  # "1 of 10"
        r'^figure\s*\d+',  # "Figure 1"
        r'^table\s*\d+',  # "Table 1"
        r'^fig\.\s*\d+',  # "Fig. 1"
        r'^\[.*\]$',  # "[1]" references
        r'^https?://',  # URLs
        r'@.*\.(com|edu|org)',  # Emails
        r'.*[.!?",;]$',  # Ends with punctuation (likely body text)
        r'^(the|a|an|and|or|but|in|on|at|to|for|of|with|from)\s',  # Starts with article/preposition
    ]

    for pattern in skip_patterns:
        if re.match(pattern, text, re.IGNORECASE):
            return None

    # Priority 1: Part markers (highest level)
    match = patterns['part'].match(text)
    if match:
        part_num, part_title = match.groups()
        title = f"Part {part_num}"
        if part_title.strip():
            title += f": {part_title.strip()}"
        return (0, title)  # Level 0 for parts

    # Priority 2: Chapter markers
    match = patterns['chapter'].match(text)
    if match:
        chap_num, chap_title = match.groups()
        title = f"Chapter {chap_num}"
        if chap_title.strip():
            title += f": {chap_title.strip()}"
        return (1, title)

    # Priority 3: Numbered sections (1. 2. 3.)
    match = patterns['numbered_section'].match(text)
    if match:
        return (1, text)

    # Priority 4: Subsections (1.1, 1.2)
    match = patterns['subsection'].match(text)
    if match:
        return (2, text)

    # Priority 5: Sub-subsections (1.1.1)
    match = patterns['subsubsection'].match(text)
    if match:
        return (3, text)

    # Priority 6: Research paper sections (exact matches only)
    text_lower = text.lower().strip()
    if text_lower in research_sections:
        return (1, text.title())

    # Priority 7: Standalone headings at top of page
    # Must be in top 40% of page, large font, and short
    if rel_y < 0.4 and font_size >= heading_threshold and len(text) >= 5 and len(text) <= 60:
        # Must start with capital letter
        if text[0].isupper():
            # Check if it looks like a proper heading (not a sentence fragment)
            words = text.split()
            if len(words) <=10 and len(words) >= 1:  # Reasonable heading length
                return (2, text)

    return None


def normalize_heading_levels(headings):
    """Normalize heading levels to be consistent (1, 2, 3)."""
    if not headings:
        return []

    # Find unique levels and map them
    levels = sorted(set(h['level'] for h in headings))
    level_map = {level: i + 1 for i, level in enumerate(levels)}

    # Ensure we don't have more than 4 levels
    max_level = 4

    result = []
    for h in headings:
        new_level = level_map.get(h['level'], 1)
        if new_level > max_level:
            new_level = max_level

        result.append({
            'level': new_level,
            'title': h['title'],
            'page': h['page'],
            'y_position': h.get('y_position', 0)  # Preserve y position for precise navigation
        })

    return result

# TOC Caching functions
def get_file_hash(filepath):
    """Get MD5 hash of file for cache validation (fast - only reads first/last 64KB)"""
    md5 = hashlib.md5()
    try:
        with open(filepath, 'rb') as f:
            # Read first 64KB
            md5.update(f.read(65536))
            # Try to read last 64KB
            try:
                f.seek(-65536, 2)
                md5.update(f.read(65536))
            except OSError:
                # File smaller than 64KB, that's fine
                pass
        return md5.hexdigest()
    except Exception as e:
        print(f"[TOC] Hash error: {e}")
        return ""

def get_cached_smart_toc(doc_id, doc_path):
    """Multi-layer cache check: memory then disk"""
    global _toc_memory_cache

    # Layer 1: Memory cache (instant)
    if doc_id in _toc_memory_cache:
        print(f"[TOC] Memory cache HIT for {doc_id}")
        return _toc_memory_cache[doc_id]

    # Layer 2: Disk cache
    doc_hash = get_file_hash(doc_path)
    if not doc_hash:
        return None

    cache_file = TOC_CACHE_FOLDER / f"{doc_id}_{doc_hash[:8]}.json"

    if cache_file.exists():
        try:
            import json
            cached_data = json.loads(cache_file.read_text())
            toc = cached_data.get('toc', [])

            # Store in memory for next time
            _toc_memory_cache[doc_id] = toc

            print(f"[TOC] Disk cache HIT for {doc_id}")
            return toc
        except Exception as e:
            print(f"[TOC] Cache read error: {e}")

    return None

def cache_smart_toc(doc_id, doc_path, toc):
    """Save to all cache layers"""
    global _toc_memory_cache

    # Memory cache
    _toc_memory_cache[doc_id] = toc

    # Disk cache
    doc_hash = get_file_hash(doc_path)
    if not doc_hash:
        return

    cache_file = TOC_CACHE_FOLDER / f"{doc_id}_{doc_hash[:8]}.json"

    try:
        import json
        cache_file.write_text(json.dumps({
            'toc': toc,
            'timestamp': time.time(),
            'doc_hash': doc_hash
        }, indent=2))
        print(f"[TOC] Cached TOC for {doc_id}")
    except Exception as e:
        print(f"[TOC] Cache write error: {e}")


# Native PDF TOC extraction (MOST RELIABLE)
def validate_and_clean_toc(toc_entries, doc_path=None):
    """
    Validate and clean TOC entries to ensure quality.
    Removes duplicates, invalid entries, and sorts by page number.

    Args:
        toc_entries: List of TOC entry dicts
        doc_path: Optional path to PDF for validation

    Returns:
        Cleaned and validated TOC entries
    """
    if not toc_entries:
        return []

    # Get total pages if we have doc_path
    total_pages = None
    if doc_path and PYMUPDF_AVAILABLE:
        try:
            import fitz
            doc = fitz.open(doc_path)
            total_pages = len(doc)
            doc.close()
        except:
            pass

    cleaned = []
    seen_entries = set()  # Track (title_lower, page) to avoid duplicates

    for entry in toc_entries:
        try:
            # Validate required fields
            if not isinstance(entry, dict):
                continue

            title = entry.get('title', '').strip()
            page = entry.get('page')
            level = entry.get('level', 1)

            # Skip if missing required fields
            if not title or page is None:
                continue

            # Validate page number
            try:
                page = int(page)
            except (ValueError, TypeError):
                continue

            # Skip negative pages
            if page < 0:
                continue

            # Skip if page exceeds document (if we know total pages)
            if total_pages is not None and page >= total_pages:
                continue

            # Skip very short titles (likely noise)
            if len(title) < 2:
                continue

            # Skip if title is just numbers or special chars
            if title.replace('.', '').replace(' ', '').isdigit():
                continue

            # Create deduplication key
            dedup_key = (title.lower(), page)

            # Skip duplicates
            if dedup_key in seen_entries:
                continue

            seen_entries.add(dedup_key)

            # Add cleaned entry
            cleaned.append({
                'title': title,
                'page': page,
                'level': min(max(int(level), 1), 5),  # Clamp to 1-5
                'source': entry.get('source', 'unknown')
            })

        except Exception as e:
            # Skip malformed entries
            continue

    # Sort by page number
    cleaned.sort(key=lambda x: x['page'])

    return cleaned


def extract_native_pdf_toc(doc_path):
    """
    Extract PDF's built-in TOC
    This ALREADY has correct page numbers!
    Priority: HIGHEST - use this first if available
    """
    if not PYMUPDF_AVAILABLE:
        return []

    try:
        doc = fitz.open(doc_path)
        native_toc = doc.get_toc()  # PyMuPDF extracts embedded TOC
        total_pages = len(doc)  # Get page count BEFORE closing
        doc.close()

        if native_toc:
            formatted_toc = []

            for item in native_toc:
                try:
                    level, title, page = item

                    # Validate page number
                    if page < 1 or page > total_pages:
                        print(f"[TOC] Skipping invalid native entry: {title} (page {page})")
                        continue

                    # Validate title
                    title_clean = title.strip()
                    if not title_clean or len(title_clean) < 1:
                        continue

                    # Page is already correct from PDF metadata!
                    formatted_toc.append({
                        'title': title_clean,
                        'level': min(max(level, 1), 5),  # Clamp level to 1-5
                        'page': page - 1,  # Convert to 0-based
                        'source': 'native'
                    })
                except (ValueError, TypeError, IndexError) as e:
                    print(f"[TOC] Skipping malformed native TOC entry: {e}")
                    continue

            print(f"[TOC] Native PDF TOC: {len(formatted_toc)} entries with CORRECT page numbers")
            return formatted_toc

    except Exception as e:
        print(f"[TOC] Native TOC extraction failed: {e}")

    return []


# TOC Page detection and parsing
def detect_and_parse_toc_page(doc_path):
    """
    Detect if document has a TOC page and extract page numbers from it.
    Works with various formats:
    - "Chapter 1: Introduction ............... 15"
    - "1. Introduction                         15"
    - "Section 1.1 Overview                    42"
    - Books, textbooks, manuals, reports, etc.

    Returns: TOC with CORRECT page numbers extracted from the TOC page
    """
    if not PYMUPDF_AVAILABLE:
        return []

    try:
        import re
        doc = fitz.open(doc_path)

        # TOC is usually in first 20 pages (extended range for longer documents)
        search_range = min(20, len(doc))

        for page_num in range(search_range):
            page = doc[page_num]
            text = page.get_text()
            text_lower = text.lower()

            # Enhanced TOC page indicators
            toc_indicators = [
                'table of contents',
                'contents',
                'index',  # Sometimes used as TOC header
            ]

            # Check for TOC header
            is_toc_page = any(indicator in text_lower[:500] for indicator in toc_indicators)  # Check first 500 chars

            # Check for multiple dotted/dashed line patterns (strong TOC indicator)
            # Look for at least 3 lines with dots/dashes followed by numbers
            dotted_pattern = r'[\.\-\s]{3,}\s*\d{1,4}\s*$'
            dotted_lines = re.findall(dotted_pattern, text, re.MULTILINE)
            has_multiple_dotted_lines = len(dotted_lines) >= 3

            # Check for numbered list pattern (another TOC indicator)
            # Multiple lines starting with numbers like "1.", "2.", "1.1", etc.
            numbered_pattern = r'^\s*\d+\.(?:\d+)?\s+\w+'
            numbered_lines = re.findall(numbered_pattern, text, re.MULTILINE)
            has_numbered_list = len(numbered_lines) >= 3

            # Score-based detection for robustness
            toc_score = 0
            if is_toc_page:
                toc_score += 3
            if has_multiple_dotted_lines:
                toc_score += 2
            if has_numbered_list:
                toc_score += 1

            # Require score >= 2 to consider it a TOC page
            if toc_score >= 2:
                print(f"[TOC] Detected TOC page at page {page_num} (score: {toc_score})")
                toc = parse_toc_page_content(text, page_num)

                if toc and len(toc) >= 2:  # Need at least 2 entries to be valid
                    doc.close()
                    return toc

        doc.close()
    except Exception as e:
        print(f"[TOC] TOC page detection failed: {e}")

    return []


def parse_toc_page_content(text, toc_page_num=0):
    """
    Parse TOC page content to extract chapter titles and page numbers.
    Handles many different TOC formats found in various PDFs.

    Supports:
    - Dotted leaders: "Chapter 1 ............... 15"
    - Dashed leaders: "Chapter 1 -------------- 15"
    - Tabbed spacing: "Chapter 1                15"
    - Numbered sections: "1.1 Introduction        15"
    - Roman numerals: "Part I: Overview        15"
    - Multi-level hierarchy
    """
    import re

    lines = text.split('\n')
    toc = []
    seen_entries = set()  # Track (title, page) to avoid duplicates

    for line in lines:
        line_stripped = line.strip()

        # Skip very short lines and likely headers
        if len(line_stripped) < 5:
            continue

        # Skip lines that are just the word "contents" or page headers
        if line_stripped.lower() in ['contents', 'table of contents', 'index']:
            continue

        # COMPREHENSIVE PATTERN MATCHING
        # Each pattern extracts: (optional_number, title, page_number)

        patterns = [
            # Pattern 1: "Chapter 1: Introduction ............... 15"
            # Pattern 2: "Chapter 1 Introduction ............... 15"
            r'(?:chapter|ch\.?)\s+(\d+)[\:\s]+([^\.]+?)[\.\s\-]{3,}\s*(\d{1,4})\s*$',

            # Pattern 3: "Part I: Getting Started ............. 15"
            # Pattern 4: "Appendix A: Reference ............... 150"
            r'(?:part|appendix|section)\s+([A-Z\d]+)[\:\s]+([^\.]+?)[\.\s\-]{3,}\s*(\d{1,4})\s*$',

            # Pattern 5: "1. Introduction .................... 15"
            # Pattern 6: "1 Introduction ..................... 15"
            r'^(\d+)[\.\s]+([^\.]+?)[\.\s\-]{3,}\s*(\d{1,4})\s*$',

            # Pattern 7: "1.1 Overview ....................... 42"
            # Pattern 8: "2.3.1 Advanced Topics .............. 156"
            r'^(\d+(?:\.\d+){1,3})\s+([^\.]+?)[\.\s\-]{3,}\s*(\d{1,4})\s*$',

            # Pattern 9: "Introduction ........................ 15" (no chapter number)
            r'^([A-Z][^\.]{4,50})[\.\s\-]{5,}\s*(\d{1,4})\s*$',

            # Pattern 10: Tabbed format "Chapter 1 Introduction          15"
            r'(?:chapter|ch\.?)\s+(\d+)\s+([^\.]+?)\s{5,}(\d{1,4})\s*$',

            # Pattern 11: Tabbed numbered "1. Introduction          15"
            r'^(\d+)[\.\)]\s+([^\.]+?)\s{5,}(\d{1,4})\s*$',

            # Pattern 12: Tabbed sections "1.1 Overview             42"
            r'^(\d+(?:\.\d+){1,3})\s+([^\.]+?)\s{5,}(\d{1,4})\s*$',

            # Pattern 13: Generic with any separator "Title ............... 15"
            # (fallback - be careful with this one)
            r'^([^\.]{5,60})[\.\s\-]{5,}\s*(\d{1,4})\s*$',
        ]

        matched = False
        for pattern_idx, pattern in enumerate(patterns):
            match = re.search(pattern, line, re.IGNORECASE)

            if match:
                groups = match.groups()

                # Extract page number (always last group)
                try:
                    page_str = groups[-1]
                    target_page = int(page_str)

                    # Sanity check: page number should be reasonable
                    if target_page < 1 or target_page > 10000:
                        continue

                    # Convert to 0-based
                    target_page -= 1

                    # IMPORTANT: Skip if page number points to TOC page itself or earlier
                    # This prevents self-references like "Contents ... 5" on page 5
                    if target_page <= toc_page_num:
                        continue

                except (ValueError, IndexError):
                    continue

                # Extract title (usually second-to-last, or first if only 2 groups)
                if len(groups) == 2:
                    # Pattern with no chapter number: (title, page)
                    title_part = groups[0].strip()
                    chapter_num = None
                    level = 1
                elif len(groups) == 3:
                    # Pattern with chapter number: (num, title, page)
                    chapter_num = groups[0].strip()
                    title_part = groups[1].strip()

                    # Determine hierarchy level from chapter number
                    if '.' in chapter_num:
                        level = chapter_num.count('.') + 1
                    else:
                        level = 1
                else:
                    continue

                # Clean up title
                title_part = title_part.strip()
                title_part = re.sub(r'\s+', ' ', title_part)  # Normalize whitespace

                # Build full title with proper capitalization from original line
                # (preserving case from PDF)
                title_lower = title_part.lower()
                title_start_idx = line.lower().find(title_lower)

                if title_start_idx >= 0:
                    title_end_idx = title_start_idx + len(title_part)
                    actual_title = line[title_start_idx:title_end_idx].strip()
                else:
                    actual_title = title_part

                # Clean up extracted title
                actual_title = re.sub(r'[\.\-\s]+$', '', actual_title)  # Remove trailing dots/dashes/spaces
                actual_title = actual_title.strip()

                # Validation: title should be reasonable
                if len(actual_title) < 3 or len(actual_title) > 200:
                    continue

                # Skip if looks like a page header or footer
                if actual_title.lower() in ['page', 'chapter', 'section', 'part']:
                    continue

                # Create unique key
                entry_key = (actual_title.lower(), target_page)

                # Avoid duplicates
                if entry_key not in seen_entries:
                    toc.append({
                        'title': actual_title,
                        'level': level,
                        'page': target_page,
                        'source': 'toc_page'
                    })
                    seen_entries.add(entry_key)
                    matched = True
                    break

        # Debug: print unmatched lines that look like they might be TOC entries
        if not matched and len(line_stripped) > 10:
            # Check if line has page number at end
            if re.search(r'\d{1,4}\s*$', line_stripped):
                # Might be a TOC entry we're missing - but don't spam logs
                pass

    print(f"[TOC] Parsed {len(toc)} entries from TOC page")
    return toc


# Multi-source TOC extraction with intelligent prioritization
def extract_toc_multi_source(doc_path):
    """
    Extract TOC from ALL available sources and intelligently merge them.

    Priority order:
    1. Native PDF TOC (highest priority - already has correct pages!)
    2. TOC page parsing (second priority - extracts actual page numbers from TOC)
    3. Font-based heuristics (fallback - analyzes actual content)

    This approach fixes the "TOC page confusion" bug where LLM would
    tag all chapters to the TOC page instead of their actual locations.

    Also implements hybrid merging when appropriate to get best results.
    """
    print("[TOC] Starting multi-source extraction...")

    sources = {}

    # Source 1: Native PDF TOC (HIGHEST PRIORITY)
    native_toc = extract_native_pdf_toc(doc_path)
    if native_toc:
        sources['native'] = native_toc
        print(f"[TOC] Native source: {len(native_toc)} entries with CORRECT pages")

    # Source 2: TOC page parsing (SECOND PRIORITY)
    toc_page_entries = detect_and_parse_toc_page(doc_path)
    if toc_page_entries:
        sources['toc_page'] = toc_page_entries
        print(f"[TOC] TOC page source: {len(toc_page_entries)} entries with extracted pages")

    # Source 3: Font-based heuristics (FALLBACK)
    # This now skips first 15 pages to avoid TOC confusion
    heuristic_toc = extract_heuristic_toc_fast(doc_path)
    if heuristic_toc:
        sources['heuristic'] = heuristic_toc
        print(f"[TOC] Heuristic source: {len(heuristic_toc)} entries from content analysis")

    # INTELLIGENT MERGING STRATEGY

    # Case 1: Native TOC exists and looks complete (>= 5 entries)
    if 'native' in sources and len(sources['native']) >= 5:
        print("[TOC] Using native PDF TOC (most reliable)")
        return validate_and_clean_toc(sources['native'], doc_path)

    # Case 2: Native TOC exists but seems incomplete (< 5 entries)
    # Supplement with TOC page or heuristic
    elif 'native' in sources and len(sources['native']) > 0:
        print("[TOC] Native TOC found but sparse, attempting hybrid merge...")
        result = sources['native'].copy()

        # Add entries from TOC page that aren't in native
        if 'toc_page' in sources:
            native_pages = {entry['page'] for entry in sources['native']}
            for entry in sources['toc_page']:
                if entry['page'] not in native_pages:
                    result.append(entry)

        # If still sparse, add from heuristic
        if len(result) < 8 and 'heuristic' in sources:
            existing_pages = {entry['page'] for entry in result}
            for entry in sources['heuristic']:
                if entry['page'] not in existing_pages and len(result) < 20:
                    result.append(entry)

        # Sort and validate
        result = validate_and_clean_toc(result, doc_path)
        print(f"[TOC] Hybrid merge: {len(result)} entries")
        return result

    # Case 3: TOC page parsing found good results
    elif 'toc_page' in sources and len(sources['toc_page']) >= 3:
        print("[TOC] Using TOC page extraction (second best)")
        return validate_and_clean_toc(sources['toc_page'], doc_path)

    # Case 4: Only heuristic available, or TOC page too sparse
    elif 'heuristic' in sources and len(sources['heuristic']) > 0:
        # If TOC page found something but too sparse, merge
        if 'toc_page' in sources and len(sources['toc_page']) > 0:
            print("[TOC] Merging sparse TOC page with heuristic...")
            result = sources['toc_page'].copy()
            toc_pages = {entry['page'] for entry in sources['toc_page']}

            for entry in sources['heuristic']:
                if entry['page'] not in toc_pages and len(result) < 30:
                    result.append(entry)

            result = validate_and_clean_toc(result, doc_path)
            print(f"[TOC] Hybrid merge: {len(result)} entries")
            return result
        else:
            print("[TOC] Using heuristic extraction (fallback)")
            return validate_and_clean_toc(sources['heuristic'], doc_path)

    else:
        print("[TOC] No TOC found from any source")
        return []


# Quick heuristic TOC extraction (< 0.5s)
def extract_heuristic_toc_fast(doc_path):
    """
    Super fast heuristic extraction using font analysis.
    Works with any PDF by detecting heading-like text.
    No LLM needed - analyzes font size, weight, and positioning.
    MUST be < 0.5 seconds.
    """
    if not PYMUPDF_AVAILABLE:
        return []

    start_time = time.time()

    try:
        import re
        doc = fitz.open(doc_path)
        toc = []
        seen_titles = set()

        # Expanded keywords for better detection across document types
        chapter_keywords = [
            'chapter', 'section', 'part', 'unit', 'lesson',
            'introduction', 'conclusion', 'summary', 'overview',
            'abstract', 'appendix', 'preface', 'foreword',
            'acknowledgments', 'references', 'bibliography',
            'glossary', 'index'
        ]

        # Auto-detect where to start based on document length
        total_pages = len(doc)

        # OPTIMIZATION: For large documents, only sample pages instead of scanning all
        # This makes the function truly "fast" (< 2 seconds even for 500+ page docs)
        if total_pages < 20:
            # Short document - scan all pages
            pages_to_scan = list(range(0, total_pages))
        elif total_pages < 50:
            # Medium document - skip TOC, scan up to page 50
            pages_to_scan = list(range(15, total_pages))
        else:
            # Large document - SAMPLE pages instead of scanning all
            # Sample every 5th page from page 15 to 100 (max 17 pages)
            start_page = 15
            end_page = min(100, total_pages)
            pages_to_scan = list(range(start_page, end_page, 5))  # Every 5th page

        print(f"[TOC] Scanning {len(pages_to_scan)} pages out of {total_pages} total")

        # First pass: determine average font size on a sample page
        # This helps identify what's "large" relative to body text
        sample_page_num = pages_to_scan[min(3, len(pages_to_scan) - 1)]
        sample_page = doc[sample_page_num]
        font_sizes = []

        for block in sample_page.get_text("dict")["blocks"]:
            if block.get("type") == 0:
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        font_sizes.append(span.get("size", 12))

        # Calculate median font size (more robust than mean)
        if font_sizes:
            font_sizes.sort()
            median_size = font_sizes[len(font_sizes) // 2]
            large_threshold = median_size * 1.3  # 30% larger than median
            very_large_threshold = median_size * 1.6  # 60% larger
            print(f"[TOC] Font analysis: median={median_size:.1f}, large>{large_threshold:.1f}, very_large>{very_large_threshold:.1f}")
        else:
            # Fallback values (for documents with no text or unusual formats)
            median_size = 12
            large_threshold = 14
            very_large_threshold = 18
            print(f"[TOC] Font analysis: using default thresholds (no fonts detected)")

        # Second pass: extract headings from sampled pages
        max_time = 3.0  # Maximum 3 seconds for quick TOC
        for page_num in pages_to_scan:
            # Check timeout
            if time.time() - start_time > max_time:
                print(f"[TOC] Timeout reached, stopping early with {len(toc)} items")
                break

            page = doc[page_num]
            blocks = page.get_text("dict")["blocks"]

            for block in blocks:
                if block.get("type") == 0:  # Text block
                    for line in block.get("lines", []):
                        # Get first span to check formatting
                        if not line.get("spans"):
                            continue

                        first_span = line["spans"][0]
                        text = first_span.get("text", "").strip()
                        size = first_span.get("size", 12)
                        font = first_span.get("font", "").lower()
                        is_bold = 'bold' in font or 'black' in font or 'heavy' in font

                        # Skip very short or very long text
                        if len(text) < 3 or len(text) > 150:
                            continue

                        # Skip page numbers and single words
                        if text.isdigit() or (len(text.split()) == 1 and len(text) < 8):
                            continue

                        text_lower = text.lower()

                        # DETECTION RULES (ordered by priority)

                        # Rule 1: Contains heading keywords + styled
                        if any(kw in text_lower for kw in chapter_keywords):
                            if (size >= large_threshold or is_bold) and text not in seen_titles:
                                level = 1 if size >= very_large_threshold else 2
                                toc.append({
                                    'title': text,
                                    'level': level,
                                    'page': page_num,
                                    'source': 'heuristic'
                                })
                                seen_titles.add(text)

                        # Rule 2: Very large text (likely major heading)
                        elif size >= very_large_threshold and text not in seen_titles:
                            # Additional check: should be at top portion of page
                            # or be properly capitalized
                            is_title_case = text[0].isupper() if text else False
                            if is_title_case:
                                toc.append({
                                    'title': text,
                                    'level': 1,
                                    'page': page_num,
                                    'source': 'heuristic'
                                })
                                seen_titles.add(text)

                        # Rule 3: Numbered headings "1.1 Topic" or "Chapter 5"
                        elif re.match(r'^(\d+\.)*\d+[\.\s]', text) and (size >= large_threshold or is_bold):
                            if text not in seen_titles:
                                # Count dots to determine level
                                dots = text.split()[0].count('.')
                                level = min(dots + 1, 3)
                                toc.append({
                                    'title': text,
                                    'level': level,
                                    'page': page_num,
                                    'source': 'heuristic'
                                })
                                seen_titles.add(text)

                        # Rule 4: Bold + reasonably large
                        elif is_bold and size >= large_threshold and len(text) > 8:
                            # Make sure it's not all caps (might be just emphasis)
                            if not text.isupper() and text not in seen_titles:
                                toc.append({
                                    'title': text,
                                    'level': 2,
                                    'page': page_num,
                                    'source': 'heuristic'
                                })
                                seen_titles.add(text)

            # Limit entries per page to avoid noise
            if len(toc) > 50:
                break

        doc.close()

        elapsed = time.time() - start_time
        print(f"[TOC] Heuristic extraction: {len(toc)} items in {elapsed:.2f}s")

        # Return up to 50 items (reasonable limit)
        return toc[:50]

    except Exception as e:
        print(f"[TOC] Heuristic extraction error: {e}")
        import traceback
        traceback.print_exc()
        return []


@app.route('/document/<doc_id>/toc-quick', methods=['GET'])
def get_toc_quick(doc_id):
    """
    INSTANT heuristic TOC (< 0.5 seconds)
    Show this to user immediately
    """
    print(f"[TOC-Quick] Request for document: {doc_id}")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Document not found', 'toc': []}), 404

    doc_path = row['file_path']

    if not doc_path.endswith('.pdf'):
        return jsonify({'toc': [], 'method': 'not_pdf'}), 200

    # Fast heuristic extraction
    quick_toc = extract_heuristic_toc_fast(doc_path)

    return jsonify({
        'toc': quick_toc,
        'method': 'heuristic',
        'confidence': 'medium',
        'has_toc': len(quick_toc) > 0
    })


@app.route('/document/<doc_id>/toc-enhanced', methods=['POST'])
def get_toc_enhanced(doc_id):
    """
    LLM-enhanced TOC (runs in background)
    Refines the quick TOC
    """
    print(f"[TOC-Enhanced] Request for document: {doc_id}")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Document not found', 'toc': []}), 404

    doc_path = row['file_path']

    if not doc_path.endswith('.pdf'):
        return jsonify({'toc': [], 'method': 'not_pdf'}), 200

    # Check cache first
    cached_toc = get_cached_smart_toc(doc_id, doc_path)
    if cached_toc:
        return jsonify({
            'toc': cached_toc,
            'method': 'cached',
            'confidence': 'high',
            'has_toc': len(cached_toc) > 0
        })

    # LLM extraction (optimized)
    start_time = time.time()
    smart_toc = extract_smart_toc_optimized(doc_path)
    elapsed = time.time() - start_time

    print(f"[TOC-Enhanced] Extracted {len(smart_toc)} items in {elapsed:.2f}s")

    # Cache result
    cache_smart_toc(doc_id, doc_path, smart_toc)

    return jsonify({
        'toc': smart_toc,
        'method': 'llm',
        'confidence': 'high',
        'has_toc': len(smart_toc) > 0
    })


def extract_smart_toc_optimized(doc_path):
    """
    Smart TOC extraction with multi-source approach.

    NEW APPROACH (fixes TOC page confusion bug):
    1. Try native PDF TOC first (most reliable, already has correct pages)
    2. Try TOC page parsing (extracts real page numbers from TOC)
    3. Use document-type-specific extractors
    4. Fallback to heuristic (now skips first 15 pages)

    This prevents the bug where all chapters were tagged to page 5 (TOC page)
    instead of their actual locations (15, 28, 45, etc.)
    """
    if not PYMUPDF_AVAILABLE:
        return []

    try:
        # STRATEGY 1: Multi-source extraction (HIGHEST PRIORITY)
        # This tries native TOC, TOC page parsing, then heuristics
        multi_source_toc = extract_toc_multi_source(doc_path)
        if multi_source_toc and len(multi_source_toc) > 0:
            # If we got results from native or TOC page parsing, use them!
            # These have CORRECT page numbers already
            return multi_source_toc

        # STRATEGY 2: Document-type-specific extractors
        # Only use these if multi-source didn't find anything
        doc = fitz.open(doc_path)
        if len(doc) == 0:
            doc.close()
            return []

        first_page_text = doc[0].get_text().lower()
        total_pages = len(doc)
        doc.close()

        # Research paper detection (no LLM needed!)
        if ('abstract' in first_page_text and
            ('references' in first_page_text or 'introduction' in first_page_text)):
            print("[TOC] Detected research paper, using specialized extractor")
            return extract_research_paper_toc_fast(doc_path)

        # Novel detection
        if 'chapter' in first_page_text and total_pages > 50:
            print("[TOC] Detected novel/book, using specialized extractor")
            return extract_novel_toc_fast(doc_path)

        # STRATEGY 3: LLM extraction (optional, if available)
        if LLM_AVAILABLE:
            print("[TOC] Using LLM extraction with optimized structure")
            structure = extract_document_structure_optimized(doc_path)
            if structure:
                return llm_extract_toc_optimized(structure)

        # STRATEGY 4: Final fallback
        # This shouldn't be reached if multi-source worked, but just in case
        print("[TOC] Final fallback to heuristic")
        return extract_heuristic_toc_fast(doc_path)

    except Exception as e:
        print(f"[TOC] Smart extraction error: {e}")
        return []


@app.route('/document/<doc_id>/smart-toc', methods=['POST'])
def get_smart_toc(doc_id):
    """
    Extract TOC using LLM intelligence.
    Analyzes document structure and builds proper hierarchical TOC.
    Falls back to regular TOC if LLM is not available.
    """
    print(f"\n[SmartTOC] Request for document: {doc_id}")

    # Check cache first
    cache_key = hashlib.md5(f"{doc_id}:smart-toc".encode()).hexdigest()
    cache_file = AUDIO_CACHE_FOLDER / f"{cache_key}_toc.json"

    if cache_file.exists():
        print(f"[SmartTOC] Returning cached TOC for {doc_id}")
        import json
        return jsonify(json.loads(cache_file.read_text()))

    # Check if LLM is available
    if not LLM_AVAILABLE:
        print("[SmartTOC] LLM not available, falling back to regular TOC")
        return get_document_toc(doc_id)

    # Get document path
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT file_path FROM documents WHERE id = ?', (doc_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Document not found', 'toc': []}), 404

    filepath = row['file_path']

    if not filepath.endswith('.pdf'):
        return jsonify({'error': 'Smart TOC only available for PDFs', 'toc': []}), 200

    if not PYMUPDF_AVAILABLE:
        return jsonify({'error': 'PyMuPDF required for Smart TOC', 'toc': []}), 200

    try:
        # Step 1: Extract document structure
        print("[SmartTOC] Extracting document structure...")
        pages_structure = extract_document_structure(filepath)

        if not pages_structure:
            print("[SmartTOC] No structure extracted, falling back to regular TOC")
            return get_document_toc(doc_id)

        # Step 2: Use LLM to extract TOC
        print("[SmartTOC] Using LLM to extract TOC...")
        toc_items = llm_extract_toc(pages_structure)

        # Step 3: Cache result
        import json
        cache_file.write_text(json.dumps({'toc': toc_items}))

        print(f"[SmartTOC] Extracted {len(toc_items)} TOC items")
        return jsonify({
            'toc': toc_items,
            'has_toc': len(toc_items) > 0,
            'source': 'llm_smart'
        })

    except Exception as e:
        print(f"[SmartTOC] Error: {e}")
        import traceback
        traceback.print_exc()
        # Fall back to regular TOC
        return get_document_toc(doc_id)


def extract_document_structure_optimized(filepath):
    """
    Extract structure from SAMPLED pages only
    Reduces processing by 70% with minimal accuracy loss
    """
    if not PYMUPDF_AVAILABLE:
        return []

    try:
        doc = fitz.open(filepath)
        total_pages = len(doc)
        structure = []

        # Smart sampling strategy
        pages_to_analyze = []

        # First 15 pages (intro, early chapters)
        pages_to_analyze.extend(range(min(15, total_pages)))

        # Every 10th page after that (to catch later chapters)
        pages_to_analyze.extend(range(15, min(50, total_pages), 10))

        print(f"[TOC] Analyzing {len(pages_to_analyze)} pages out of {total_pages}")

        for page_num in pages_to_analyze:
            page = doc[page_num]
            blocks = page.get_text("dict")["blocks"]

            page_blocks = []
            for block in blocks:
                if block.get("type") == 0:  # Text block
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = span.get("text", "").strip()
                            if text and len(text) > 1:
                                page_blocks.append({
                                    'text': text,
                                    'font_size': round(span.get("size", 12), 1),
                                    'is_bold': 'bold' in span.get("font", "").lower(),
                                    'y_pos': round(span.get("bbox", [0,0,0,0])[1], 1)
                                })

            if page_blocks:
                structure.append({
                    'page': page_num,
                    'blocks': page_blocks
                })

        doc.close()
        return structure

    except Exception as e:
        print(f"[TOC] Structure extraction error: {e}")
        return []


# Keep old function for compatibility
def extract_document_structure(filepath):
    """Compatibility wrapper - calls optimized version"""
    return extract_document_structure_optimized(filepath)


def llm_extract_toc(pages_structure):
    """Use LLM to intelligently extract TOC from document structure"""

    # Build structured text representation
    structured_text = ""
    for page in pages_structure[:20]:  # Limit to first 20 pages for TOC
        structured_text += f"\n[PAGE {page['page'] + 1}]\n"

        for block in page['blocks'][:50]:  # Limit blocks per page
            # Mark potential headings
            if block['font_size'] > 14 or block['is_bold']:
                marker = f"[SIZE:{block['font_size']}]" if block['font_size'] > 14 else "[BOLD]"
                structured_text += f"{marker} {block['text']}\n"
            else:
                # Include some body text for context but limit it
                text = block['text'][:100]
                structured_text += f"{text} "

        structured_text += "\n"

        # Limit total size
        if len(structured_text) > 10000:
            break

    # Ask LLM to extract TOC
    prompt = f"""Extract the table of contents from this document.

INSTRUCTIONS:
1. Identify chapter titles, section headings, and subsections
2. Ignore: page numbers, headers, footers, figure captions, quotes
3. Build hierarchical structure (level 1 = chapters, level 2 = sections, etc.)
4. Include page numbers where each item appears

OUTPUT FORMAT (JSON only, no markdown):
[
  {{"title": "Chapter 1: Introduction", "level": 1, "page": 5}},
  {{"title": "1.1 Background", "level": 2, "page": 6}},
  {{"title": "Chapter 2: Methods", "level": 1, "page": 12}}
]

DOCUMENT TEXT:
{structured_text[:8000]}

Return ONLY valid JSON array, nothing else."""

    try:
        response = ask_llm(prompt)

        # Clean response
        response = response.strip()

        # Remove markdown code fences if present
        if '```' in response:
            # Extract content between code fences
            parts = response.split('```')
            for part in parts:
                part = part.strip()
                if part.startswith('json'):
                    part = part[4:].strip()
                if part.startswith('[') and part.endswith(']'):
                    response = part
                    break

        # Parse JSON
        import json
        toc_items = json.loads(response)

        # Validate and clean
        valid_items = []
        for item in toc_items:
            if isinstance(item, dict) and 'title' in item and 'page' in item:
                # Ensure level exists
                if 'level' not in item:
                    item['level'] = 1

                # Convert page to 0-based index
                item['page'] = max(0, int(item['page']) - 1)

                # Validate title is not empty
                if item['title'].strip():
                    valid_items.append(item)

        print(f"[SmartTOC] LLM extracted {len(valid_items)} TOC items")
        return valid_items

    except json.JSONDecodeError as e:
        print(f"[SmartTOC] JSON parse error: {e}")
        print(f"[SmartTOC] LLM response: {response[:500]}")
        return []
    except Exception as e:
        print(f"[SmartTOC] LLM extraction error: {e}")
        return []


def llm_extract_toc_optimized(pages_structure):
    """
    Optimized LLM extraction
    Shorter prompt = faster inference
    """
    # Build ultra-compact representation
    compact_lines = []

    for page in pages_structure[:20]:  # Limit to 20 pages for LLM
        for block in page['blocks']:
            # Only include potential headings
            if block['font_size'] > 13 or block['is_bold']:
                # Format: P5|16.0|Chapter 1: Introduction
                compact_lines.append(
                    f"P{page['page']}|{block['font_size']:.1f}|{block['text'][:60]}"
                )

    # Limit to 80 lines max
    compact_text = "\n".join(compact_lines[:80])

    # Ultra-compact prompt (< 1500 tokens)
    prompt = f"""Extract table of contents from this document structure.

FORMAT: [{{"title":"Chapter 1","level":1,"page":0}}]

RULES:
- level 1 = chapters/main sections
- level 2 = subsections
- level 3 = sub-subsections
- Ignore page numbers, headers, quotes
- Return ONLY valid JSON array

DATA:
{compact_text}

JSON:"""

    try:
        response = ask_llm(prompt)

        # Clean and parse
        response = response.strip()
        if '```' in response:
            response = response.split('```')[1].replace('json', '').strip()

        import json
        toc_items = json.loads(response)

        # Validate items
        valid_items = []
        for item in toc_items:
            if all(k in item for k in ['title', 'page', 'level']):
                # Convert 1-based to 0-based page numbers
                item['page'] = max(0, item['page'] - 1)
                valid_items.append(item)

        print(f"[TOC] LLM extracted {len(valid_items)} items")
        return valid_items

    except Exception as e:
        print(f"[TOC] LLM extraction failed: {e}")
        return []


def extract_research_paper_toc_fast(doc_path):
    """
    Fast extraction for research papers
    Standard sections, no LLM needed
    """
    standard_sections = [
        'abstract', 'introduction', 'background', 'related work',
        'methodology', 'methods', 'materials and methods',
        'results', 'findings', 'experiments', 'evaluation',
        'discussion', 'analysis', 'conclusion', 'conclusions',
        'future work', 'references', 'bibliography', 'acknowledgments'
    ]

    try:
        doc = fitz.open(doc_path)
        toc = []
        seen_sections = set()

        for page_num in range(min(30, len(doc))):
            page = doc[page_num]
            blocks = page.get_text("dict")["blocks"]

            for block in blocks:
                if block.get("type") == 0:
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = span.get("text", "").strip()
                            text_lower = text.lower()
                            size = span.get("size", 12)

                            # Look for standard sections
                            if size > 11:  # Headings usually larger
                                for section in standard_sections:
                                    if section in text_lower and section not in seen_sections:
                                        if len(text) < 100:  # Reasonable heading length
                                            toc.append({
                                                'title': text,
                                                'level': 1,
                                                'page': page_num
                                            })
                                            seen_sections.add(section)
                                            break

        doc.close()
        print(f"[TOC] Research paper: {len(toc)} sections found")
        return toc

    except Exception as e:
        print(f"[TOC] Research paper extraction error: {e}")
        return []


def extract_novel_toc_fast(doc_path):
    """
    Fast extraction for novels
    Chapter headings only
    """
    import re

    chapter_patterns = [
        r'^\s*chapter\s+\d+',
        r'^\s*chapter\s+[ivxlcdm]+',  # Roman numerals
        r'^\s*\d+\.\s+\w+',  # "1. The Beginning"
        r'^\s*part\s+\w+',
    ]

    try:
        doc = fitz.open(doc_path)
        toc = []
        seen_chapters = set()

        for page_num in range(len(doc)):
            page = doc[page_num]
            blocks = page.get_text("dict")["blocks"]

            for block in blocks:
                if block.get("type") == 0:
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = span.get("text", "").strip()
                            size = span.get("size", 12)

                            if size > 14:  # Large text
                                for pattern in chapter_patterns:
                                    if re.search(pattern, text.lower()):
                                        if text not in seen_chapters and len(text) < 100:
                                            toc.append({
                                                'title': text,
                                                'level': 1,
                                                'page': page_num
                                            })
                                            seen_chapters.add(text)
                                            break

        doc.close()
        print(f"[TOC] Novel: {len(toc)} chapters found")
        return toc

    except Exception as e:
        print(f"[TOC] Novel extraction error: {e}")
        return []


@app.route('/llm/unload', methods=['POST'])
def unload_llm():
    """Unload the current LLM to free memory"""
    global LOCAL_LLM, LLM_AVAILABLE, CURRENT_LLM_ID

    LOCAL_LLM = None
    LLM_AVAILABLE = False
    CURRENT_LLM_ID = None

    return jsonify({'success': True})

def start_server():
    """Start Flask server in a separate thread"""
    app.run(host='127.0.0.1', port=5555, debug=False, threaded=True)

def main():
    """Main entry point"""
    print("Starting Clara...")

    # Initialize persistent storage
    print("\nInitializing storage...")
    init_storage()
    print(f"[OK] Library location: {CLARA_HOME}")

    # Check dependencies
    deps_ok = check_system_dependencies()
    if not deps_ok:
        print("\nWARNING: Some dependencies are missing. Clara will continue but some features may not work.")
        print("Please install the missing dependencies for the best experience.\n")
        input("Press Enter to continue anyway, or Ctrl+C to exit and install dependencies...")

    # Initialize TTS
    print("\nInitializing Text-to-Speech...")
    init_tts()
    if not EDGE_TTS_AVAILABLE:
        print("  Falling back to macOS TTS (install edge-tts for better voices: pip install edge-tts)")

    # Initialize embedder
    print("\nLoading AI models...")
    init_embedder()

    # Initialize local LLM for Q&A
    print("\nInitializing Q&A engine...")
    init_llm()
    
    # Start Flask server in background
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Give server time to start
    time.sleep(2)
    
    # Create webview window
    print("\nLaunching Clara...\n")
    window = webview.create_window(
        'Clara',
        'http://127.0.0.1:5555',
        width=1000,
        height=700,
        resizable=True,
        background_color='#FAFAFA'
    )
    
    webview.start()

if __name__ == '__main__':
    main()
