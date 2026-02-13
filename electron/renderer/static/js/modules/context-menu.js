// Clara - Context Menu Module
// Handles library and PDF context menus

export class ContextMenuManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.pdfContextData = null;
        this.longPressDelayMs = 480;
        this.activeLongPress = null;
    }

    setup() {
        document.addEventListener('click', () => {
            this.hide();
            this.hidePdf();
        });

        document.querySelectorAll('.context-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleAction(action);
            });
        });

        document.querySelectorAll('.pdf-context-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handlePdfAction(action);
            });
        });
    }

    // Library Context Menu
    show(e, itemId, itemType) {
        e.preventDefault();
        e.stopPropagation();

        this.state.selectedItem = itemId;
        this.state.selectedItemType = itemType;

        const menu = document.getElementById('context-menu');

        const openBtn = menu.querySelector('[data-action="open"]');
        const renameBtn = menu.querySelector('[data-action="rename"]');
        const moveBtn = menu.querySelector('[data-action="move"]');

        const isTrashView = this.state.viewingTrash;
        openBtn.style.display = itemType === 'document' && !isTrashView ? 'flex' : 'none';
        renameBtn.style.display = isTrashView ? 'none' : 'flex';
        moveBtn.style.display = isTrashView ? 'none' : 'flex';

        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.classList.remove('hidden');
    }

    hide() {
        document.getElementById('context-menu').classList.add('hidden');
    }

    async handleAction(action) {
        const { selectedItem, selectedItemType } = this.state;

        this.hide();

        switch (action) {
            case 'open':
                if (selectedItemType === 'document') {
                    this.clara.viewer.open(selectedItem);
                }
                break;

            case 'rename':
                if (selectedItemType === 'folder') {
                    const folder = this.state.folders.find(f => f.id === selectedItem);
                    if (folder) {
                        this.clara.modals.showFolder(selectedItem, folder.name);
                    }
                } else if (selectedItemType === 'document') {
                    const doc = this.state.documents.find(d => d.id === selectedItem);
                    if (doc) {
                        this.clara.modals.showRenameDoc(selectedItem, doc.name);
                    }
                }
                break;

            case 'delete':
                if (confirm(`Are you sure you want to delete this ${selectedItemType}?`)) {
                    await this.clara.library.deleteItem(selectedItem, selectedItemType);
                }
                break;

            case 'move':
                this.clara.modals.showMove();
                break;
        }
    }

    // PDF Context Menu
    getPdfPageNumFromTarget(target) {
        if (!target || !target.closest) return this.state.viewerCurrentPage;

        const readingWrapper = target.closest('.page-image-wrapper.reading-mode');
        if (readingWrapper && readingWrapper.dataset.readingPage !== undefined) {
            const n = parseInt(readingWrapper.dataset.readingPage, 10);
            if (Number.isFinite(n)) return n;
        }

        const continuousPage = target.closest('.continuous-page');
        if (continuousPage && continuousPage.dataset.pageNum !== undefined) {
            const n = parseInt(continuousPage.dataset.pageNum, 10);
            if (Number.isFinite(n)) return n;
        }

        const overlay = target.closest('.word-highlight-overlay');
        if (overlay && overlay.dataset.pageNum !== undefined) {
            const n = parseInt(overlay.dataset.pageNum, 10);
            if (Number.isFinite(n)) return n;
        }

        return this.state.viewerCurrentPage;
    }

    showPdf(e, wordIndex, selectedText = '') {
        e.preventDefault();
        e.stopPropagation();

        let anchorPoint = null;
        const container = e.target.closest('.page-image-wrapper') || document.querySelector('.page-image-wrapper');
        if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                anchorPoint = {
                    x: ((e.clientX - rect.left) / rect.width) * 100,
                    y: ((e.clientY - rect.top) / rect.height) * 100
                };
            }
        }

        this.pdfContextData = {
            wordIndex: wordIndex,
            selectedText: selectedText,
            pageNum: this.getPdfPageNumFromTarget(e.target),
            anchorPoint
        };

        const menu = document.getElementById('pdf-context-menu');

        const readFromHere = menu.querySelector('[data-action="read-from-here"]');
        const addNote = menu.querySelector('[data-action="add-note"]');
        const addSentenceNote = menu.querySelector('[data-action="add-sentence-note"]');
        const addParagraphNote = menu.querySelector('[data-action="add-paragraph-note"]');

        const hasWordIndex = wordIndex !== null && wordIndex !== undefined;
        readFromHere.style.display = hasWordIndex ? 'flex' : 'none';
        addNote.style.display = 'flex';
        addSentenceNote.style.display = hasWordIndex ? 'flex' : 'none';
        addParagraphNote.style.display = hasWordIndex ? 'flex' : 'none';

        let left = e.clientX;
        let top = e.clientY;

        const menuWidth = 180;
        const menuHeight = hasWordIndex ? 200 : 100;
        if (left + menuWidth > window.innerWidth) {
            left = window.innerWidth - menuWidth - 10;
        }
        if (top + menuHeight > window.innerHeight) {
            top = window.innerHeight - menuHeight - 10;
        }

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.classList.remove('hidden');
    }

    hidePdf() {
        document.getElementById('pdf-context-menu').classList.add('hidden');
    }

    async handlePdfAction(action) {
        const { wordIndex, selectedText, anchorPoint, pageNum } = this.pdfContextData || {};

        this.hidePdf();

        switch (action) {
            case 'read-from-here':
                await this.clara.reading.readFromWord(wordIndex, pageNum);
                break;

            case 'add-note':
                this.clara.notes.addFromSelection(wordIndex, selectedText, anchorPoint, pageNum, { mode: 'selection' });
                break;

            case 'add-sentence-note':
                this.clara.notes.addFromSelection(wordIndex, selectedText, anchorPoint, pageNum, { mode: 'sentence' });
                break;

            case 'add-paragraph-note':
                this.clara.notes.addFromSelection(wordIndex, selectedText, anchorPoint, pageNum, { mode: 'paragraph' });
                break;
        }
    }

    attachPdfLongPress(targetEl, getPayload) {
        if (!targetEl || typeof getPayload !== 'function') return;

        const clearActiveLongPress = () => {
            if (!this.activeLongPress) return;
            clearTimeout(this.activeLongPress.timer);
            this.activeLongPress = null;
        };

        targetEl.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            clearActiveLongPress();

            const touch = e.touches[0];
            const startX = touch.clientX;
            const startY = touch.clientY;

            const timer = window.setTimeout(() => {
                const payload = getPayload() || {};
                const pseudoEvent = {
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    target: payload.target || e.target,
                    clientX: startX,
                    clientY: startY
                };
                this.showPdf(
                    pseudoEvent,
                    payload.wordIndex ?? null,
                    payload.selectedText ?? ''
                );
                this.activeLongPress = null;
            }, this.longPressDelayMs);

            this.activeLongPress = {
                timer,
                startX,
                startY
            };
        }, { passive: true });

        targetEl.addEventListener('touchmove', (e) => {
            if (!this.activeLongPress || !e.touches || e.touches.length !== 1) return;
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - this.activeLongPress.startX);
            const dy = Math.abs(touch.clientY - this.activeLongPress.startY);
            if (dx > 12 || dy > 12) {
                clearActiveLongPress();
            }
        }, { passive: true });

        targetEl.addEventListener('touchend', clearActiveLongPress, { passive: true });
        targetEl.addEventListener('touchcancel', clearActiveLongPress, { passive: true });
    }
}
