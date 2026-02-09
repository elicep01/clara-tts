// Clara - Context Menu Module
// Handles library and PDF context menus

export class ContextMenuManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.pdfContextData = null;
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
            pageNum: this.state.viewerCurrentPage,
            anchorPoint
        };

        const menu = document.getElementById('pdf-context-menu');

        const readFromHere = menu.querySelector('[data-action="read-from-here"]');
        const addNote = menu.querySelector('[data-action="add-note"]');

        const hasWordIndex = wordIndex !== null && wordIndex !== undefined;
        readFromHere.style.display = hasWordIndex ? 'flex' : 'none';
        addNote.style.display = 'flex';

        let left = e.clientX;
        let top = e.clientY;

        const menuWidth = 180;
        const menuHeight = 100;
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
                this.clara.notes.addFromSelection(wordIndex, selectedText, anchorPoint);
                break;
        }
    }
}
