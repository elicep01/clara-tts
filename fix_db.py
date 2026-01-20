#!/usr/bin/env python3
"""Manually initialize the Clara database"""
import sqlite3
from pathlib import Path

# Path to database (must match app.py)
CLARA_HOME = Path.home() / 'Documents' / 'Clara'
DATABASE_PATH = CLARA_HOME / 'clara.db'

def init_database():
    """Initialize SQLite database with schema"""
    print(f"Initializing database at: {DATABASE_PATH}")

    # Ensure directory exists
    CLARA_HOME.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # Folders table
    print("Creating folders table...")
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
    print("Creating documents table...")
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
    print("Creating annotations table...")
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
    print("Creating settings table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Downloaded LLM models table
    print("Creating llm_models table...")
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

    print("\n✅ Database initialized successfully!")
    print(f"Database location: {DATABASE_PATH}")

    # Verify tables were created
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    print(f"\nCreated tables:")
    for table in tables:
        print(f"  - {table[0]}")
    conn.close()

if __name__ == '__main__':
    init_database()
