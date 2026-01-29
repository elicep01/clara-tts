// Electron Adapter
// This file adapts the web version's fetch() calls to Electron IPC calls
// Place this in the renderer folder and load it before other scripts

(function() {
    'use strict';

    const originalFetch = window.fetch;

    // Override fetch to intercept API calls
    window.fetch = async function(url, options = {}) {
        // Parse URL
        const urlStr = url.toString();
        const method = (options.method || 'GET').toUpperCase();
        const body = options.body ? JSON.parse(options.body) : {};

        console.log('[ElectronAdapter]', method, urlStr);

        try {
            // Library endpoints
            if (urlStr === '/library') {
                const documents = await window.electronAPI.library.getDocuments();
                const folders = await window.electronAPI.library.getFolders();
                return createResponse({ documents, folders });
            }

            if (urlStr === '/folders' && method === 'POST') {
                const result = await window.electronAPI.library.createFolder(body.name, body.parent_id);
                return createResponse(result);
            }

            if (urlStr === '/upload' && method === 'POST') {
                // Handle file upload from FormData
                const formData = options.body;
                const file = formData.get('file');
                const folder_id = formData.get('folder_id');

                const buffer = await file.arrayBuffer();
                const result = await window.electronAPI.library.uploadDocument(
                    file.name,
                    Buffer.from(buffer),
                    folder_id
                );
                return createResponse(result);
            }

            // Document endpoints
            const docMatch = urlStr.match(/\/document\/([^\/]+)/);
            if (docMatch) {
                const doc_id = docMatch[1];

                if (urlStr.includes('/info')) {
                    const info = await window.electronAPI.document.getInfo(doc_id);
                    return createResponse(info);
                }

                if (urlStr.includes('/position') && method === 'PUT') {
                    const result = await window.electronAPI.document.updatePosition(doc_id, body.page);
                    return createResponse(result);
                }

                const pageMatch = urlStr.match(/\/page\/(\d+)/);
                if (pageMatch) {
                    const page_num = parseInt(pageMatch[1]);

                    if (urlStr.includes('/text')) {
                        const result = await window.electronAPI.document.getText(doc_id, page_num);
                        return createResponse(result);
                    }

                    if (urlStr.includes('/words')) {
                        const result = await window.electronAPI.document.getWords(doc_id, page_num);
                        return createResponse(result);
                    }

                    // Page image
                    const buffer = await window.electronAPI.document.getPage(doc_id, page_num);
                    return createResponse(buffer, 'image/png');
                }

                // Notes
                if (urlStr.includes('/notes')) {
                    if (method === 'GET') {
                        const notes = await window.electronAPI.notes.getAll(doc_id);
                        return createResponse(notes);
                    }
                    if (method === 'POST') {
                        const result = await window.electronAPI.notes.create(
                            doc_id,
                            body.page_num,
                            body.content,
                            body.position_x,
                            body.position_y
                        );
                        return createResponse(result);
                    }
                }

                if (method === 'DELETE') {
                    const result = await window.electronAPI.library.deleteDocument(doc_id);
                    return createResponse(result);
                }
            }

            // TTS
            if (urlStr === '/play-text' && method === 'POST') {
                const result = await window.electronAPI.tts.generate(body.text, body.voice);
                // Convert buffer to blob
                const blob = new Blob([result.audio], { type: 'audio/mpeg' });
                return new Response(blob, {
                    status: 200,
                    headers: { 'Content-Type': 'audio/mpeg' }
                });
            }

            if (urlStr === '/word-timings' && method === 'POST') {
                const result = await window.electronAPI.tts.getTimings(body.text, body.voice);
                return createResponse(result);
            }

            // AI
            if (urlStr === '/ask' && method === 'POST') {
                const answer = await window.electronAPI.ai.ask(body.question, body.context || body.page_text || '');
                return createResponse({ answer });
            }

            if (urlStr === '/define-word' && method === 'POST') {
                const definition = await window.electronAPI.ai.defineWord(body.word, body.context);
                return createResponse({ definition });
            }

            // Notes operations
            if (urlStr.includes('/notes/') && method === 'PUT') {
                const note_id = urlStr.split('/notes/')[1];
                const result = await window.electronAPI.notes.update(note_id, body.content);
                return createResponse(result);
            }

            if (urlStr.includes('/notes/') && method === 'DELETE') {
                const note_id = urlStr.split('/notes/')[1];
                const result = await window.electronAPI.notes.delete(note_id);
                return createResponse(result);
            }

            // Preferences
            if (urlStr === '/voice' && method === 'GET') {
                const voice = await window.electronAPI.prefs.get('voice');
                return createResponse({ voice: voice || 'female' });
            }

            if (urlStr === '/voice' && method === 'POST') {
                await window.electronAPI.prefs.set('voice', body.voice);
                return createResponse({ success: true });
            }

            // Fallback to original fetch for unhandled routes
            console.warn('[ElectronAdapter] Unhandled route:', method, urlStr);
            return originalFetch(url, options);

        } catch (error) {
            console.error('[ElectronAdapter] Error:', error);
            return createResponse({ error: error.message }, 'application/json', 500);
        }
    };

    function createResponse(data, contentType = 'application/json', status = 200) {
        const body = contentType === 'application/json' ? JSON.stringify(data) : data;
        return new Response(body, {
            status: status,
            headers: { 'Content-Type': contentType }
        });
    }

    console.log('[ElectronAdapter] Initialized - fetch() calls will use IPC');
})();
