import { ipcMain } from 'electron';
import { getDatabase, getDocumentsFolder } from './database';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { extractPDFInfo, renderPDFPage, extractPDFText, extractPDFWords, extractTableOfContents } from './pdf';
import { generateAudioWithTimings, getWordTimings, getAvailableVoices, generatePreviewAudio } from './tts';
import { askGemini, defineWord, transcribeAudioWithGemini } from './ai';

function getFolderTreeIds(db: any, folderId: string): string[] {
    const rows = db.prepare(`
        WITH RECURSIVE folder_tree(id) AS (
            SELECT id FROM folders WHERE id = ?
            UNION
            SELECT f.id
            FROM folders f
            JOIN folder_tree t ON (f.parent_id = t.id OR f.previous_parent_id = t.id)
        )
        SELECT DISTINCT id FROM folder_tree
    `).all(folderId) as Array<{ id: string }>;
    return rows.map(r => r.id);
}

function moveDocumentToTrash(db: any, docId: string): void {
    db.prepare(`
        UPDATE documents
        SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
            previous_folder_id = COALESCE(previous_folder_id, folder_id),
            folder_id = NULL
        WHERE id = ?
    `).run(docId);
}

function moveFolderTreeToTrash(db: any, folderId: string): void {
    const treeIds = getFolderTreeIds(db, folderId);
    if (treeIds.length === 0) return;

    const marks = treeIds.map(() => '?').join(',');

    db.prepare(`
        UPDATE folders
        SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
            previous_parent_id = COALESCE(previous_parent_id, parent_id),
            parent_id = NULL
        WHERE id IN (${marks})
    `).run(...treeIds);

    db.prepare(`
        UPDATE documents
        SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
            previous_folder_id = COALESCE(previous_folder_id, folder_id),
            folder_id = NULL
        WHERE folder_id IN (${marks})
    `).run(...treeIds);
}

function restoreFolderTree(db: any, folderId: string): void {
    const rows = db.prepare(`
        WITH RECURSIVE restore_tree(id) AS (
            SELECT id FROM folders WHERE id = ?
            UNION
            SELECT f.id
            FROM folders f
            JOIN restore_tree t ON f.previous_parent_id = t.id
        )
        SELECT DISTINCT id FROM restore_tree
    `).all(folderId) as Array<{ id: string }>;
    const treeIds = rows.map(r => r.id);
    if (treeIds.length === 0) return;

    const marks = treeIds.map(() => '?').join(',');

    db.prepare(`
        UPDATE folders
        SET deleted_at = NULL,
            parent_id = previous_parent_id,
            previous_parent_id = NULL
        WHERE id IN (${marks})
    `).run(...treeIds);

    db.prepare(`
        UPDATE documents
        SET deleted_at = NULL,
            folder_id = previous_folder_id,
            previous_folder_id = NULL
        WHERE previous_folder_id IN (${marks})
    `).run(...treeIds);
}

function permanentlyDeleteFolderTree(db: any, folderId: string): number {
    const treeIds = getFolderTreeIds(db, folderId);
    if (treeIds.length === 0) return 0;

    const marks = treeIds.map(() => '?').join(',');
    const docs = db.prepare(`
        SELECT id, file_path FROM documents
        WHERE folder_id IN (${marks}) OR previous_folder_id IN (${marks})
    `).all(...treeIds, ...treeIds) as Array<{ id: string; file_path: string }>;

    for (const doc of docs) {
        if (doc.file_path && fs.existsSync(doc.file_path)) {
            fs.unlinkSync(doc.file_path);
        }
    }

    db.prepare(`DELETE FROM documents WHERE folder_id IN (${marks}) OR previous_folder_id IN (${marks})`)
        .run(...treeIds, ...treeIds);
    db.prepare(`DELETE FROM folders WHERE id IN (${marks})`).run(...treeIds);
    return treeIds.length;
}

function buildLocalAnswerFallback(question: string, contextText: string, docTitle: string, pageNum?: number): string {
    const safeQuestion = String(question || '').trim();
    const text = String(contextText || '').replace(/\s+/g, ' ').trim();
    const excerpt = text.length > 700 ? `${text.slice(0, 700)}...` : text;
    const pageLabel = Number.isFinite(pageNum as any) ? `page ${pageNum}` : 'the current page';
    if (!excerpt) {
        return `I couldn't reach the AI service right now. I also couldn't extract enough text from ${pageLabel} of "${docTitle || 'this document'}". Try again in a moment or ask a simpler question.`;
    }
    return [
        `I couldn't reach the AI service right now, so here's a best-effort answer from ${pageLabel} of "${docTitle || 'this document'}".`,
        '',
        `Question: ${safeQuestion || 'No question provided.'}`,
        '',
        `Relevant excerpt: ${excerpt}`
    ].join('\n');
}

