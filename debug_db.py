#!/usr/bin/env python3
import sqlite3
from pathlib import Path

db_path = Path(__file__).parent / 'clara.db'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

print("=== Database Tables ===")
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()
for table in tables:
    print(f"  - {table['name']}")

print("\n=== Checking for documents ===")
try:
    cursor.execute('''
        SELECT id, name, original_filename, file_path, created_at, last_opened_at
        FROM documents
        ORDER BY created_at DESC
        LIMIT 10
    ''')

    for row in cursor.fetchall():
        print(f"\nID: {row['id']}")
        print(f"  Name: {row['name']}")
        print(f"  Filename: {row['original_filename']}")
        print(f"  Path: {row['file_path']}")
        print(f"  Created: {row['created_at']}")
        print(f"  Last Opened: {row['last_opened_at']}")

        # Check if file exists
        file_path = Path(row['file_path'])
        print(f"  File exists: {file_path.exists()}")
except sqlite3.OperationalError as e:
    print(f"Error: {e}")

conn.close()
