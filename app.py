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
DATABASE_PATH = CLARA_HOME / 'clara.db'
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'md'}

# TTS configuration - using edge-tts for high quality neural voices
EDGE_TTS_AVAILABLE = False
TTS_VOICES = {
    'female': 'en-US-JennyNeural',  # Natural female voice
    'male': 'en-US-GuyNeural'        # Natural male voice
}

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

# Download progress tracking
download_progress = {}

def init_tts():
    """Initialize TTS engine"""
    global EDGE_TTS_AVAILABLE
    try:
        import edge_tts
        EDGE_TTS_AVAILABLE = True
        print("✓ Edge TTS available (Microsoft Neural Voices)")
    except ImportError:
        print("⚠ edge-tts not installed. Install with: pip install edge-tts")
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
        print("✓ LLM model downloaded successfully!")
        return True

    except Exception as e:
        print(f"\n✗ Failed to download LLM model: {e}")
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
            print(f"⚠ Default model {model_filename} not found. Please download it from Settings.")
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

        print(f"✓ Local LLM loaded ({model_name})")
    except Exception as e:
        print(f"✗ Failed to load LLM: {e}")
        LLM_AVAILABLE = False

def init_storage():
    """Initialize Clara's persistent storage"""
    CLARA_HOME.mkdir(parents=True, exist_ok=True)
    DOCUMENTS_FOLDER.mkdir(exist_ok=True)
    THUMBNAILS_FOLDER.mkdir(exist_ok=True)
    VOICES_FOLDER.mkdir(exist_ok=True)
    MODELS_FOLDER.mkdir(exist_ok=True)
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
        print("✓ Embedding model loaded")
    except Exception as e:
        print(f"✗ Failed to load embedding model: {e}")
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
        
        print(f"✓ Created {len(chunks)} embeddings")
        return True
    except Exception as e:
        print(f"✗ Embedding creation failed: {e}")
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
        print(f"✗ Query failed: {e}")
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

def generate_audio(text, voice=None, timeout=30):
    """
    Generate audio using edge-tts (Microsoft Neural Voices) or fallback to macOS

    Args:
        text: Text to synthesize
        voice: Voice ID (e.g., 'en-US-JennyNeural') or legacy 'female'/'male'.
               If None, uses saved preference.
        timeout: Maximum time in seconds to wait for generation (default 30)
    """
    global EDGE_TTS_AVAILABLE

    # Resolve voice
    if voice is None:
        voice_name = get_saved_voice()
    elif voice in ('female', 'male'):
        # Legacy support for old 'female'/'male' values
        voice_name = TTS_VOICES.get(voice, TTS_VOICES['female'])
    else:
        # Direct voice ID (e.g., 'en-US-JennyNeural')
        voice_name = voice

    try:
        if EDGE_TTS_AVAILABLE:
            import edge_tts
            import asyncio

            temp_audio = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False)
            temp_audio.close()

            async def generate():
                communicate = edge_tts.Communicate(text, voice_name)
                await communicate.save(temp_audio.name)

            # Run async function with timeout
            try:
                asyncio.run(asyncio.wait_for(generate(), timeout=timeout))
            except asyncio.TimeoutError:
                raise Exception(f"Audio generation timed out after {timeout} seconds. Text may be too long.")

            return temp_audio.name
        else:
            # Fallback to macOS TTS
            temp_audio = tempfile.NamedTemporaryFile(suffix='.aiff', delete=False)
            temp_audio.close()

            # Use voice directly for macOS (Samantha, Alex, etc.)
            macos_voice = voice_name if voice_name in ('Samantha', 'Alex') else 'Samantha'

            subprocess.run(
                ['say', '-v', macos_voice, '-o', temp_audio.name, text],
                capture_output=True,
                text=True,
                check=True,
                timeout=timeout
            )

            return temp_audio.name

    except Exception as e:
        raise Exception(f"Audio generation failed: {str(e)}")

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