export function setupIPCHandlers(ipc: typeof ipcMain): void {
    // ============================================
    // LIBRARY MANAGEMENT
    // ============================================

    ipc.handle('library:getFolders', async () => {
        const db = getDatabase();
        const folders = db.prepare('SELECT * FROM folders ORDER BY name').all();
        return folders;
    });

    ipc.handle('library:getDocuments', async () => {
        const db = getDatabase();
        const documents = db.prepare(`
            SELECT d.*, f.name as folder_name
            FROM documents d
            LEFT JOIN folders f ON d.folder_id = f.id
            ORDER BY d.last_accessed DESC
        `).all();
        return documents;
    });

    ipc.handle('library:createFolder', async (_event: any, { name, parent_id }: any) => {
        const db = getDatabase();
        const id = randomUUID();
        db.prepare('INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)')
            .run(id, name, parent_id || null);
        return { id, name, parent_id };
    });

    ipc.handle('library:uploadDocument', async (_event: any, { filename, buffer, folder_id }: any) => {
        const db = getDatabase();
        const id = randomUUID();
        const filePath = path.join(getDocumentsFolder(), `${id}${path.extname(filename)}`);

        // Convert array back to Buffer and save file
        const fileBuffer = Buffer.from(buffer);
        fs.writeFileSync(filePath, fileBuffer);

        // Insert into database
        db.prepare('INSERT INTO documents (id, original_filename, file_path, folder_id) VALUES (?, ?, ?, ?)')
            .run(id, filename, filePath, folder_id || null);

        return { id, filename, filePath };
    });

    ipc.handle('library:deleteDocument', async (_event: any, { doc_id }: any) => {
        const db = getDatabase();
        const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;

        if (doc && fs.existsSync(doc.file_path)) {
            fs.unlinkSync(doc.file_path);
        }

        db.prepare('DELETE FROM documents WHERE id = ?').run(doc_id);
        return { success: true };
    });

    ipc.handle('library:renameDocument', async (_event: any, { doc_id, new_name }: any) => {
        const db = getDatabase();
        db.prepare('UPDATE documents SET original_filename = ? WHERE id = ?').run(new_name, doc_id);
        return { success: true };
    });

    ipc.handle('library:moveDocument', async (_event: any, { doc_id, folder_id }: any) => {
        const db = getDatabase();
        db.prepare('UPDATE documents SET folder_id = ? WHERE id = ?').run(folder_id || null, doc_id);
        return { success: true };
    });

    ipc.handle('library:renameFolder', async (_event: any, { folder_id, new_name }: any) => {
        const db = getDatabase();
        db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(new_name, folder_id);
        return { success: true };
    });

    ipc.handle('library:deleteFolder', async (_event: any, { folder_id }: any) => {
        const db = getDatabase();
        const deletedFolders = permanentlyDeleteFolderTree(db, folder_id);
        return { success: true, deleted_folders: deletedFolders };
    });

    ipc.handle('library:moveFolder', async (_event: any, { folder_id, parent_id }: any) => {
        const db = getDatabase();
        // Prevent moving folder into itself or its descendants
        if (folder_id === parent_id) {
            return { success: false, error: 'Cannot move folder into itself' };
        }
        db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parent_id || null, folder_id);
        return { success: true };
    });

    ipc.handle('library:deleteMultiple', async (_event: any, { doc_ids, folder_ids }: any) => {
        const db = getDatabase();

        // Move documents to trash.
        if (doc_ids && doc_ids.length > 0) {
            for (const doc_id of doc_ids) {
                moveDocumentToTrash(db, doc_id);
            }
        }

        // Move folder trees to trash.
        if (folder_ids && folder_ids.length > 0) {
            for (const folder_id of folder_ids) {
                moveFolderTreeToTrash(db, folder_id);
            }
        }

        return { success: true, trashed_docs: doc_ids?.length || 0, trashed_folders: folder_ids?.length || 0 };
    });

    ipc.handle('library:moveDocumentToTrash', async (_event: any, { doc_id }: any) => {
        const db = getDatabase();
        moveDocumentToTrash(db, doc_id);
        return { success: true };
    });

    ipc.handle('library:moveFolderToTrash', async (_event: any, { folder_id }: any) => {
        const db = getDatabase();
        moveFolderTreeToTrash(db, folder_id);
        return { success: true };
    });

    ipc.handle('library:restoreDocument', async (_event: any, { doc_id }: any) => {
        const db = getDatabase();
        db.prepare(`
            UPDATE documents
            SET deleted_at = NULL,
                folder_id = previous_folder_id,
                previous_folder_id = NULL
            WHERE id = ?
        `).run(doc_id);
        return { success: true };
    });

    ipc.handle('library:restoreFolder', async (_event: any, { folder_id }: any) => {
        const db = getDatabase();
        restoreFolderTree(db, folder_id);
        return { success: true };
    });

    ipc.handle('library:deleteMultiplePermanent', async (_event: any, { doc_ids, folder_ids }: any) => {
        const db = getDatabase();
        let deletedDocs = 0;
        let deletedFolders = 0;

        if (doc_ids && doc_ids.length > 0) {
            for (const doc_id of doc_ids) {
                const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;
                if (doc && doc.file_path && fs.existsSync(doc.file_path)) {
                    fs.unlinkSync(doc.file_path);
                }
                db.prepare('DELETE FROM documents WHERE id = ?').run(doc_id);
                deletedDocs++;
            }
        }

        if (folder_ids && folder_ids.length > 0) {
            for (const folder_id of folder_ids) {
                deletedFolders += permanentlyDeleteFolderTree(db, folder_id);
            }
        }

        return { success: true, deleted_docs: deletedDocs, deleted_folders: deletedFolders };
    });

    ipc.handle('library:emptyTrash', async () => {
        const db = getDatabase();
        const trashedDocs = db.prepare('SELECT id, file_path FROM documents WHERE deleted_at IS NOT NULL').all() as any[];
        for (const doc of trashedDocs) {
            if (doc.file_path && fs.existsSync(doc.file_path)) {
                fs.unlinkSync(doc.file_path);
            }
        }

        const deletedDocs = db.prepare('DELETE FROM documents WHERE deleted_at IS NOT NULL').run().changes;
        const deletedFolders = db.prepare('DELETE FROM folders WHERE deleted_at IS NOT NULL').run().changes;
        return { success: true, deleted_docs: deletedDocs, deleted_folders: deletedFolders };
    });

    // ============================================
    // DOCUMENT VIEWER
    // ============================================

    ipc.handle('document:getInfo', async (_event: any, { doc_id }: any) => {
        const db = getDatabase();
        const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc_id) as any;

        if (!doc) {
            throw new Error('Document not found');
        }

        const info = await extractPDFInfo(doc.file_path);
        return {
            id: doc.id,
            filename: doc.original_filename,
            page_count: info.pageCount,
            current_page: doc.current_page ?? 0,  // Zero-based page index for renderer
            is_pdf: true
        };
    });

    ipc.handle('document:getPage', async (_event: any, { doc_id, page_num }: any) => {
        const db = getDatabase();
        const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;

        if (!doc) {
            throw new Error('Document not found');
        }

        const imageBuffer = await renderPDFPage(doc.file_path, page_num);
        return imageBuffer;
    });

    ipc.handle('document:getText', async (_event: any, { doc_id, page_num }: any) => {
        const db = getDatabase();
        const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;

        if (!doc) {
            throw new Error('Document not found');
        }

        const text = await extractPDFText(doc.file_path, page_num);
        return { text };
    });

    ipc.handle('document:getWords', async (_event: any, { doc_id, page_num }: any) => {
        const db = getDatabase();
        const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;

        if (!doc) {
            throw new Error('Document not found');
        }

        const words = await extractPDFWords(doc.file_path, page_num);
        return { words };
    });

    ipc.handle('document:updatePosition', async (_event: any, { doc_id, page }: any) => {
        const db = getDatabase();
        db.prepare('UPDATE documents SET current_page = ?, last_accessed = CURRENT_TIMESTAMP WHERE id = ?')
            .run(page, doc_id);
        return { success: true };
    });

    ipc.handle('document:getTOC', async (_event: any, { doc_id }: any) => {
        const db = getDatabase();
        const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;
        if (!doc) {
            throw new Error('Document not found');
        }
        const toc = await extractTableOfContents(doc.file_path, { includeFallback: true, maxFallbackPages: 320 });
        return { toc };
    });

    ipc.handle('document:getTOCQuick', async (_event: any, { doc_id }: any) => {
        const db = getDatabase();
        const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;
        if (!doc) {
            throw new Error('Document not found');
        }
        const toc = await extractTableOfContents(doc.file_path, { includeFallback: false });
        return { toc, method: 'outline' };
    });

    ipc.handle('document:getTOCEnhanced', async (_event: any, { doc_id }: any) => {
        const db = getDatabase();
        const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;
        if (!doc) {
            throw new Error('Document not found');
        }
        const toc = await extractTableOfContents(doc.file_path, { includeFallback: true, maxFallbackPages: 320 });
        return { toc, method: 'outline+heuristic' };
    });

    // ============================================
    // TEXT-TO-SPEECH
    // ============================================

    ipc.handle('tts:generate', async (_event: any, { text, voice }: any) => {
        const { audioPath, timings } = await generateAudioWithTimings(text, voice);
        const audioBuffer = fs.readFileSync(audioPath);
        fs.unlinkSync(audioPath); // Clean up temp file
        return { audio: audioBuffer, timings };
    });

    ipc.handle('tts:getTimings', async (_event: any, { text, voice }: any) => {
        const timings = await getWordTimings(text, voice);
        return { timings };
    });

    ipc.handle('tts:getVoices', async () => {
        const voices = await getAvailableVoices();
        return { voices };
    });

    ipc.handle('tts:preview', async (_event: any, { voice_id, text }: any) => {
        const audioBuffer = await generatePreviewAudio(voice_id, text);
        return { audio: audioBuffer };
    });

    // ============================================
    // NOTES
    // ============================================

    ipc.handle('notes:getAll', async (_event: any, { doc_id }: any) => {
        const db = getDatabase();
        const notes = db.prepare('SELECT * FROM notes WHERE doc_id = ? ORDER BY page_num, created_at').all(doc_id);
        return notes;
    });

    ipc.handle('notes:getByPage', async (_event: any, { doc_id, page_num }: any) => {
        const db = getDatabase();
        const notes = db.prepare('SELECT * FROM notes WHERE doc_id = ? AND page_num = ? ORDER BY created_at').all(doc_id, page_num);
        return notes;
    });

    ipc.handle('notes:create', async (_event: any, { doc_id, page_num, content, position_x, position_y, anchor_text, anchor_type, question, color }: any) => {
        const db = getDatabase();
        const id = randomUUID();
        db.prepare(`INSERT INTO notes (id, doc_id, page_num, content, position_x, position_y, anchor_text, anchor_type, question, color)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, doc_id, page_num, content, position_x || null, position_y || null, anchor_text || null, anchor_type || null, question || null, color || '#FFE066');

        const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
        return note;
    });

    ipc.handle('notes:update', async (_event: any, { note_id, content, color }: any) => {
        const db = getDatabase();
        db.prepare('UPDATE notes SET content = ?, color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(content, color || '#FFE066', note_id);
        return { success: true };
    });

    ipc.handle('notes:updatePosition', async (_event: any, { note_id, position_x, position_y, anchor_text, page_num }: any) => {
        const db = getDatabase();
        const nextPageNum = Number.isFinite(page_num)
            ? Number(page_num)
            : (db.prepare('SELECT page_num FROM notes WHERE id = ?').get(note_id) as any)?.page_num;
        db.prepare('UPDATE notes SET page_num = ?, position_x = ?, position_y = ?, anchor_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(nextPageNum, position_x, position_y, anchor_text || null, note_id);
        return { success: true };
    });

    ipc.handle('notes:delete', async (_event: any, { note_id }: any) => {
        const db = getDatabase();
        db.prepare('DELETE FROM notes WHERE id = ?').run(note_id);
        return { success: true };
    });

    // ============================================
    // AI / GEMINI
    // ============================================

    ipc.handle('ai:ask', async (_event: any, { question, page_text, page_num, doc_id }: any) => {
        console.log(`[AI] Question received: "${question.substring(0, 50)}...", doc_id: ${doc_id}, page: ${page_num}`);

        // ALWAYS extract fresh text from PDF - don't trust frontend cache
        let docTitle = '';
        let actualPageText = '';
        let firstPageText = '';
        let filePath = '';

        if (!doc_id) {
            console.error('[AI] No doc_id provided!');
            return { answer: 'Please open a document first before asking questions.', error: 'no_document' };
        }

        try {
            const db = getDatabase();
            const doc = db.prepare('SELECT original_filename FROM documents WHERE id = ?').get(doc_id) as any;
            // PDFs are stored as {doc_id}.pdf directly in documents folder
            filePath = path.join(getDocumentsFolder(), `${doc_id}.pdf`);

            console.log(`[AI] Looking for file at: ${filePath}`);

            if (!doc) {
                console.error('[AI] Document not in database:', doc_id);
                return { answer: 'Document not found in library. Please re-upload.', error: 'not_in_db' };
            }

            if (!fs.existsSync(filePath)) {
                console.error('[AI] PDF file missing:', filePath);
                return { answer: 'PDF file not found. Please re-upload the document.', error: 'file_missing' };
            }

            // Use filename as title
            docTitle = doc.original_filename?.replace(/\.pdf$/i, '') || 'Unknown Document';

            // ALWAYS extract fresh text from the actual PDF file
            const pageToExtract = Number.isFinite(page_num) ? Number(page_num) : 1;
            const pageIndex = Math.max(0, pageToExtract - 1);
            console.log(`[AI] Extracting text from "${doc.original_filename}", page ${pageToExtract}`);
            actualPageText = await extractPDFText(filePath, pageIndex);
            console.log(`[AI] Extracted ${actualPageText.length} characters`);

            if (!actualPageText || actualPageText.length < 80) {
                console.warn('[AI] Sparse text extraction on requested page, collecting nearby context');
                const info = await extractPDFInfo(filePath);
                const maxPage = Math.max(1, info.pageCount || 1);
                const nearbyPages = [pageToExtract - 1, pageToExtract, pageToExtract + 1, pageToExtract + 2]
                    .filter((p, idx, arr) => p >= 1 && p <= maxPage && arr.indexOf(p) === idx);

                const chunks: string[] = [];
                for (const p of nearbyPages) {
                    const txt = await extractPDFText(filePath, p - 1);
                    if (txt && txt.trim().length > 0) {
                        chunks.push(`[Page ${p}] ${txt.trim()}`);
                    }
                }

                if (chunks.length > 0) {
                    actualPageText = chunks.join('\n\n');
                    console.log(`[AI] Built fallback context with ${actualPageText.length} characters from nearby pages`);
                }
            }

            // For "book about" questions, also get first page
            const questionLower = question.toLowerCase();
            const isBookQuestion = ['this book', 'the book', 'document about', 'what is it about',
                'what is this about', 'summarize the book', 'summarize this book', 'book about'].some(p => questionLower.includes(p));

            if (isBookQuestion && pageToExtract !== 1) {
                firstPageText = await extractPDFText(filePath, 0);
            }

            // Ensure we always have at least a minimal context payload.
            if (!actualPageText || actualPageText.trim().length === 0) {
                actualPageText = `Document title: ${docTitle}. Limited extractable text available from the PDF pages.`;
            }
        } catch (err) {
            console.error('[AI] Error extracting PDF text:', err);
            return { answer: `Error reading PDF: ${err}`, error: 'exception' };
        }

        console.log(`[AI] Sending to Gemini - doc: "${docTitle}", page: ${page_num}, text: ${actualPageText.length} chars`);
        try {
            const result = await askGemini(question, actualPageText, page_num, doc_id, docTitle, firstPageText);
            return result;
        } catch (err) {
            console.error('[AI] Gemini unavailable, returning local fallback answer:', err);
            return {
                answer: buildLocalAnswerFallback(question, actualPageText || firstPageText || '', docTitle, page_num),
                fallback_answer: true
            };
        }
    });

    ipc.handle('ai:defineWord', async (_event: any, { word, context_sentence, full_context }: any) => {
        const definition = await defineWord(word, context_sentence, full_context);
        return definition;
    });

    ipc.handle('ai:transcribeAudio', async (_event: any, { audio_bytes, mime_type }: any) => {
        const bytes = Array.isArray(audio_bytes) ? audio_bytes : [];
        if (bytes.length === 0) {
            return { error: 'No audio provided' };
        }

        try {
            const buffer = Buffer.from(bytes);
            const transcript = await transcribeAudioWithGemini(buffer, mime_type || 'audio/webm');
            return { transcript };
        } catch (err: any) {
            console.error('[AI] Audio transcription failed:', err);
            return { error: err?.message || 'Transcription failed' };
        }
    });

    // ============================================
    // PREFERENCES
    // ============================================

    ipc.handle('prefs:get', async (_event: any, { key }: any) => {
        // Store preferences in a simple JSON file
        const prefsPath = path.join(getDocumentsFolder(), '..', 'preferences.json');
        if (!fs.existsSync(prefsPath)) {
            return null;
        }
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
        return prefs[key] || null;
    });

    ipc.handle('prefs:set', async (_event: any, { key, value }: any) => {
        const prefsPath = path.join(getDocumentsFolder(), '..', 'preferences.json');
        let prefs: any = {};
        if (fs.existsSync(prefsPath)) {
            prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
        }
        prefs[key] = value;
        fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
        return { success: true };
    });

    console.log('[IPC] All handlers registered');
}
