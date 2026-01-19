"""
Clara Demo - Testing version without external dependencies
Use this to test the UI and flow before installing Piper/Ollama
"""

import os
import sys
import json
import threading
import time
from pathlib import Path
from typing import Optional, List, Dict
import webview
from flask import Flask, render_template, request, jsonify, Response
from werkzeug.utils import secure_filename
import pypdf
import tempfile

# Configuration
UPLOAD_FOLDER = Path(tempfile.gettempdir()) / 'clara_uploads'
UPLOAD_FOLDER.mkdir(exist_ok=True)
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'md'}

# Global state
current_document = None
current_chunks = []
current_position = 0

# Initialize Flask app
app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def parse_pdf(filepath):
    try:
        reader = pypdf.PdfReader(filepath)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n\n"
        return text
    except Exception as e:
        raise Exception(f"Failed to parse PDF: {str(e)}")

def parse_text_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        raise Exception(f"Failed to read file: {str(e)}")

def chunk_text(text, chunk_size=500):
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

# Demo implementations (simulate Piper/Ollama)

def generate_audio_demo(text):
    """Demo: Return a simple beep instead of real audio"""
    # Return a minimal WAV header (silence)
    return b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'

def answer_question_demo(question, context):
    """Demo: Return a mock answer"""
    return f"This is a demo answer to: '{question}'. In a real setup, this would use Ollama to analyze the context and provide an intelligent response."

# Routes

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    global current_document, current_chunks, current_position
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Use PDF, TXT, or MD'}), 400
    
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        if filename.endswith('.pdf'):
            text = parse_pdf(filepath)
        else:
            text = parse_text_file(filepath)
        
        chunks = chunk_text(text)
        
        current_document = {
            'name': filename,
            'path': filepath,
            'text': text
        }
        current_chunks = chunks
        current_position = 0
        
        return jsonify({
            'success': True,
            'filename': filename,
            'chunks': len(chunks),
            'preview': chunks[0][:200] + '...' if chunks else ''
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/play', methods=['POST'])
def play():
    global current_chunks, current_position
    
    if not current_chunks:
        return jsonify({'error': 'No document loaded'}), 400
    
    data = request.get_json()
    position = data.get('position', current_position)
    
    if position >= len(current_chunks):
        return jsonify({'error': 'End of document reached'}), 400
    
    current_position = position
    
    # Demo: return the text instead of audio for now
    # This allows you to see what would be read
    return jsonify({
        'text': current_chunks[position],
        'position': position,
        'demo_mode': True
    })

@app.route('/get-chunk', methods=['GET'])
def get_chunk():
    """Get current chunk text for display"""
    global current_chunks, current_position
    
    if not current_chunks or current_position >= len(current_chunks):
        return jsonify({'error': 'No content'}), 400
    
    return jsonify({
        'text': current_chunks[current_position],
        'position': current_position,
        'total': len(current_chunks)
    })

@app.route('/pause', methods=['POST'])
def pause():
    return jsonify({'success': True})

@app.route('/ask', methods=['POST'])
def ask_question():
    if not current_document:
        return jsonify({'error': 'No document loaded'}), 400
    
    data = request.get_json()
    question = data.get('question', '')
    
    if not question:
        return jsonify({'error': 'No question provided'}), 400
    
    # Demo answer
    context = current_chunks[current_position] if current_chunks else ""
    answer = answer_question_demo(question, context)
    
    return jsonify({
        'answer': answer,
        'context_used': 1
    })

@app.route('/status', methods=['GET'])
def status():
    return jsonify({
        'is_playing': False,
        'position': current_position,
        'total_chunks': len(current_chunks),
        'document': current_document['name'] if current_document else None
    })

def start_server():
    app.run(host='127.0.0.1', port=5555, debug=False, threaded=True)

def main():
    print("🎧 Starting Clara (Demo Mode)...")
    print("\n⚠ This is a demo version for testing the UI")
    print("  Install Piper and Ollama for full functionality\n")
    
    # Start Flask server in background
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    time.sleep(2)
    
    print("✨ Launching Clara...\n")
    
    # Create webview window
    window = webview.create_window(
        'Clara (Demo)',
        'http://127.0.0.1:5555',
        width=1000,
        height=700,
        resizable=True,
        background_color='#FAFAFA'
    )
    
    webview.start()

if __name__ == '__main__':
    main()
