import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Library
    library: {
        getFolders: () => ipcRenderer.invoke('library:getFolders'),
        getDocuments: () => ipcRenderer.invoke('library:getDocuments'),
        createFolder: (name: string, parent_id?: string) =>
            ipcRenderer.invoke('library:createFolder', { name, parent_id }),
        uploadDocument: (filename: string, buffer: Uint8Array, folder_id?: string) =>
            ipcRenderer.invoke('library:uploadDocument', { filename, buffer: Array.from(buffer), folder_id }),
        deleteDocument: (doc_id: string) =>
            ipcRenderer.invoke('library:deleteDocument', { doc_id }),
        renameDocument: (doc_id: string, new_name: string) =>
            ipcRenderer.invoke('library:renameDocument', { doc_id, new_name }),
        moveDocument: (doc_id: string, folder_id?: string) =>
            ipcRenderer.invoke('library:moveDocument', { doc_id, folder_id }),
        deleteFolder: (folder_id: string) =>
            ipcRenderer.invoke('library:deleteFolder', { folder_id }),
        renameFolder: (folder_id: string, new_name: string) =>
            ipcRenderer.invoke('library:renameFolder', { folder_id, new_name }),
        moveFolder: (folder_id: string, parent_id?: string) =>
            ipcRenderer.invoke('library:moveFolder', { folder_id, parent_id }),
        deleteMultiple: (doc_ids: string[], folder_ids: string[]) =>
            ipcRenderer.invoke('library:deleteMultiple', { doc_ids, folder_ids })
    },

    // Document
    document: {
        getInfo: (doc_id: string) =>
            ipcRenderer.invoke('document:getInfo', { doc_id }),
        getPage: (doc_id: string, page_num: number) =>
            ipcRenderer.invoke('document:getPage', { doc_id, page_num }),
        getText: (doc_id: string, page_num: number) =>
            ipcRenderer.invoke('document:getText', { doc_id, page_num }),
        getWords: (doc_id: string, page_num: number) =>
            ipcRenderer.invoke('document:getWords', { doc_id, page_num }),
        updatePosition: (doc_id: string, page: number) =>
            ipcRenderer.invoke('document:updatePosition', { doc_id, page })
    },

    // TTS
    tts: {
        generate: (text: string, voice: string) =>
            ipcRenderer.invoke('tts:generate', { text, voice }),
        getTimings: (text: string, voice: string) =>
            ipcRenderer.invoke('tts:getTimings', { text, voice }),
        getVoices: () =>
            ipcRenderer.invoke('tts:getVoices'),
        preview: (voice_id: string, text?: string) =>
            ipcRenderer.invoke('tts:preview', { voice_id, text })
    },

    // Notes
    notes: {
        getAll: (doc_id: string) =>
            ipcRenderer.invoke('notes:getAll', { doc_id }),
        getByPage: (doc_id: string, page_num: number) =>
            ipcRenderer.invoke('notes:getByPage', { doc_id, page_num }),
        create: (doc_id: string, page_num: number, content: string, position_x?: number, position_y?: number, anchor_text?: string, anchor_type?: string, question?: string, color?: string) =>
            ipcRenderer.invoke('notes:create', { doc_id, page_num, content, position_x, position_y, anchor_text, anchor_type, question, color }),
        update: (note_id: string, content: string, color?: string) =>
            ipcRenderer.invoke('notes:update', { note_id, content, color }),
        updatePosition: (note_id: string, position_x: number, position_y: number, anchor_text?: string) =>
            ipcRenderer.invoke('notes:updatePosition', { note_id, position_x, position_y, anchor_text }),
        delete: (note_id: string) =>
            ipcRenderer.invoke('notes:delete', { note_id })
    },

    // AI
    ai: {
        ask: (question: string, page_text: string, page_num?: number, doc_id?: string) =>
            ipcRenderer.invoke('ai:ask', { question, page_text, page_num, doc_id }),
        defineWord: (word: string, context_sentence: string, full_context?: string) =>
            ipcRenderer.invoke('ai:defineWord', { word, context_sentence, full_context })
    },

    // Preferences
    prefs: {
        get: (key: string) =>
            ipcRenderer.invoke('prefs:get', { key }),
        set: (key: string, value: any) =>
            ipcRenderer.invoke('prefs:set', { key, value })
    }
});

// Type definitions for TypeScript
declare global {
    interface Window {
        electronAPI: {
            library: {
                getFolders: () => Promise<any[]>;
                getDocuments: () => Promise<any[]>;
                createFolder: (name: string, parent_id?: string) => Promise<any>;
                uploadDocument: (filename: string, buffer: Buffer, folder_id?: string) => Promise<any>;
                deleteDocument: (doc_id: string) => Promise<any>;
                renameDocument: (doc_id: string, new_name: string) => Promise<any>;
                moveDocument: (doc_id: string, folder_id?: string) => Promise<any>;
                deleteFolder: (folder_id: string) => Promise<any>;
                renameFolder: (folder_id: string, new_name: string) => Promise<any>;
                moveFolder: (folder_id: string, parent_id?: string) => Promise<any>;
                deleteMultiple: (doc_ids: string[], folder_ids: string[]) => Promise<any>;
            };
            document: {
                getInfo: (doc_id: string) => Promise<any>;
                getPage: (doc_id: string, page_num: number) => Promise<Buffer>;
                getText: (doc_id: string, page_num: number) => Promise<{ text: string }>;
                getWords: (doc_id: string, page_num: number) => Promise<{ words: any[] }>;
                updatePosition: (doc_id: string, page: number) => Promise<any>;
            };
            tts: {
                generate: (text: string, voice: string) => Promise<{ audio: Buffer; timings: any[] }>;
                getTimings: (text: string, voice: string) => Promise<{ timings: any[] }>;
                getVoices: () => Promise<{ voices: any[] }>;
                preview: (voice_id: string, text?: string) => Promise<{ audio: Buffer }>;
            };
            notes: {
                getAll: (doc_id: string) => Promise<any[]>;
                getByPage: (doc_id: string, page_num: number) => Promise<any[]>;
                create: (doc_id: string, page_num: number, content: string, position_x?: number, position_y?: number) => Promise<any>;
                update: (note_id: string, content: string) => Promise<any>;
                delete: (note_id: string) => Promise<any>;
            };
            ai: {
                ask: (question: string, page_text: string, page_num?: number, doc_id?: string) => Promise<any>;
                defineWord: (word: string, context_sentence: string, full_context?: string) => Promise<any>;
            };
            prefs: {
                get: (key: string) => Promise<any>;
                set: (key: string, value: any) => Promise<any>;
            };
        };
    }
}
