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

        // Parse body - handle FormData separately
        let body = {};
        if (options.body) {
            if (options.body instanceof FormData) {
                // Don't parse FormData - handle it in specific endpoints
                body = null;
            } else if (typeof options.body === 'string') {
                try {
                    body = JSON.parse(options.body);
                } catch (e) {
                    body = {};
                }
            }
        }

        console.log('[ElectronAdapter]', method, urlStr);

        try {
            // Library endpoints
            if (urlStr === '/library') {
                const documents = await window.electronAPI.library.getDocuments();
                const folders = await window.electronAPI.library.getFolders();

                // Map database fields to what the frontend expects
                const mappedDocs = documents.map(doc => ({
                    ...doc,
                    name: doc.original_filename,
                    progress: doc.current_page && doc.page_count
                        ? Math.round((doc.current_page / doc.page_count) * 100)
                        : 0
                }));

                return createResponse({ documents: mappedDocs, folders });
            }

            // Create folder - support both endpoints
            if ((urlStr === '/folders' || urlStr === '/library/folder') && method === 'POST') {
                const result = await window.electronAPI.library.createFolder(body?.name, body?.parent_id);
                return createResponse(result);
            }

            if (urlStr === '/upload' && method === 'POST') {
                // Handle file upload from FormData
                const formData = options.body;

                if (!(formData instanceof FormData)) {
                    throw new Error('Upload requires FormData');
                }

                const file = formData.get('file');
                const folder_id = formData.get('folder_id');

                if (!file) {
                    throw new Error('No file provided');
                }

                // Read file as array buffer
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                const result = await window.electronAPI.library.uploadDocument(
                    file.name,
                    uint8Array,
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

                // Thumbnails
                const thumbMatch = urlStr.match(/\/thumbnail\/(\d+)/);
                if (thumbMatch) {
                    const page_num = parseInt(thumbMatch[1]);
                    // Thumbnails use same page endpoint for now
                    const buffer = await window.electronAPI.document.getPage(doc_id, page_num);
                    return createResponse(buffer, 'image/png');
                }

                // TOC endpoints (not implemented yet - return empty)
                if (urlStr.includes('/toc')) {
                    return createResponse({ toc: [] });
                }

                // Notes
                if (urlStr.includes('/notes')) {
                    if (method === 'GET') {
                        const notes = await window.electronAPI.notes.getAll(doc_id);
                        // Map database fields to frontend format
                        const mappedNotes = notes.map(note => ({
                            ...note,
                            anchor_x: note.position_x,
                            anchor_y: note.position_y
                        }));
                        return createResponse({ notes: mappedNotes });
                    }
                    if (method === 'POST') {
                        const result = await window.electronAPI.notes.create(
                            doc_id,
                            body?.page_num,
                            body?.content,
                            body?.anchor_x,
                            body?.anchor_y,
                            body?.anchor_text,
                            body?.anchor_type,
                            body?.question,
                            body?.color
                        );
                        // Map response
                        const mapped = {
                            ...result,
                            anchor_x: result.position_x,
                            anchor_y: result.position_y
                        };
                        return createResponse(mapped);
                    }
                }

                if (method === 'DELETE') {
                    const result = await window.electronAPI.library.deleteDocument(doc_id);
                    return createResponse(result);
                }
            }

            // First launch status
            if (urlStr === '/first-launch-status') {
                // For now, skip first launch setup since Ollama auto-starts
                return createResponse({
                    is_first_launch: false,
                    has_base_model: true,
                    base_model: {
                        id: 'llama3.2:1b',
                        name: 'Llama 3.2 1B',
                        size_mb: 1300
                    }
                });
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
                return createResponse(result.timings || []);
            }

            // AI - Q&A
            if (urlStr === '/ask' && method === 'POST') {
                const result = await window.electronAPI.ai.ask(
                    body.question,
                    body.page_text || '',
                    body.page_num,
                    body.doc_id
                );
                return createResponse(result);
            }

            // AI - Word definitions (contextual)
            if (urlStr === '/dictionary/llm-define' && method === 'POST') {
                const definition = await window.electronAPI.ai.defineWord(
                    body.word,
                    body.context_sentence || '',
                    body.full_context || ''
                );
                return createResponse(definition);
            }

            // Legacy endpoint for word definitions
            if (urlStr === '/define-word' && method === 'POST') {
                const definition = await window.electronAPI.ai.defineWord(
                    body.word,
                    body.context || '',
                    ''
                );
                return createResponse({ definition });
            }

            // Notes operations
            if (urlStr.includes('/notes/') && method === 'PUT') {
                const parts = urlStr.split('/notes/')[1].split('/');
                const note_id = parts[0];

                // Check if it's a position update
                if (urlStr.includes('/position')) {
                    const result = await window.electronAPI.notes.updatePosition(
                        note_id,
                        body.anchor_x,
                        body.anchor_y,
                        body.anchor_text
                    );
                    return createResponse(result);
                } else {
                    // Regular note update
                    const result = await window.electronAPI.notes.update(note_id, body.content, body.color);
                    return createResponse(result);
                }
            }

            if (urlStr.includes('/notes/') && method === 'DELETE') {
                const note_id = urlStr.split('/notes/')[1];
                const result = await window.electronAPI.notes.delete(note_id);
                return createResponse(result);
            }

            // Library document operations
            const libDocMatch = urlStr.match(/\/library\/document\/([^\/]+)/);
            if (libDocMatch) {
                const doc_id = libDocMatch[1].split('/')[0]; // Handle /move and /rename suffixes

                if (method === 'POST' && urlStr.includes('/trash')) {
                    const result = await window.electronAPI.library.moveDocumentToTrash(doc_id);
                    return createResponse(result);
                }

                if (method === 'POST' && urlStr.includes('/restore')) {
                    const result = await window.electronAPI.library.restoreDocument(doc_id);
                    return createResponse(result);
                }

                if (method === 'DELETE') {
                    const result = await window.electronAPI.library.deleteDocument(doc_id);
                    return createResponse(result);
                }

                // Handle /rename endpoint explicitly
                if (method === 'PUT' && urlStr.includes('/rename')) {
                    const result = await window.electronAPI.library.renameDocument(doc_id, body.name);
                    return createResponse(result);
                }

                // Handle /move endpoint explicitly
                if (method === 'PUT' && urlStr.includes('/move')) {
                    const result = await window.electronAPI.library.moveDocument(doc_id, body.folder_id);
                    return createResponse(result);
                }

                // Fallback for body-based detection
                if (method === 'PUT' && body.name) {
                    const result = await window.electronAPI.library.renameDocument(doc_id, body.name);
                    return createResponse(result);
                }

                if (method === 'PUT' && body.folder_id !== undefined) {
                    const result = await window.electronAPI.library.moveDocument(doc_id, body.folder_id);
                    return createResponse(result);
                }
            }

            // Library folder operations
            const libFolderMatch = urlStr.match(/\/library\/folder\/([^\/]+)/);
            if (libFolderMatch) {
                const folder_id = libFolderMatch[1].split('/')[0]; // Handle /move suffix

                if (method === 'POST' && urlStr.includes('/trash')) {
                    const result = await window.electronAPI.library.moveFolderToTrash(folder_id);
                    return createResponse(result);
                }

                if (method === 'POST' && urlStr.includes('/restore')) {
                    const result = await window.electronAPI.library.restoreFolder(folder_id);
                    return createResponse(result);
                }

                if (method === 'DELETE') {
                    const result = await window.electronAPI.library.deleteFolder(folder_id);
                    return createResponse(result);
                }

                // Handle /move endpoint explicitly
                if (method === 'PUT' && urlStr.includes('/move')) {
                    const result = await window.electronAPI.library.moveFolder(folder_id, body.parent_id);
                    return createResponse(result);
                }

                // Rename folder
                if (method === 'PUT' && body.name) {
                    const result = await window.electronAPI.library.renameFolder(folder_id, body.name);
                    return createResponse(result);
                }
            }

            // Batch delete multiple items
            if (urlStr === '/library/delete-multiple' && method === 'POST') {
                const result = await window.electronAPI.library.deleteMultiple(
                    body.doc_ids || [],
                    body.folder_ids || []
                );
                return createResponse(result);
            }

            if (urlStr === '/library/delete-multiple-permanent' && method === 'POST') {
                const result = await window.electronAPI.library.deleteMultiplePermanent(
                    body.doc_ids || [],
                    body.folder_ids || []
                );
                return createResponse(result);
            }

            if (urlStr === '/library/empty-trash' && method === 'POST') {
                const result = await window.electronAPI.library.emptyTrash();
                return createResponse(result);
            }

            // TTS - Get available voices
            if (urlStr === '/tts/voices' && method === 'GET') {
                const result = await window.electronAPI.tts.getVoices();
                // Transform Edge TTS format to frontend format
                const transformedVoices = result.voices.map(v => ({
                    id: v.ShortName,
                    name: v.FriendlyName,
                    language: v.Locale,
                    gender: v.Gender,
                    locale: v.Locale,
                    shortName: v.ShortName
                }));
                return createResponse({ voices: transformedVoices });
            }

            // TTS - Voice preferences
            if ((urlStr === '/voice' || urlStr === '/tts/voice') && method === 'GET') {
                const voice = await window.electronAPI.prefs.get('voice_id');
                return createResponse({ voice_id: voice || 'en-US-JennyNeural' });
            }

            if ((urlStr === '/voice' || urlStr === '/tts/voice') && method === 'POST') {
                await window.electronAPI.prefs.set('voice_id', body.voice_id || body.voice);
                return createResponse({ success: true });
            }

            // TTS - Preview audio
            if (urlStr === '/tts/preview' && method === 'POST') {
                const result = await window.electronAPI.tts.preview(body.voice_id, body.text);
                // Return audio as blob for direct playback
                const blob = new Blob([result.audio], { type: 'audio/mpeg' });
                return new Response(blob, {
                    status: 200,
                    headers: { 'Content-Type': 'audio/mpeg' }
                });
            }

            // LLM Status - Check if Ollama is running
            if (urlStr === '/llm/status' && method === 'GET') {
                try {
                    // Try to reach local Ollama
                    const ollamaResponse = await originalFetch('http://localhost:11434/api/tags', {
                        method: 'GET',
                        signal: AbortSignal.timeout(3000)
                    });

                    if (ollamaResponse.ok) {
                        const data = await ollamaResponse.json();
                        const models = data.models || [];
                        const downloadedModels = models.map(m => ({
                            id: m.name,
                            name: m.name,
                            size_mb: Math.round((m.size || 0) / (1024 * 1024)),
                            parameters: m.details?.parameter_size || ''
                        }));

                        // Get current model from preferences
                        const currentModel = await window.electronAPI.prefs.get('llm_model');

                        const availableModels = [
                                {
                                    id: 'llama3.2:1b',
                                    name: 'Llama 3.2 1B',
                                    description: 'Best for quick Q&A. Fastest responses, low memory usage. Great for simple document questions.',
                                    size_mb: 1300,
                                    parameters: '1B',
                                    bestFor: 'Speed & Simplicity',
                                    tradeoff: 'Less detailed answers'
                                },
                                {
                                    id: 'llama3.2:3b',
                                    name: 'Llama 3.2 3B',
                                    description: 'Balanced choice. Good comprehension with reasonable speed. Handles complex questions well.',
                                    size_mb: 2000,
                                    parameters: '3B',
                                    bestFor: 'Balanced Performance',
                                    tradeoff: 'Moderate memory use'
                                },
                                {
                                    id: 'gemma2:2b',
                                    name: 'Gemma 2 2B',
                                    description: 'Google\'s model. Excellent at summarization and extracting key points from documents.',
                                    size_mb: 1600,
                                    parameters: '2B',
                                    bestFor: 'Summaries & Analysis',
                                    tradeoff: 'Slightly slower'
                                },
                                {
                                    id: 'phi3:mini',
                                    name: 'Phi-3 Mini',
                                    description: 'Microsoft\'s model. Strong reasoning and detailed explanations. Best for technical documents.',
                                    size_mb: 2300,
                                    parameters: '3.8B',
                                    bestFor: 'Technical & Reasoning',
                                    tradeoff: 'Higher memory (4GB+)'
                                },
                                {
                                    id: 'qwen2.5:3b',
                                    name: 'Qwen 2.5 3B',
                                    description: 'Alibaba\'s latest. Excellent multilingual support. Great for non-English documents.',
                                    size_mb: 1900,
                                    parameters: '3B',
                                    bestFor: 'Multilingual Support',
                                    tradeoff: 'Moderate memory use'
                                }
                            ];

                        return createResponse({
                            llm_available: downloadedModels.length > 0,
                            current_model: currentModel || (downloadedModels[0]?.id || null),
                            downloaded_models: downloadedModels,
                            available_models: availableModels
                        });
                    }
                } catch (e) {
                    console.log('[LLM] AI engine not accessible:', e.message);
                }

                // AI engine not available - still show models but with init message
                const availableModels = [
                    {
                        id: 'llama3.2:1b',
                        name: 'Llama 3.2 1B',
                        description: 'Best for quick Q&A. Fastest responses, low memory usage. Great for simple document questions.',
                        size_mb: 1300,
                        parameters: '1B',
                        bestFor: 'Speed & Simplicity',
                        tradeoff: 'Less detailed answers'
                    },
                    {
                        id: 'llama3.2:3b',
                        name: 'Llama 3.2 3B',
                        description: 'Balanced choice. Good comprehension with reasonable speed. Handles complex questions well.',
                        size_mb: 2000,
                        parameters: '3B',
                        bestFor: 'Balanced Performance',
                        tradeoff: 'Moderate memory use'
                    },
                    {
                        id: 'gemma2:2b',
                        name: 'Gemma 2 2B',
                        description: 'Google\'s model. Excellent at summarization and extracting key points from documents.',
                        size_mb: 1600,
                        parameters: '2B',
                        bestFor: 'Summaries & Analysis',
                        tradeoff: 'Slightly slower'
                    },
                    {
                        id: 'phi3:mini',
                        name: 'Phi-3 Mini',
                        description: 'Microsoft\'s model. Strong reasoning and detailed explanations. Best for technical documents.',
                        size_mb: 2300,
                        parameters: '3.8B',
                        bestFor: 'Technical & Reasoning',
                        tradeoff: 'Higher memory (4GB+)'
                    },
                    {
                        id: 'qwen2.5:3b',
                        name: 'Qwen 2.5 3B',
                        description: 'Alibaba\'s latest. Excellent multilingual support. Great for non-English documents.',
                        size_mb: 1900,
                        parameters: '3B',
                        bestFor: 'Multilingual Support',
                        tradeoff: 'Moderate memory use'
                    }
                ];

                return createResponse({
                    llm_available: false,
                    current_model: null,
                    downloaded_models: [],
                    available_models: availableModels,
                    error: 'AI engine initializing... This may take a moment on first launch.'
                });
            }

            // LLM Load model
            if (urlStr === '/llm/load' && method === 'POST') {
                try {
                    // Pull/load model in Ollama
                    await window.electronAPI.prefs.set('llm_model', body.model_id);
                    return createResponse({ success: true, model: body.model_id });
                } catch (e) {
                    return createResponse({ error: e.message }, 'application/json', 500);
                }
            }

            // LLM Download model
            if (urlStr === '/llm/download' && method === 'POST') {
                try {
                    // Start Ollama pull
                    const pullResponse = await originalFetch('http://localhost:11434/api/pull', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: body.model_id })
                    });
                    return createResponse({ success: true, status: 'downloading' });
                } catch (e) {
                    return createResponse({ error: 'AI engine not running. Please complete the quick setup first.' }, 'application/json', 500);
                }
            }

            // LLM Download progress
            const progressMatch = urlStr.match(/\/llm\/download-progress\/(.+)/);
            if (progressMatch && method === 'GET') {
                // For now, return complete status (proper streaming would require more work)
                return createResponse({ status: 'complete', progress: 100 });
            }

            // LLM Delete model
            const deleteMatch = urlStr.match(/\/llm\/delete\/(.+)/);
            if (deleteMatch && method === 'DELETE') {
                try {
                    const modelId = deleteMatch[1];
                    await originalFetch('http://localhost:11434/api/delete', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: modelId })
                    });
                    return createResponse({ success: true });
                } catch (e) {
                    return createResponse({ error: e.message }, 'application/json', 500);
                }
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
