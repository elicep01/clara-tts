#!/usr/bin/env python3
"""Check what documents exist in filesystem and database"""
import sqlite3
from pathlib import Path
from datetime import datetime

CLARA_HOME = Path.home() / 'Documents' / 'Clara'
DATABASE_PATH = CLARA_HOME / 'clara.db'
DOCUMENTS_FOLDER = CLARA_HOME / 'documents'

print("=" * 60)
print("FILESYSTEM CHECK")
print("=" * 60)

if DOCUMENTS_FOLDER.exists():
    files = list(DOCUMENTS_FOLDER.glob('*.*'))
    print(f"\nDocuments folder: {DOCUMENTS_FOLDER}")
    print(f"Total files: {len(files)}\n")

    for f in sorted(files, key=lambda x: x.stat().st_mtime, reverse=True)[:10]:
        mtime = datetime.fromtimestamp(f.stat().st_mtime)
        size = f.stat().st_size
        print(f"  {f.name}")
        print(f"    Size: {size:,} bytes")
        print(f"    Modified: {mtime}")
        print()
else:
    print(f"Documents folder doesn't exist: {DOCUMENTS_FOLDER}")

print("=" * 60)
print("DATABASE CHECK")
print("=" * 60)

conn = sqlite3.connect(DATABASE_PATH)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

cursor.execute('SELECT COUNT(*) as count FROM documents')
count = cursor.fetchone()['count']
print(f"\nTotal documents in database: {count}\n")

cursor.execute('''
    SELECT id, name, original_filename, file_path, created_at, last_opened_at
    FROM documents
    ORDER BY created_at DESC
    LIMIT 10
''')

for row in cursor.fetchall():
    print(f"Document: {row['name']}")
    print(f"  ID: {row['id']}")
    print(f"  Filename: {row['original_filename']}")
    print(f"  Path: {row['file_path']}")
    print(f"  Created: {row['created_at']}")
    print(f"  Last Opened: {row['last_opened_at']}")

    # Check if file exists
    file_exists = Path(row['file_path']).exists()
    print(f"  File exists: {file_exists}")
    if not file_exists:
        print(f"  ⚠️  FILE MISSING!")
    print()

conn.close()

print("=" * 60)
