import { ipcMain } from 'electron';
import { getDatabase, getDocumentsFolder } from './database';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { extractPDFInfo, renderPDFPage, extractPDFText, extractPDFWords } from './pdf';
import { generateAudioWithTimings, getWordTimings, getAvailableVoices, generatePreviewAudio } from './tts';
import { askGemini, defineWord } from './ai';

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
        // Move documents in this folder to root
        db.prepare('UPDATE documents SET folder_id = NULL WHERE folder_id = ?').run(folder_id);
        // Delete the folder
        db.prepare('DELETE FROM folders WHERE id = ?').run(folder_id);
        return { success: true };
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

    ipc.handle('notes:updatePosition', async (_event: any, { note_id, position_x, position_y, anchor_text }: any) => {
        const db = getDatabase();
        db.prepare('UPDATE notes SET position_x = ?, position_y = ?, anchor_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(position_x, position_y, anchor_text || null, note_id);
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
        // ALWAYS extract fresh text from PDF - don't trust frontend cache or database
        let docTitle = '';
        let actualPageText = '';
        let firstPageText = '';

        if (doc_id) {
            try {
                const db = getDatabase();
                const doc = db.prepare('SELECT original_filename FROM documents WHERE id = ?').get(doc_id) as any;
                const filePath = path.join(getDocumentsFolder(), doc_id, 'document.pdf');

                if (doc && fs.existsSync(filePath)) {
                    // Use filename as title (more reliable)
                    docTitle = doc.original_filename?.replace(/\.pdf$/i, '') || '';

                    // ALWAYS extract fresh text from the actual PDF file
                    const pageToExtract = page_num || 1;
                    console.log(`[AI] Extracting text from "${doc.original_filename}", page ${pageToExtract}`);
                    actualPageText = await extractPDFText(filePath, pageToExtract);

                    // For "book about" questions, also get first page
                    const questionLower = question.toLowerCase();
                    const isBookQuestion = ['this book', 'the book', 'document about', 'what is it about',
                        'what is this about', 'summarize the book', 'summarize this book', 'book about'].some(p => questionLower.includes(p));

                    if (isBookQuestion && pageToExtract !== 1) {
                        firstPageText = await extractPDFText(filePath, 1);
                    }
                } else {
                    console.error('[AI] Document not found:', doc_id, 'path:', filePath);
                }
            } catch (err) {
                console.error('[AI] Error extracting PDF text:', err);
            }
        }

        console.log(`[AI] Context: "${docTitle}", page ${page_num}, text length: ${actualPageText.length}`);
        const result = await askGemini(question, actualPageText, page_num, doc_id, docTitle, firstPageText);
        return result;
    });

    ipc.handle('ai:defineWord', async (_event: any, { word, context_sentence, full_context }: any) => {
        const definition = await defineWord(word, context_sentence, full_context);
        return definition;
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
