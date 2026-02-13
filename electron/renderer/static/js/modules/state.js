// Clara - State Management Module
// Centralized state management for the application

export const createInitialState = () => ({
    // Navigation
    currentView: 'library',
    viewHistory: [],

    // Library
    folders: [],
    documents: [],
    currentFolderId: null,
    viewingTrash: false,

    // Viewer
    viewerDocId: null,
    viewerDocName: '',
    viewerPageCount: 0,
    viewerCurrentPage: 0,
    viewerZoom: 1.0,
    isPdf: false,

    // Reading (integrated into viewer)
    isReadingMode: false,
    currentDocId: null,
    currentDocName: '',
    pageText: '',
    words: [],
    currentWordIndex: 0,
    isPlaying: false,
    playbackSpeed: 1,

    // Reading session state (persists when navigating away)
    readingSession: null,  // { docId, docName, pageNum, wordIndex, words, pageText, isPdf }

    // Voice
    selectedVoice: 'en-US-JennyNeural',

    // Drag
    draggedItem: null,
    draggedItemType: null,

    // Context menu
    selectedItem: null,
    selectedItemType: null,

    // Multi-select
    selectedItems: [],  // Array of { id, type: 'document' | 'folder' }
    isMultiSelectMode: false,

    // Notes
    notes: [],
    currentNote: null,
    lastQuestion: '',
    lastAnswer: '',
    draggingNote: null,
    studyMode: false
});

// State class for reactive updates (optional enhancement)
export class StateManager {
    constructor() {
        this.state = createInitialState();
        this.listeners = new Map();
    }

    get(key) {
        return this.state[key];
    }

    set(key, value) {
        const oldValue = this.state[key];
        this.state[key] = value;
        this.notifyListeners(key, value, oldValue);
    }

    update(updates) {
        Object.entries(updates).forEach(([key, value]) => {
            this.set(key, value);
        });
    }

    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);

        // Return unsubscribe function
        return () => {
            this.listeners.get(key).delete(callback);
        };
    }

    notifyListeners(key, newValue, oldValue) {
        if (this.listeners.has(key)) {
            this.listeners.get(key).forEach(callback => {
                callback(newValue, oldValue);
            });
        }
    }

    reset() {
        this.state = createInitialState();
    }
}
