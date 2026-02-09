// Clara - Notes Management Module
// Handles notes creation, editing, positioning, and rendering

export class NotesManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.pendingNewNoteDraft = null;
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
                    <span class="note-anchor-kind">${this.formatAnchorType(note.anchor_type)}</span>
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

    formatAnchorType(anchorType) {
        const type = String(anchorType || '').toLowerCase();
        if (type.includes('figure') || type.includes('image')) return 'Figure';
        if (type.includes('word')) return 'Word';
        if (type.includes('sentence')) return 'Sentence';
        if (type.includes('paragraph')) return 'Paragraph';
        if (type.includes('ai')) return 'AI';
        if (type.includes('manual')) return 'Note';
        return 'Selection';
    }

    detectAnchorTypeFromText(text) {
        const value = String(text || '').trim();
        if (!value) return 'manual';

        const wordCount = value.split(/\s+/).filter(Boolean).length;
        const hasLineBreak = /\n/.test(value);
        const hasSentencePunctuation = /[.!?]["')\]]?$/.test(value);

        if (wordCount <= 1) return 'word';
        if (hasLineBreak || wordCount > 40 || value.length > 220) return 'paragraph';
        if (hasSentencePunctuation && wordCount >= 4) return 'sentence';
        return 'selection';
    }

    clampPercent(value) {
        return Math.max(0, Math.min(100, value));
    }

    getActivePageContainer() {
        const pageNum = this.state.viewerCurrentPage;
        const continuousPage = document.getElementById(`page-${pageNum}`);
        if (continuousPage) {
            return continuousPage.querySelector('.page-image-wrapper') || continuousPage;
        }
        return document.querySelector('.page-image-wrapper') || document.getElementById('page-content');
    }

    getClosestWordIndexAtPosition(x, y) {
        if (!this.state.words || this.state.words.length === 0) return -1;

        let closestIndex = -1;
        let closestDistance = Infinity;
        for (let i = 0; i < this.state.words.length; i++) {
            const word = this.state.words[i];
            if (word.x === undefined || word.y === undefined || word.w === undefined || word.h === undefined) {
                continue;
            }

            if (x >= word.x && x <= word.x + word.w && y >= word.y && y <= word.y + word.h) {
                return i;
            }

            const centerX = word.x + word.w / 2;
            const centerY = word.y + word.h / 2;
            const distance = Math.hypot(x - centerX, y - centerY);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }

        return closestDistance < 12 ? closestIndex : -1;
    }

    getAnchorFromSelection(wordIndex, selectedText = '', anchorPoint = null) {
        const text = String(selectedText || '').trim();
        const anchor = {
            anchor_text: text,
            anchor_type: this.detectAnchorTypeFromText(text),
            anchor_x: null,
            anchor_y: null
        };

        if (anchorPoint && Number.isFinite(anchorPoint.x) && Number.isFinite(anchorPoint.y)) {
            anchor.anchor_x = this.clampPercent(anchorPoint.x);
            anchor.anchor_y = this.clampPercent(anchorPoint.y);
            if (!anchor.anchor_text) {
                anchor.anchor_type = 'figure';
            }
        }

        const container = this.getActivePageContainer();
        const selection = window.getSelection();
        if (container && selection && selection.rangeCount > 0 && text.length > 0) {
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (containerRect.width > 0 && containerRect.height > 0 && rect.width > 0 && rect.height > 0) {
                anchor.anchor_x = this.clampPercent(((rect.left + rect.width / 2 - containerRect.left) / containerRect.width) * 100);
                anchor.anchor_y = this.clampPercent(((rect.top + rect.height / 2 - containerRect.top) / containerRect.height) * 100);
            }
        }

        if ((anchor.anchor_x === null || anchor.anchor_y === null) && Number.isInteger(wordIndex) && this.state.words[wordIndex]) {
            const word = this.state.words[wordIndex];
            if (word.x !== undefined && word.y !== undefined) {
                anchor.anchor_x = this.clampPercent(word.x + (word.w || 0) / 2);
                anchor.anchor_y = this.clampPercent(word.y + (word.h || 0) / 2);
                anchor.anchor_text = anchor.anchor_text || word.text || '';
                anchor.anchor_type = anchor.anchor_text ? this.detectAnchorTypeFromText(anchor.anchor_text) : 'word';
            }
        }

        if (anchor.anchor_x === null || anchor.anchor_y === null) {
            anchor.anchor_x = 50;
            anchor.anchor_y = 30;
        }

        if (!anchor.anchor_text) {
            anchor.anchor_type = 'manual';
        }

        return anchor;
    }

    renderMarkers() {
        document.querySelectorAll('.note-marker').forEach(m => m.remove());
        this.renderAnchoredHighlights();

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
                    <span class="note-marker-tag">${this.formatAnchorType(note.anchor_type)}</span>
                `;

                marker.addEventListener('click', (e) => {
                    if (!this.state.draggingNote) {
                        e.stopPropagation();
                        this.openModal(note);
                    }
                });

                marker.addEventListener('dblclick', async (e) => {
                    if (this.state.draggingNote) return;
                    e.stopPropagation();
                    if (!this.state.isReadingMode) return;
                    const wordIndex = this.getClosestWordIndexAtPosition(note.anchor_x, note.anchor_y);
                    if (wordIndex >= 0) {
                        await this.clara.reading.readFromWord(wordIndex);
                    }
                });

                this.setupMarkerDrag(marker, note, container);

                container.appendChild(marker);
            }
        });
    }

    renderAnchoredHighlights() {
        const boxes = document.querySelectorAll('.word-box');
        boxes.forEach(box => box.classList.remove('note-anchored'));

        if (!this.state.words || this.state.words.length === 0) return;
        if (!this.state.notes || this.state.notes.length === 0) return;

        const pageNotes = this.state.notes.filter(
            n => n.page_num === this.state.viewerCurrentPage && n.anchor_text
        );
        if (pageNotes.length === 0) return;

        const anchoredWords = new Set(
            pageNotes
                .flatMap(note => String(note.anchor_text).split(/\s+/))
                .map(w => w.trim().toLowerCase().replace(/[^\w'-]/g, ''))
                .filter(Boolean)
        );
        if (anchoredWords.size === 0) return;

        this.state.words.forEach((word, idx) => {
            const normalized = String(word?.text || '').toLowerCase().replace(/[^\w'-]/g, '');
            if (!normalized || !anchoredWords.has(normalized)) return;
            if (this.clara.reading.wordBoxes[idx]) {
                this.clara.reading.wordBoxes[idx].classList.add('note-anchored');
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

    openModal(note, draft = null) {
        this.state.currentNote = note;
        this.pendingNewNoteDraft = note ? null : (draft || this.pendingNewNoteDraft);

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
            const pending = this.pendingNewNoteDraft || {};
            contentInput.value = pending.content || '';
            pageNum.textContent = this.state.viewerCurrentPage + 1;
            questionDiv.classList.add('hidden');
            if (pending.anchor_text) {
                anchorDiv.classList.remove('hidden');
                anchorText.textContent = pending.anchor_text;
            } else if (pending.anchor_type === 'figure') {
                anchorDiv.classList.remove('hidden');
                anchorText.textContent = 'Figure/Image area';
            } else {
                anchorDiv.classList.add('hidden');
            }

            document.querySelectorAll('.color-dot').forEach(dot => {
                dot.classList.remove('active');
                if (dot.dataset.color === (pending.color || '#FFE066')) {
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
        this.pendingNewNoteDraft = null;
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
        } else {
            try {
                const pending = this.pendingNewNoteDraft || {};
                const anchorData = {
                    anchor_type: pending.anchor_type || 'manual',
                    anchor_text: pending.anchor_text || null,
                    anchor_x: pending.anchor_x,
                    anchor_y: pending.anchor_y
                };
                const res = await fetch(`/document/${this.state.viewerDocId}/notes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content,
                        page_num: this.state.viewerCurrentPage,
                        anchor_type: anchorData.anchor_type || 'manual',
                        anchor_text: anchorData.anchor_text,
                        anchor_x: anchorData.anchor_x,
                        anchor_y: anchorData.anchor_y,
                        color
                    })
                });

                const data = await res.json();
                if (data.error) {
                    this.clara.ui.showToast(data.error, true);
                    return;
                }

                this.state.notes.push(data);
                this.renderList();
                this.updateBadge();
                this.renderMarkers();
                this.hideModal();
                this.clara.ui.showToast('Note saved');
            } catch (err) {
                this.clara.ui.showToast('Failed to save note: ' + err.message, true);
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

    async focusNoteMarker(noteId) {
        for (let attempt = 0; attempt < 8; attempt++) {
            this.renderMarkers();
            const marker = document.querySelector(`.note-marker[data-note-id="${noteId}"]`);
            if (marker) {
                marker.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                marker.classList.add('focus-pulse');
                setTimeout(() => marker.classList.remove('focus-pulse'), 1200);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 120));
        }
        return false;
    }

    scrollToNoteAnchor(note) {
        const docDisplay = document.getElementById('document-display');
        const page = document.getElementById(`page-${note.page_num}`);
        if (!docDisplay || !page) return;

        const pageBody = page.querySelector('.page-image-wrapper') || page;
        const pageHeight = pageBody.clientHeight || page.clientHeight;
        const anchorY = Number.isFinite(note.anchor_y) ? note.anchor_y : 50;
        const offsetWithinPage = (anchorY / 100) * pageHeight;
        const targetTop = page.offsetTop + offsetWithinPage - (docDisplay.clientHeight * 0.35);
        docDisplay.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }

    async goToNotePage(note) {
        if (!note || note.page_num === null || note.page_num === undefined) return;

        const pageNum = note.page_num;
        this.clara.viewer.goToPage(pageNum);

        const found = await this.focusNoteMarker(note.id);
        if (!found) {
            this.scrollToNoteAnchor(note);
            await this.focusNoteMarker(note.id);
        }

        this.clara.ui.showToast(`Navigated to note on page ${pageNum + 1}`);
    }

    async createWithText(initialText, anchor = null) {
        const anchorData = anchor || this.getAnchorFromSelection(null, initialText);
        const initialContent = initialText ? `"${initialText}"\n\n` : '';

        this.openModal(null, {
            content: initialContent,
            color: '#FFE066',
            anchor_type: anchorData.anchor_type || 'selection',
            anchor_text: anchorData.anchor_text || initialText || null,
            anchor_x: anchorData.anchor_x,
            anchor_y: anchorData.anchor_y
        });
    }

    addFromSelection(wordIndex, selectedText, anchorPoint = null) {
        let noteText = selectedText;

        if (!noteText && wordIndex !== null && this.state.words[wordIndex]) {
            noteText = this.state.words[wordIndex].text;
        }

        const anchorData = this.getAnchorFromSelection(wordIndex, noteText, anchorPoint);
        if (!noteText && anchorData.anchor_type !== 'figure') {
            this.clara.ui.showToast('No text selected for note', true);
            return;
        }

        this.showSidebar();
        this.createWithText(noteText, anchorData);
    }
}
