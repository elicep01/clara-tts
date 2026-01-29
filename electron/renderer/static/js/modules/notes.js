// Clara - Notes Management Module
// Handles notes creation, editing, positioning, and rendering

export class NotesManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
    }

    setup() {
        document.getElementById('btn-toggle-notes').addEventListener('click', () => {
            this.toggleSidebar();
        });

        document.getElementById('btn-close-notes').addEventListener('click', () => {
            this.hideSidebar();
        });

        document.getElementById('btn-save-as-note').addEventListener('click', () => {
            this.saveAnswerAsNote();
        });

        document.getElementById('btn-cancel-note').addEventListener('click', () => {
            this.hideModal();
        });

        document.getElementById('btn-save-note').addEventListener('click', () => {
            this.save();
        });

        document.getElementById('btn-delete-note').addEventListener('click', () => {
            this.deleteCurrent();
        });

        document.querySelector('#note-modal .modal-backdrop').addEventListener('click', () => {
            this.hideModal();
        });

        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
            });
        });
    }

    toggleSidebar() {
        const sidebar = document.getElementById('notes-sidebar');
        if (sidebar.classList.contains('hidden')) {
            this.showSidebar();
        } else {
            this.hideSidebar();
        }
    }

    async showSidebar() {
        const sidebar = document.getElementById('notes-sidebar');
        sidebar.classList.remove('hidden');
        await this.load();
    }

    hideSidebar() {
        document.getElementById('notes-sidebar').classList.add('hidden');
    }

    async load() {
        if (!this.state.viewerDocId) return;

        try {
            const res = await fetch(`/document/${this.state.viewerDocId}/notes`);
            const data = await res.json();

            this.state.notes = data.notes || [];
            this.renderList();
            this.updateBadge();
            this.renderMarkers();
        } catch (err) {
            console.error('Failed to load notes:', err);
        }
    }

    renderList() {
        const list = document.getElementById('notes-list');
        const empty = document.getElementById('notes-empty');

        list.innerHTML = '';

        if (this.state.notes.length === 0) {
            list.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }

        list.classList.remove('hidden');
        empty.classList.add('hidden');

        this.state.notes.forEach(note => {
            const card = document.createElement('div');
            card.className = 'note-card';
            card.dataset.noteId = note.id;

            const colorClass = this.getColorClass(note.color);
            if (colorClass) card.classList.add(colorClass);

            card.innerHTML = `
                <div class="note-card-content">${this.clara.ui.escapeHtml(note.content)}</div>
                ${note.question ? `<div class="note-card-answer">${this.clara.ui.escapeHtml(note.question)}</div>` : ''}
                <div class="note-card-meta">
                    <span>Page ${note.page_num + 1}</span>
                    <button class="note-card-goto-btn" title="Go to Note Location" onclick="event.stopPropagation();">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                    </button>
                </div>
            `;

            card.addEventListener('click', () => {
                this.openModal(note);
            });

            const gotoBtn = card.querySelector('.note-card-goto-btn');
            gotoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToNotePage(note);
            });

            list.appendChild(card);
        });
    }

    getColorClass(color) {
        const colorMap = {
            '#A8E6CF': 'color-green',
            '#88D8F5': 'color-blue',
            '#FFB3BA': 'color-pink',
            '#DDA0DD': 'color-purple'
        };
        return colorMap[color] || '';
    }

    updateBadge() {
        const badge = document.getElementById('notes-badge');
        const count = this.state.notes.length;

        if (count > 0) {
            badge.textContent = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    renderMarkers() {
        document.querySelectorAll('.note-marker').forEach(m => m.remove());

        if (!this.state.isPdf) return;

        const pageNotes = this.state.notes.filter(
            n => n.page_num === this.state.viewerCurrentPage
        );

        if (pageNotes.length === 0) return;

        let container = document.querySelector('.page-image-wrapper');
        if (!container) {
            container = document.getElementById('page-content');
        }

        if (!container) return;

        pageNotes.forEach(note => {
            if (note.anchor_x !== null && note.anchor_y !== null) {
                const marker = document.createElement('div');
                marker.className = 'note-marker';
                marker.dataset.noteId = note.id;

                const colorClass = this.getColorClass(note.color);
                if (colorClass) marker.classList.add(colorClass);

                marker.style.left = `${note.anchor_x}%`;
                marker.style.top = `${note.anchor_y}%`;

                marker.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                `;

                marker.addEventListener('click', (e) => {
                    if (!this.state.draggingNote) {
                        e.stopPropagation();
                        this.openModal(note);
                    }
                });

                this.setupMarkerDrag(marker, note, container);

                container.appendChild(marker);
            }
        });
    }

    setupMarkerDrag(marker, note, container) {
        let isDragging = false;
        let startX, startY;

        const onMouseDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            this.state.draggingNote = note.id;
            startX = e.clientX;
            startY = e.clientY;
            marker.classList.add('dragging');

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;

            const containerRect = container.getBoundingClientRect();

            let newX = ((e.clientX - containerRect.left) / containerRect.width) * 100;
            let newY = ((e.clientY - containerRect.top) / containerRect.height) * 100;

            newX = Math.max(0, Math.min(100, newX));
            newY = Math.max(0, Math.min(100, newY));

            marker.style.left = `${newX}%`;
            marker.style.top = `${newY}%`;
        };

        const onMouseUp = async (e) => {
            if (!isDragging) return;

            isDragging = false;
            this.state.draggingNote = null;
            marker.classList.remove('dragging');

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const containerRect = container.getBoundingClientRect();
            let newX = ((e.clientX - containerRect.left) / containerRect.width) * 100;
            let newY = ((e.clientY - containerRect.top) / containerRect.height) * 100;

            newX = Math.max(0, Math.min(100, newX));
            newY = Math.max(0, Math.min(100, newY));

            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);

            if (dx > 5 || dy > 5) {
                const anchorText = this.findWordAtPosition(newX, newY);
                await this.updatePosition(note.id, newX, newY, anchorText);
            }
        };

        marker.addEventListener('mousedown', onMouseDown);
    }

    findWordAtPosition(x, y) {
        if (!this.state.words || this.state.words.length === 0) return '';

        let closestWord = null;
        let closestDistance = Infinity;

        for (const word of this.state.words) {
            if (word.x === undefined || word.y === undefined) continue;

            if (x >= word.x && x <= word.x + word.w &&
                y >= word.y && y <= word.y + word.h) {
                return word.text;
            }

            const centerX = word.x + word.w / 2;
            const centerY = word.y + word.h / 2;
            const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestWord = word;
            }
        }

        if (closestWord && closestDistance < 10) {
            return closestWord.text;
        }

        return '';
    }

    async updatePosition(noteId, x, y, anchorText) {
        try {
            await fetch(`/notes/${noteId}/position`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    anchor_x: x,
                    anchor_y: y,
                    anchor_text: anchorText
                })
            });

            const noteIndex = this.state.notes.findIndex(n => n.id === noteId);
            if (noteIndex >= 0) {
                this.state.notes[noteIndex].anchor_x = x;
                this.state.notes[noteIndex].anchor_y = y;
                this.state.notes[noteIndex].anchor_text = anchorText;
            }

            if (anchorText) {
                this.clara.ui.showToast(`Note attached to "${anchorText}"`);
            } else {
                this.clara.ui.showToast('Note repositioned');
            }

        } catch (err) {
            this.clara.ui.showToast('Failed to update note position', true);
        }
    }

    async saveAnswerAsNote() {
        const answerText = document.getElementById('answer-text').textContent;
        if (!answerText || !this.state.lastQuestion) {
            this.clara.ui.showToast('No question to save', true);
            return;
        }

        let anchorX = null;
        let anchorY = null;

        if (this.state.currentWordIndex > 0 && this.state.words.length > 0) {
            const word = this.state.words[this.state.currentWordIndex];
            if (word && word.x !== undefined && word.y !== undefined) {
                anchorX = word.x;
                anchorY = word.y;
            }
        }

        if (anchorX === null) {
            anchorX = 50;
            anchorY = 30;
        }

        try {
            const res = await fetch(`/document/${this.state.viewerDocId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: this.state.lastQuestion,
                    question: answerText,
                    page_num: this.state.viewerCurrentPage,
                    anchor_type: 'ai_question',
                    anchor_x: anchorX,
                    anchor_y: anchorY,
                    color: '#FFE066'
                })
            });

            const data = await res.json();

            if (data.error) {
                this.clara.ui.showToast(data.error, true);
                return;
            }

            this.state.notes.push(data);

            this.updateBadge();
            this.renderMarkers();

            if (!document.getElementById('notes-sidebar').classList.contains('hidden')) {
                this.renderList();
            }

            document.getElementById('answer-box').classList.add('hidden');

            this.clara.ui.showToast('Note saved');

        } catch (err) {
            this.clara.ui.showToast('Failed to save note: ' + err.message, true);
        }
    }

    openModal(note) {
        this.state.currentNote = note;

        const modal = document.getElementById('note-modal');
        const title = document.getElementById('note-modal-title');
        const questionDiv = document.getElementById('note-question');
        const questionText = document.getElementById('note-question-text');
        const anchorDiv = document.getElementById('note-anchor');
        const anchorText = document.getElementById('note-anchor-text');
        const contentInput = document.getElementById('note-content-input');
        const pageNum = document.getElementById('note-page-num');
        const deleteBtn = document.getElementById('btn-delete-note');

        title.textContent = note ? 'Edit Note' : 'New Note';
        deleteBtn.style.display = note ? 'block' : 'none';

        if (note) {
            contentInput.value = note.content;
            pageNum.textContent = note.page_num + 1;

            if (note.question) {
                questionDiv.classList.remove('hidden');
                questionText.textContent = note.question;
            } else {
                questionDiv.classList.add('hidden');
            }

            if (note.anchor_text) {
                anchorDiv.classList.remove('hidden');
                anchorText.textContent = note.anchor_text;
            } else {
                anchorDiv.classList.add('hidden');
            }

            document.querySelectorAll('.color-dot').forEach(dot => {
                dot.classList.remove('active');
                if (dot.dataset.color === note.color) {
                    dot.classList.add('active');
                }
            });
        } else {
            contentInput.value = '';
            pageNum.textContent = this.state.viewerCurrentPage + 1;
            questionDiv.classList.add('hidden');
            anchorDiv.classList.add('hidden');

            document.querySelectorAll('.color-dot').forEach(dot => {
                dot.classList.remove('active');
                if (dot.dataset.color === '#FFE066') {
                    dot.classList.add('active');
                }
            });
        }

        modal.classList.remove('hidden');
        contentInput.focus();
    }

    hideModal() {
        document.getElementById('note-modal').classList.add('hidden');
        this.state.currentNote = null;
    }

    async save() {
        const content = document.getElementById('note-content-input').value.trim();
        if (!content) {
            this.clara.ui.showToast('Please enter note content', true);
            return;
        }

        const activeColor = document.querySelector('.color-dot.active');
        const color = activeColor ? activeColor.dataset.color : '#FFE066';

        if (this.state.currentNote) {
            try {
                const res = await fetch(`/notes/${this.state.currentNote.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, color })
                });

                const data = await res.json();
                if (data.error) {
                    this.clara.ui.showToast(data.error, true);
                    return;
                }

                const noteIndex = this.state.notes.findIndex(n => n.id === this.state.currentNote.id);
                if (noteIndex >= 0) {
                    this.state.notes[noteIndex].content = content;
                    this.state.notes[noteIndex].color = color;
                }

                this.renderList();
                this.renderMarkers();
                this.hideModal();
                this.clara.ui.showToast('Note updated');

            } catch (err) {
                this.clara.ui.showToast('Failed to update note: ' + err.message, true);
            }
        }
    }

    async deleteCurrent() {
        if (!this.state.currentNote) return;

        if (!confirm('Delete this note?')) return;

        try {
            await fetch(`/notes/${this.state.currentNote.id}`, { method: 'DELETE' });

            this.state.notes = this.state.notes.filter(n => n.id !== this.state.currentNote.id);

            this.renderList();
            this.updateBadge();
            this.renderMarkers();
            this.hideModal();
            this.clara.ui.showToast('Note deleted');

        } catch (err) {
            this.clara.ui.showToast('Failed to delete note: ' + err.message, true);
        }
    }

    goToNotePage(note) {
        if (!note || note.page_num === null || note.page_num === undefined) return;

        const pageNum = note.page_num;
        this.clara.viewer.goToPage(pageNum);
        this.clara.ui.showToast(`Navigated to page ${pageNum + 1}`);
    }

    async createWithText(initialText) {
        try {
            const res = await fetch(`/document/${this.state.viewerDocId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `"${initialText}"\n\n`,
                    page_num: this.state.viewerCurrentPage,
                    anchor_type: 'selection',
                    anchor_text: initialText,
                    anchor_x: 50,
                    anchor_y: 50
                })
            });

            const data = await res.json();
            if (data.error) {
                this.clara.ui.showToast(data.error, true);
                return;
            }

            await this.load();
            if (data.note) {
                this.openModal(data.note);
            }
            this.clara.ui.showToast('Note created');
        } catch (err) {
            this.clara.ui.showToast('Failed to create note', true);
        }
    }

    addFromSelection(wordIndex, selectedText) {
        let noteText = selectedText;

        if (!noteText && wordIndex !== null && this.state.words[wordIndex]) {
            noteText = this.state.words[wordIndex].text;
        }

        if (!noteText) {
            this.clara.ui.showToast('No text selected for note', true);
            return;
        }

        this.showSidebar();
        this.createWithText(noteText);
    }
}