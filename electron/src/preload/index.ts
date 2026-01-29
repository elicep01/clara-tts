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
        uploadDocument: (filename: string, buffer: Buffer, folder_id?: string) =>
            ipcRenderer.invoke('library:uploadDocument', { filename, buffer, folder_id }),
        deleteDocument: (doc_id: string) =>
            ipcRenderer.invoke('library:deleteDocument', { doc_id }),
        renameDocument: (doc_id: string, new_name: string) =>
            ipcRenderer.invoke('library:renameDocument', { doc_id, new_name }),
        moveDocument: (doc_id: string, folder_id?: string) =>
            ipcRenderer.invoke('library:moveDocument', { doc_id, folder_id })
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
            ipcRenderer.invoke('tts:getTimings', { text, voice })
    },

    // Notes
    notes: {
        getAll: (doc_id: string) =>
            ipcRenderer.invoke('notes:getAll', { doc_id }),
        getByPage: (doc_id: string, page_num: number) =>
            ipcRenderer.invoke('notes:getByPage', { doc_id, page_num }),
        create: (doc_id: string, page_num: number, content: string, position_x?: number, position_y?: number) =>
            ipcRenderer.invoke('notes:create', { doc_id, page_num, content, position_x, position_y }),
        update: (note_id: string, content: string) =>
            ipcRenderer.invoke('notes:update', { note_id, content }),
        delete: (note_id: string) =>
            ipcRenderer.invoke('notes:delete', { note_id })
    },

    // AI
    ai: {
        ask: (question: string, context: string) =>
            ipcRenderer.invoke('ai:ask', { question, context }),
        defineWord: (word: string, context: string) =>
            ipcRenderer.invoke('ai:defineWord', { word, context })
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
            };
            notes: {
                getAll: (doc_id: string) => Promise<any[]>;
                getByPage: (doc_id: string, page_num: number) => Promise<any[]>;
                create: (doc_id: string, page_num: number, content: string, position_x?: number, position_y?: number) => Promise<any>;
                update: (note_id: string, content: string) => Promise<any>;
                delete: (note_id: string) => Promise<any>;
            };
            ai: {
                ask: (question: string, context: string) => Promise<string>;
                defineWord: (word: string, context: string) => Promise<string>;
            };
            prefs: {
                get: (key: string) => Promise<any>;
                set: (key: string, value: any) => Promise<any>;
            };
        };
    }
}
