// Clara - Document Reader with Word-by-Word Highlighting
// Main Application Entry Point

import { createInitialState } from './modules/state.js';
import { NavigationManager } from './modules/navigation.js';
import { LibraryManager } from './modules/library.js';
import { ViewerManager } from './modules/viewer.js';
import { ReadingManager } from './modules/reading.js';
import { NotesManager } from './modules/notes.js';
import { ModalsManager } from './modules/modals.js';
import { ContextMenuManager } from './modules/context-menu.js';
import { DragDropManager } from './modules/drag-drop.js';
import { UIHelpers } from './modules/ui-helpers.js';
import { DictionaryManager } from './modules/dictionary.js';
import { VoiceSelectorManager } from './modules/voice-selector.js';
import { SettingsManager } from './modules/settings.js';
import { TOCManager } from './modules/toc.js';

class Clara {
    constructor() {
        // Initialize state
        this.state = createInitialState();

        // Initialize all managers
        this.ui = new UIHelpers(this);
        this.navigation = new NavigationManager(this);
        this.library = new LibraryManager(this);
        this.viewer = new ViewerManager(this);
        this.reading = new ReadingManager(this);
        this.notes = new NotesManager(this);
        this.modals = new ModalsManager(this);
        this.contextMenu = new ContextMenuManager(this);
        this.dragDrop = new DragDropManager(this);
        this.dictionary = new DictionaryManager(this);
        this.voiceSelector = new VoiceSelectorManager(this);
        this.settings = new SettingsManager(this);
        this.toc = new TOCManager(this);

        this.init();
    }

    async init() {
        // Setup all modules
        this.navigation.setup();
        this.library.setup();
        this.viewer.setup();
        this.viewer.setupZoom();
        this.reading.setup();
        this.notes.setup();
        this.modals.setup();
        this.contextMenu.setup();
        this.dragDrop.setup();
        this.voiceSelector.setup();
        this.settings.setup();
        this.toc.setup();

        // Load saved voice preference
        await this.loadSavedVoice();

        // Load library on startup
        await this.library.load();
        this.navigation.updateTitle();
    }

    async loadSavedVoice() {
        try {
            const res = await fetch('/tts/voice');
            const data = await res.json();
            if (data.voice_id) {
                this.state.selectedVoice = data.voice_id;
                this.voiceSelector.currentVoiceId = data.voice_id;
            }
        } catch (err) {
            console.log('Could not load saved voice:', err);
        }
    }
}

// Initialize when ready
document.addEventListener('DOMContentLoaded', () => {
    window.clara = new Clara();
});