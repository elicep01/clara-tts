import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

let db: Database.Database | null = null;
let paths: {
    claraHome: string;
    dbPath: string;
    documents: string;
    thumbnails: string;
    audioCache: string;
    studySessions: string;
} | null = null;

function initPaths() {
    if (!paths) {
        const claraHome = path.join(app.getPath('userData'), 'Clara');
        paths = {
            claraHome,
            dbPath: path.join(claraHome, 'clara.db'),
            documents: path.join(claraHome, 'documents'),
            thumbnails: path.join(claraHome, 'thumbnails'),
            audioCache: path.join(claraHome, 'audio_cache'),
            studySessions: path.join(claraHome, 'study_sessions')
        };
    }
    return paths;
}

export function getDatabase(): Database.Database {
    if (!db) {
        throw new Error('Database not initialized');
    }
    return db;
}

export async function initDatabase(): Promise<void> {
    const p = initPaths();

    // Create directories
    [p.claraHome, p.documents, p.thumbnails, p.audioCache, p.studySessions].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // Open database
    db = new Database(p.dbPath);
    db.pragma('journal_mode = WAL');

    // Create tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            original_filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            folder_id TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            current_page INTEGER DEFAULT 0,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL,
            page_num INTEGER NOT NULL,
            content TEXT NOT NULL,
            position_x REAL,
            position_y REAL,
            anchor_text TEXT,
            anchor_type TEXT,
            question TEXT,
            color TEXT DEFAULT '#FFE066',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
        CREATE INDEX IF NOT EXISTS idx_notes_doc ON notes(doc_id);
        CREATE INDEX IF NOT EXISTS idx_notes_page ON notes(page_num);
    `);

    // Lightweight migrations for trash support.
    const hasDocumentDeletedAt = db.prepare(`PRAGMA table_info(documents)`).all()
        .some((c: any) => c.name === 'deleted_at');
    if (!hasDocumentDeletedAt) {
        db.exec(`ALTER TABLE documents ADD COLUMN deleted_at TIMESTAMP`);
    }

    const hasDocumentPrevFolder = db.prepare(`PRAGMA table_info(documents)`).all()
        .some((c: any) => c.name === 'previous_folder_id');
    if (!hasDocumentPrevFolder) {
        db.exec(`ALTER TABLE documents ADD COLUMN previous_folder_id TEXT`);
    }

    const hasFolderDeletedAt = db.prepare(`PRAGMA table_info(folders)`).all()
        .some((c: any) => c.name === 'deleted_at');
    if (!hasFolderDeletedAt) {
        db.exec(`ALTER TABLE folders ADD COLUMN deleted_at TIMESTAMP`);
    }

    const hasFolderPrevParent = db.prepare(`PRAGMA table_info(folders)`).all()
        .some((c: any) => c.name === 'previous_parent_id');
    if (!hasFolderPrevParent) {
        db.exec(`ALTER TABLE folders ADD COLUMN previous_parent_id TEXT`);
    }

    // Notes schema migrations for older installs.
    const noteColumns = db.prepare(`PRAGMA table_info(notes)`).all().map((c: any) => c.name);
    const hasAnchorX = noteColumns.includes('anchor_x');
    const hasAnchorY = noteColumns.includes('anchor_y');

    const ensureNoteColumn = (name: string, definition: string) => {
        if (!noteColumns.includes(name)) {
            db!.exec(`ALTER TABLE notes ADD COLUMN ${name} ${definition}`);
            noteColumns.push(name);
        }
    };

    ensureNoteColumn('position_x', 'REAL');
    ensureNoteColumn('position_y', 'REAL');
    ensureNoteColumn('anchor_text', 'TEXT');
    ensureNoteColumn('anchor_type', 'TEXT');
    ensureNoteColumn('question', 'TEXT');
    ensureNoteColumn('color', `TEXT DEFAULT '#FFE066'`);
    ensureNoteColumn('created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    ensureNoteColumn('updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

    if (hasAnchorX) {
        db.exec(`UPDATE notes SET position_x = COALESCE(position_x, anchor_x)`);
    }
    if (hasAnchorY) {
        db.exec(`UPDATE notes SET position_y = COALESCE(position_y, anchor_y)`);
    }

    console.log('[Database] Initialized at:', p.dbPath);
}

export function getDocumentsFolder(): string {
    return initPaths().documents;
}

export function getThumbnailsFolder(): string {
    return initPaths().thumbnails;
}

export function getAudioCacheFolder(): string {
    return initPaths().audioCache;
}

export function getStudySessionsFolder(): string {
    return initPaths().studySessions;
}

export function getClaraHome(): string {
    return initPaths().claraHome;
}
