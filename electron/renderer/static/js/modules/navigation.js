// Clara - Navigation Module
// Handles view switching, back/forward navigation, and title updates

export class NavigationManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
    }

    setup() {
        document.getElementById('btn-home').addEventListener('click', () => this.goHome());
        document.getElementById('btn-back').addEventListener('click', () => this.goBack());

        // Q&A toggle
        const qaToggle = document.getElementById('btn-toggle-qa');
        if (qaToggle) {
            qaToggle.addEventListener('click', () => this.toggleQA());
        }
    }

    toggleQA() {
        const questionSection = document.getElementById('question-section');
        if (questionSection) {
            questionSection.classList.toggle('hidden');

            // Focus on input when showing
            if (!questionSection.classList.contains('hidden')) {
                const questionInput = document.getElementById('question-input');
                if (questionInput) {
                    setTimeout(() => questionInput.focus(), 100);
                }
            }
        }
    }

    switchView(viewName) {
        if (this.state.currentView !== viewName) {
            this.state.viewHistory.push(this.state.currentView);
        }

        this.state.currentView = viewName;

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`${viewName}-view`).classList.add('active');

        // Show/hide zoom controls, Q&A button, and notes toggle
        const zoomControls = document.getElementById('zoom-controls');
        const qaToggle = document.getElementById('btn-toggle-qa');
        const notesToggle = document.getElementById('btn-toggle-notes');
        const questionSection = document.getElementById('question-section');
        if (viewName === 'viewer') {
            zoomControls.classList.remove('hidden');
            if (qaToggle) qaToggle.classList.remove('hidden');
            notesToggle.classList.remove('hidden');
        } else {
            zoomControls.classList.add('hidden');
            if (qaToggle) qaToggle.classList.add('hidden');
            notesToggle.classList.add('hidden');
            this.clara.notes.hideSidebar();
            // Hide Q&A section when leaving viewer
            if (questionSection) questionSection.classList.add('hidden');
        }

        this.updateTitle();
    }

    goBack() {
        // If in reading mode, stop reading first
        if (this.state.isReadingMode) {
            this.clara.reading.stop();
            return;
        }

        if (this.state.viewHistory.length > 0) {
            const previousView = this.state.viewHistory.pop();
            this.state.currentView = previousView;

            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(`${previousView}-view`).classList.add('active');

            // Show/hide zoom controls
            const zoomControls = document.getElementById('zoom-controls');
            if (previousView === 'viewer') {
                zoomControls.classList.remove('hidden');
            } else {
                zoomControls.classList.add('hidden');
            }

            // Reload library when going back to it
            if (previousView === 'library') {
                this.clara.library.load();
            }

            this.updateTitle();
        } else {
            // No history, go home
            this.goHome();
        }
    }

    goHome() {
        // If in reading mode, stop reading first
        if (this.state.isReadingMode) {
            this.clara.reading.stop();
        }

        this.state.viewHistory = [];
        this.state.currentView = 'library';
        this.state.currentFolderId = null;

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('library-view').classList.add('active');
        document.getElementById('zoom-controls').classList.add('hidden');

        this.clara.library.load();
        this.updateTitle();
    }

    updateTitle() {
        const titleEl = document.getElementById('nav-title');

        switch (this.state.currentView) {
            case 'library':
                titleEl.textContent = 'Clara';
                break;
            case 'viewer':
                if (this.state.isReadingMode) {
                    titleEl.textContent = `Reading - Page ${this.state.viewerCurrentPage + 1}`;
                } else {
                    titleEl.textContent = this.state.viewerDocName || 'Document';
                }
                break;
            default:
                titleEl.textContent = 'Clara';
        }
    }
}