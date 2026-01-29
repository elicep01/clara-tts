// Clara - Modal Dialogs Module
// Handles upload, folder, move, and rename modals

export class ModalsManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
    }

    setup() {
        // Upload modal
        document.getElementById('btn-close-upload').addEventListener('click', () => this.hideUpload());
        document.querySelector('#upload-modal .modal-backdrop').addEventListener('click', () => this.hideUpload());

        // Folder modal
        document.getElementById('btn-cancel-folder').addEventListener('click', () => this.hideFolder());
        document.getElementById('btn-save-folder').addEventListener('click', () => this.saveFolder());
        document.querySelector('#folder-modal .modal-backdrop').addEventListener('click', () => this.hideFolder());
        document.getElementById('folder-name-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.saveFolder();
        });

        // Move modal
        document.getElementById('btn-cancel-move').addEventListener('click', () => this.hideMove());
        document.querySelector('#move-modal .modal-backdrop').addEventListener('click', () => this.hideMove());

        // Rename document modal
        document.getElementById('btn-cancel-rename-doc').addEventListener('click', () => this.hideRenameDoc());
        document.getElementById('btn-save-rename-doc').addEventListener('click', () => this.saveDocName());
        document.querySelector('#rename-doc-modal .modal-backdrop').addEventListener('click', () => this.hideRenameDoc());
        document.getElementById('doc-name-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.saveDocName();
        });
    }

    // Upload Modal
    showUpload() {
        document.getElementById('upload-modal').classList.remove('hidden');
    }

    hideUpload() {
        document.getElementById('upload-modal').classList.add('hidden');
    }

    // Folder Modal
    showFolder(folderId = null, name = '') {
        this.state.editingFolderId = folderId;
        const modal = document.getElementById('folder-modal');
        const title = document.getElementById('folder-modal-title');
        const input = document.getElementById('folder-name-input');
        const saveBtn = document.getElementById('btn-save-folder');

        if (folderId) {
            title.textContent = 'Rename Folder';
            saveBtn.textContent = 'Save';
            input.value = name;
        } else {
            title.textContent = 'New Folder';
            saveBtn.textContent = 'Create';
            input.value = '';
        }

        modal.classList.remove('hidden');
        input.focus();
    }

    hideFolder() {
        document.getElementById('folder-modal').classList.add('hidden');
        this.state.editingFolderId = null;
    }

    async saveFolder() {
        const input = document.getElementById('folder-name-input');
        const name = input.value.trim();

        if (!name) {
            this.clara.ui.showToast('Please enter a folder name', true);
            return;
        }

        try {
            if (this.state.editingFolderId) {
                await fetch(`/library/folder/${this.state.editingFolderId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
            } else {
                await fetch('/library/folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        parent_id: this.state.currentFolderId
                    })
                });
            }

            this.hideFolder();
            await this.clara.library.load();

        } catch (err) {
            this.clara.ui.showToast('Failed to save folder: ' + err.message, true);
        }
    }

    // Rename Document Modal
    showRenameDoc(docId, currentName) {
        this.state.editingDocId = docId;
        const modal = document.getElementById('rename-doc-modal');
        const input = document.getElementById('doc-name-input');
        input.value = currentName;
        modal.classList.remove('hidden');
        input.focus();
        input.select();
    }

    hideRenameDoc() {
        document.getElementById('rename-doc-modal').classList.add('hidden');
        this.state.editingDocId = null;
    }

    async saveDocName() {
        const input = document.getElementById('doc-name-input');
        const name = input.value.trim();

        if (!name) {
            this.clara.ui.showToast('Please enter a document name', true);
            return;
        }

        try {
            await fetch(`/library/document/${this.state.editingDocId}/rename`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });

            this.hideRenameDoc();
            await this.clara.library.load();
            this.clara.ui.showToast('Document renamed');

        } catch (err) {
            this.clara.ui.showToast('Failed to rename document: ' + err.message, true);
        }
    }

    // Move Modal
    showMove() {
        const list = document.getElementById('folder-select-list');
        list.innerHTML = '';

        const rootItem = document.createElement('div');
        rootItem.className = 'folder-select-item root';
        rootItem.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            </svg>
            <span>Root (No folder)</span>
        `;
        rootItem.addEventListener('click', () => this.moveToFolder(null));
        list.appendChild(rootItem);

        const renderFolders = (parentId, depth) => {
            const folders = this.state.folders.filter(f => f.parent_id === parentId);
            folders.forEach(folder => {
                const item = document.createElement('div');
                item.className = 'folder-select-item';
                item.innerHTML = `
                    ${'<span class="indent"></span>'.repeat(depth)}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>${folder.name}</span>
                `;
                item.addEventListener('click', () => this.moveToFolder(folder.id));
                list.appendChild(item);

                renderFolders(folder.id, depth + 1);
            });
        };

        renderFolders(null, 0);

        document.getElementById('move-modal').classList.remove('hidden');
    }

    hideMove() {
        document.getElementById('move-modal').classList.add('hidden');
    }

    async moveToFolder(folderId) {
        if (this.state.selectedItemType === 'document') {
            await this.clara.library.moveDocument(this.state.selectedItem, folderId);
        } else if (this.state.selectedItemType === 'folder') {
            await this.clara.library.moveFolder(this.state.selectedItem, folderId);
        }
        this.hideMove();
    }
}