# Routes

@app.route('/')
def index():
    """Serve the main UI"""
    return render_template('index.html')

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
                        print(f"✓ Finished processing all {total_pages} pages ({len(all_chunks)} chunks)")
                    except Exception as e:
                        print(f"✗ Background parsing failed: {e}")

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
    if not current_document:
        return jsonify({'error': 'No document loaded'}), 400
    
    data = request.get_json()
    question = data.get('question', '')
    current_page_num = data.get('page_num')  # Current page number (optional)
    current_page_text = data.get('page_text', '')  # Current page text (optional)
    
    if not question:
        return jsonify({'error': 'No question provided'}), 400
    
    try:
        # Detect if question refers to current page/chapter
        question_lower = question.lower()
        is_page_specific = any(phrase in question_lower for phrase in [
            'this page', 'current page', 'this chapter', 'current chapter',
            'summarize this', 'summarize the page', 'what is on this page',
            'what does this page say', 'explain this page', 'what is this page about'
        ])
        
        # If question is about current page and we have page text, prioritize it
        if is_page_specific and current_page_text:
            # Use current page as primary context
            context = current_page_text[:2000]  # Use up to 2000 chars of current page
            # Also get some relevant chunks from RAG for additional context
            context_chunks = query_document(question, n_results=2)
            if context_chunks:
                context += "\n\nAdditional context:\n" + "\n\n".join(context_chunks[:2])
        else:
            # Standard RAG approach
            context_chunks = query_document(question, n_results=3)
            context = "\n\n".join(context_chunks)
            
            # If we have current page text, add it as additional context
            if current_page_text:
                context = f"Current page content:\n{current_page_text[:1000]}\n\n" + context

        # Get answer from local LLM with enhanced prompt
        answer = call_local_llm(question, context, is_page_specific=is_page_specific)

        return jsonify({
            'answer': answer,
            'context_used': len(context_chunks) if not is_page_specific else 1
        })
    
    except Exception as e:
        print(f"Ask error: {e}")  # Log for debugging
        return jsonify({'error': f'Question failed: {str(e)}'}), 500

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

    try:
        # Try using pdf2image (requires poppler)
        if PDF2IMAGE_AVAILABLE:
            try:
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
                    return response
            except Exception as pdf_err:
                print(f"Error converting PDF page {page_num}: {pdf_err}")
                import traceback
                traceback.print_exc()
        else:
            print("pdf2image not available, using text fallback")

        # Fallback: return page text as JSON
        reader = pypdf.PdfReader(filepath)
        if page_num >= len(reader.pages):
            return jsonify({'error': 'Page not found'}), 404

        page_text = reader.pages[page_num].extract_text()
        return jsonify({
            'page': page_num,
            'text': page_text,
            'render_mode': 'text'
        })

    except Exception as e:
        print(f"Error in get_pdf_page: {e}")
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
            MIN_FONT_HEIGHT = 8

            words_data = page.get_text("words")

            # Filter words and join hyphenated ones
            filtered_words = []
            i = 0
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

                word_list.append({'text': text, 'line': line, 'block': block, 'y': y0})

            # Join hyphenated words
            i = 0
            while i < len(word_list):
                word = word_list[i]
                text = word['text']

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

    Filters out:
    - Headers and footers (top/bottom 8% of page)
    - Very small text (likely copyright, page numbers)
    - Text in margins (left/right 5%)

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

        doc = fitz.open(filepath)
        if page_num >= len(doc):
            doc.close()
            return jsonify({'error': 'Page not found'}), 404

        page = doc[page_num]
        page_rect = page.rect
        page_height = page_rect.height
        page_width = page_rect.width

        # Define content area boundaries (as percentages)
        TOP_MARGIN = 0.04      # Skip top 4% (page numbers, running headers)
        BOTTOM_MARGIN = 0.94   # Skip bottom 6% (footers, page numbers)
        LEFT_MARGIN = 0.05     # Skip left 5%
        RIGHT_MARGIN = 0.95    # Skip right 5%
        MIN_FONT_HEIGHT = 8    # Minimum font height in points (skip tiny text)

        # Get word list with positions
        # Each word is (x0, y0, x1, y1, "word", block_no, line_no, word_no)
        words_data = page.get_text("words")

        # Filter and process words
        raw_words = []
        for w in words_data:
            x0, y0, x1, y1, text, block, line, word_idx = w

            # Calculate relative positions
            rel_y = y0 / page_height
            rel_x = x0 / page_width
            rel_x_end = x1 / page_width
            font_height = y1 - y0

            # Skip if in header/footer zone
            if rel_y < TOP_MARGIN or rel_y > BOTTOM_MARGIN:
                continue

            # Skip if in margins
            if rel_x < LEFT_MARGIN or rel_x_end > RIGHT_MARGIN:
                continue

            # Skip very small text (copyright, footnotes, etc.)
            if font_height < MIN_FONT_HEIGHT:
                continue

            # Skip empty or whitespace-only
            if not text.strip():
                continue

            raw_words.append({
                'text': text,
                'x': (x0 / page_width) * 100,
                'y': (y0 / page_height) * 100,
                'w': ((x1 - x0) / page_width) * 100,
                'h': ((y1 - y0) / page_height) * 100,
                'block': block,
                'line': line
            })

        # Join hyphenated words (word ending with - followed by word on next line)
        words = []
        i = 0
        while i < len(raw_words):
            word = raw_words[i]
            text = word['text']

            # Check if word ends with hyphen and there's a next word
            if text.endswith('-') and i + 1 < len(raw_words):
                next_word = raw_words[i + 1]

                # Check if next word is on the next line (same or next block)
                is_continuation = (
                    next_word['line'] == word['line'] + 1 or
                    (next_word['block'] == word['block'] + 1 and next_word['line'] == 0) or
                    next_word['y'] > word['y'] + word['h'] * 0.5  # Next word is below
                )

                if is_continuation:
                    # Join the words (remove hyphen)
                    joined_text = text[:-1] + next_word['text']

                    # Create combined bounding box (use first word's position, expand width)
                    words.append({
                        'text': joined_text,
                        'x': word['x'],
                        'y': word['y'],
                        'w': word['w'],
                        'h': word['h']
                    })

                    # Skip the next word since we merged it
                    i += 2
                    continue

            # Regular word (no hyphenation)
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
    """Generate audio for arbitrary text (used for page-based reading)"""
    data = request.get_json()
    text = data.get('text', '')
    voice = data.get('voice', 'female')

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    # Log text length for debugging
    word_count = len(text.split())
    char_count = len(text)
    print(f"[TTS] Generating audio: {word_count} words, {char_count} chars")

    # Generous timeout - NEVER fail, reading must always work
    # ~0.2s per word + 60s buffer, capped at 3 minutes
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
            audio_path = generate_audio(attempt_text, voice, timeout=timeout)
            gen_time = time.time() - start_time
            print(f"[TTS] SUCCESS: {gen_time:.2f}s ({attempt_words} words)")

            with open(audio_path, 'rb') as f:
                audio_data = f.read()

            os.unlink(audio_path)

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
            print(f"✓ Downloaded {model_info['name']}")

        except Exception as e:
            download_progress[model_id]['in_progress'] = False
            download_progress[model_id]['error'] = str(e)
            if model_path.exists():
                model_path.unlink()
            print(f"✗ Download failed for {model_info['name']}: {e}")

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

        print(f"✓ Switched to {model_info['name']}")

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
    print("🎧 Starting Clara...")

    # Initialize persistent storage
    print("\nInitializing storage...")
    init_storage()
    print(f"✓ Library location: {CLARA_HOME}")

    # Check dependencies
    print("\nChecking dependencies...")

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
    print("\n✨ Launching Clara...\n")
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
