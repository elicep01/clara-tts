// Clara - Drag and Drop Module
// Handles drag and drop for documents and folders

export class DragDropManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
    }

    setup() {
        document.addEventListener('dragstart', (e) => {
            const docCard = e.target.closest('.document-card[data-doc-id]');
            if (docCard) {
                this.state.draggedItem = docCard.dataset.docId;
                this.state.draggedItemType = 'document';
                docCard.classList.add('dragging');

                const doc = this.state.documents.find(d => d.id === docCard.dataset.docId);
                document.getElementById('drag-indicator-text').textContent = doc?.name || 'Document';
                return;
            }

            const folderCard = e.target.closest('.document-card[data-folder-id]');
            if (folderCard) {
                this.state.draggedItem = folderCard.dataset.folderId;
                this.state.draggedItemType = 'folder';
                folderCard.classList.add('dragging');

                const folder = this.state.folders.find(f => f.id === folderCard.dataset.folderId);
                document.getElementById('drag-indicator-text').textContent = folder?.name || 'Folder';
            }
        });

        document.addEventListener('dragend', (e) => {
            const card = e.target.closest('.document-card');
            if (card) card.classList.remove('dragging');
            this.state.draggedItem = null;
            this.state.draggedItemType = null;

            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            document.getElementById('drag-indicator').classList.add('hidden');
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            const indicator = document.getElementById('drag-indicator');
            if (this.state.draggedItem) {
                indicator.classList.remove('hidden');
                indicator.style.left = `${e.clientX + 10}px`;
                indicator.style.top = `${e.clientY + 10}px`;
            }
        });

        document.addEventListener('dragenter', (e) => {
            const target = e.target.closest('[data-drop-target="true"]');
            if (target && this.state.draggedItem) {
                target.classList.add('drag-over');
            }
        });

        document.addEventListener('dragleave', (e) => {
            const target = e.target.closest('[data-drop-target="true"]');
            if (target) target.classList.remove('drag-over');
        });

        document.addEventListener('drop', async (e) => {
            e.preventDefault();
            const target = e.target.closest('[data-drop-target="true"]');

            if (target && this.state.draggedItem) {
                if (target.dataset.trashTarget === 'true') {
                    if (this.state.draggedItemType === 'document') {
                        await this.clara.library.moveDocumentToTrash(this.state.draggedItem);
                    } else if (this.state.draggedItemType === 'folder') {
                        await this.clara.library.moveFolderToTrash(this.state.draggedItem);
                    }
                    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                    return;
                }

                let targetFolderId = null;

                if (target.dataset.folderId !== undefined) {
                    targetFolderId = target.dataset.folderId || null;
                } else if (target.id === 'document-area') {
                    targetFolderId = this.state.currentFolderId;
                }

                // Don't drop folder into itself
                if (this.state.draggedItemType === 'folder' && this.state.draggedItem === targetFolderId) {
                    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                    return;
                }

                if (this.state.draggedItemType === 'document') {
                    await this.clara.library.moveDocument(this.state.draggedItem, targetFolderId);
                } else if (this.state.draggedItemType === 'folder') {
                    await this.clara.library.moveFolder(this.state.draggedItem, targetFolderId);
                }
            }

            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
    }
}
