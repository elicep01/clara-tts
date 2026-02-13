// Clara - Library Management Module
// Handles folder/document management, upload, rendering

export class LibraryManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
    }

    setup() {
        document.getElementById('btn-upload-doc').addEventListener('click', () => this.clara.modals.showUpload());
        document.getElementById('btn-new-folder').addEventListener('click', () => this.clara.modals.showFolder());
        document.getElementById('btn-empty-upload').addEventListener('click', () => this.clara.modals.showUpload());
        document.querySelector('[data-folder-id=""]').addEventListener('click', () => this.selectFolder(null));
        document.querySelector('[data-folder-id="__trash__"]').addEventListener('click', () => this.selectFolder('__trash__'));

        const zone = document.getElementById('upload-zone');
        const input = document.getElementById('file-input');

        zone.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => this.handleFile(e.target.files[0]));

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.style.borderColor = 'var(--accent)';
        });

        zone.addEventListener('dragleave', () => {
            zone.style.borderColor = 'var(--border)';
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.style.borderColor = 'var(--border)';
            if (e.dataTransfer.files.length) {
                this.handleFile(e.dataTransfer.files[0]);
            }
        });

        // External file drop on document grid
        const grid = document.getElementById('document-grid');
        if (grid) {
            grid.addEventListener('dragover', (e) => {
                // Only handle external files (not internal drags)
                if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    grid.classList.add('external-drop-target');
                }
            });

            grid.addEventListener('dragleave', (e) => {
                if (!grid.contains(e.relatedTarget)) {
                    grid.classList.remove('external-drop-target');
                }
            });

            grid.addEventListener('drop', async (e) => {
                grid.classList.remove('external-drop-target');
                // Handle external file drops
                if (e.dataTransfer.files.length > 0) {
                    e.preventDefault();
                    const pdfFiles = Array.from(e.dataTransfer.files).filter(
                        f => f.name.toLowerCase().endsWith('.pdf')
                    );

                    if (pdfFiles.length === 0) {
                        this.clara.ui.showToast('Please drop PDF files only', true);
                        return;
                    }

                    // For multiple files, upload all but only open the first
                    if (pdfFiles.length === 1) {
                        await this.handleFile(pdfFiles[0]);
                    } else {
                        this.clara.ui.showLoading(`Uploading ${pdfFiles.length} documents...`);
                        for (const file of pdfFiles) {
                            await this.uploadFileOnly(file);
                        }
                        await this.load();
                        this.clara.ui.hideLoading();
                        this.clara.ui.showToast(`Added ${pdfFiles.length} documents`);
                    }
                }
            });
        }

        // Selection toolbar actions
        const deleteSelectedBtn = document.getElementById('btn-delete-selected');
        if (deleteSelectedBtn) {
            deleteSelectedBtn.addEventListener('click', () => this.deleteSelected());
        }

        const restoreSelectedBtn = document.getElementById('btn-restore-selected');
        if (restoreSelectedBtn) {
            restoreSelectedBtn.addEventListener('click', () => this.restoreSelected());
        }

        const emptyTrashBtn = document.getElementById('btn-empty-trash');
        if (emptyTrashBtn) {
            emptyTrashBtn.addEventListener('click', () => this.emptyTrash());
        }

        const cancelSelectionBtn = document.getElementById('btn-cancel-selection');
        if (cancelSelectionBtn) {
            cancelSelectionBtn.addEventListener('click', () => this.clearSelection());
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Only handle when in library view
            if (this.state.currentView !== 'library') return;

            // Escape to clear selection
            if (e.key === 'Escape' && this.state.selectedItems.length > 0) {
                this.clearSelection();
            }

            // Delete/Backspace to delete selected
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.state.selectedItems.length > 0) {
                e.preventDefault();
                this.deleteSelected();
            }

            // Ctrl/Cmd + A to select all
            if ((e.ctrlKey || e.metaKey) && e.key === 'a' && this.state.currentView === 'library') {
                e.preventDefault();
                this.selectAll();
            }
        });

        // Click on empty space to clear selection
        document.getElementById('library-view').addEventListener('click', (e) => {
            if (e.target.id === 'document-grid' || e.target.classList.contains('library-main')) {
                this.clearSelection();
            }
        });
    }

    async load() {
        try {
            const res = await fetch('/library');
            const data = await res.json();

            this.state.folders = data.folders || [];
            this.state.documents = data.documents || [];

            this.renderFolderTree();
            this.renderDocuments();
        } catch (err) {
            console.error('Failed to load library:', err);
            this.clara.ui.showToast('Failed to load library', true);
        }
    }

    renderFolderTree() {
        const tree = document.getElementById('folder-tree');
        tree.innerHTML = '';

        const rootFolders = this.state.folders.filter(f => !f.parent_id && !f.deleted_at);
        rootFolders.forEach(folder => {
            this.renderFolderWithChildren(tree, folder, 0);
        });

        const allDocsBtn = document.querySelector('[data-folder-id=""]');
        const trashBtn = document.querySelector('[data-folder-id="__trash__"]');
        if (this.state.currentFolderId === null && !this.state.viewingTrash) {
            allDocsBtn.classList.add('active');
        } else {
            allDocsBtn.classList.remove('active');
        }

        if (this.state.viewingTrash) {
            trashBtn.classList.add('active');
        } else {
            trashBtn.classList.remove('active');
        }
    }

    renderFolderWithChildren(container, folder, depth) {
        const div = document.createElement('div');
        div.className = `folder-item folder-tree-item depth-${depth}`;
        div.dataset.folderId = folder.id;
        div.dataset.dropTarget = 'true';

        if (this.state.currentFolderId === folder.id) {
            div.classList.add('active');
        }

        div.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span>${folder.name}</span>
        `;

        div.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectFolder(folder.id);
        });
        div.addEventListener('contextmenu', (e) => this.clara.contextMenu.show(e, folder.id, 'folder'));

        container.appendChild(div);

        const children = this.state.folders.filter(f => f.parent_id === folder.id && !f.deleted_at);
        children.forEach(child => {
            this.renderFolderWithChildren(container, child, depth + 1);
        });
    }

    selectFolder(folderId) {
        if (folderId === '__trash__') {
            this.state.viewingTrash = true;
            this.state.currentFolderId = null;
        } else {
            this.state.viewingTrash = false;
            this.state.currentFolderId = folderId;
        }

        this.clearSelection();

        document.querySelectorAll('.folder-item').forEach(el => {
            el.classList.remove('active');
        });

        const activeEl = this.state.viewingTrash
            ? document.querySelector('[data-folder-id="__trash__"]')
            : folderId
            ? document.querySelector(`.folder-item[data-folder-id="${folderId}"]`)
            : document.querySelector('[data-folder-id=""]');
        if (activeEl) activeEl.classList.add('active');

        this.updateBreadcrumb();
        this.renderDocuments();
    }

    updateBreadcrumb() {
        const breadcrumb = document.getElementById('breadcrumb');
        breadcrumb.innerHTML = '';

        if (this.state.viewingTrash) {
            const trash = document.createElement('span');
            trash.className = 'breadcrumb-item active';
            trash.textContent = 'Trash';
            breadcrumb.appendChild(trash);
            return;
        }

        const path = [];
        let currentId = this.state.currentFolderId;

        while (currentId) {
            const folder = this.state.folders.find(f => f.id === currentId);
            if (folder) {
                path.unshift(folder);
                currentId = folder.parent_id;
            } else {
                break;
            }
        }

        const root = document.createElement('span');
        root.className = 'breadcrumb-item' + (path.length === 0 ? ' active' : '');
        root.textContent = 'All Documents';
        root.addEventListener('click', () => this.selectFolder(null));
        breadcrumb.appendChild(root);

        path.forEach((folder, idx) => {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-separator';
            sep.textContent = '/';
            breadcrumb.appendChild(sep);

            const item = document.createElement('span');
            item.className = 'breadcrumb-item' + (idx === path.length - 1 ? ' active' : '');
            item.textContent = folder.name;
            item.addEventListener('click', () => this.selectFolder(folder.id));
            breadcrumb.appendChild(item);
        });
    }

    renderDocuments() {
        const grid = document.getElementById('document-grid');
        const emptyState = document.getElementById('library-empty-state');
        const libraryContent = document.querySelector('.library-content');

        // Show main empty state if NO documents exist at all
        const hasAnyDocuments = this.state.documents && this.state.documents.length > 0;
        const hasAnyFolders = this.state.folders && this.state.folders.length > 0;

        if (!hasAnyDocuments && !hasAnyFolders) {
            // Show big centered empty state
            if (emptyState) emptyState.classList.add('active');
            if (libraryContent) libraryContent.classList.remove('active');
            return;
        } else {
            // Hide empty state, show library content
            if (emptyState) emptyState.classList.remove('active');
            if (libraryContent) libraryContent.classList.add('active');
        }

        // Filter for current folder
        let docs = [];
        let subfolders = [];

        if (this.state.viewingTrash) {
            docs = this.state.documents.filter(d => !!d.deleted_at);
            subfolders = this.state.folders.filter(f => !!f.deleted_at);
        } else {
            if (this.state.currentFolderId) {
                docs = this.state.documents.filter(d => d.folder_id === this.state.currentFolderId && !d.deleted_at);
            } else {
                // "All Documents" should show only root/unfiled docs.
                // Filed docs are shown only inside their folder.
                docs = this.state.documents.filter(d => !d.deleted_at && !d.folder_id);
            }

            subfolders = this.state.folders.filter(f => {
                if (f.deleted_at) return false;
                if (this.state.currentFolderId) {
                    return f.parent_id === this.state.currentFolderId;
                }
                return !f.parent_id;
            });
        }

        grid.innerHTML = '';

        // Show folder-specific empty message if in a folder with no content
        if (docs.length === 0 && subfolders.length === 0 && this.state.currentFolderId && !this.state.viewingTrash) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <p>This folder is empty</p>
                <span>Drag documents here to organize them</span>
            `;
            grid.appendChild(emptyDiv);
            return;
        }

        if (docs.length === 0 && subfolders.length === 0 && this.state.viewingTrash) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                </svg>
                <p>Trash is empty</p>
                <span>Deleted items will appear here until permanently removed.</span>
            `;
            grid.appendChild(emptyDiv);
            return;
        }

        subfolders.forEach(folder => {
            grid.appendChild(this.createFolderCard(folder));
        });

        docs.forEach(doc => {
            grid.appendChild(this.createDocumentCard(doc));
        });
    }

    createFolderCard(folder) {
        const card = document.createElement('div');
        card.className = 'document-card folder-card';
        card.dataset.folderId = folder.id;
        card.dataset.dropTarget = 'true';
        card.draggable = !this.state.viewingTrash;

        // Check if selected
        const isSelected = this.state.selectedItems.some(
            item => item.id === folder.id && item.type === 'folder'
        );
        if (isSelected) card.classList.add('selected');

        card.innerHTML = `
            <div class="select-checkbox">
                <input type="checkbox" ${isSelected ? 'checked' : ''}>
            </div>
            <div class="doc-icon folder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
            </div>
            <div class="doc-title">${folder.name}</div>
            <div class="doc-meta">${this.state.viewingTrash ? 'In Trash' : 'Folder'}</div>
        `;

        card.addEventListener('click', (e) => this.handleCardClick(e, folder.id, 'folder'));
        card.addEventListener('contextmenu', (e) => this.clara.contextMenu.show(e, folder.id, 'folder'));

        // Checkbox click
        const checkbox = card.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSelection(folder.id, 'folder');
        });

        return card;
    }

    createDocumentCard(doc) {
        const card = document.createElement('div');
        card.className = 'document-card';
        card.dataset.docId = doc.id;
        card.draggable = !this.state.viewingTrash;

        // Check if selected
        const isSelected = this.state.selectedItems.some(
            item => item.id === doc.id && item.type === 'document'
        );
        if (isSelected) card.classList.add('selected');

        const progress = doc.progress || 0;
        const ext = doc.original_filename?.split('.').pop()?.toUpperCase() || 'DOC';

        card.innerHTML = `
            <div class="select-checkbox">
                <input type="checkbox" ${isSelected ? 'checked' : ''}>
            </div>
            <div class="doc-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
            </div>
            <div class="doc-title">${doc.name}</div>
            <div class="doc-meta">${this.state.viewingTrash ? `In Trash · ${ext}` : ext}</div>
            ${progress > 0 ? `
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
            ` : ''}
        `;

        card.addEventListener('click', (e) => this.handleCardClick(e, doc.id, 'document'));
        card.addEventListener('contextmenu', (e) => this.clara.contextMenu.show(e, doc.id, 'document'));

        // Checkbox click
        const checkbox = card.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSelection(doc.id, 'document');
        });

        return card;
    }

    // Handle card click with multi-select support
    handleCardClick(e, id, type) {
        if (this.state.viewingTrash) {
            this.toggleSelection(id, type);
            return;
        }

        // If Ctrl/Cmd or Shift is held, toggle selection
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            this.toggleSelection(id, type);
            return;
        }

        // If there are selected items and clicking a non-selected item, clear and act
        if (this.state.selectedItems.length > 0) {
            const isSelected = this.state.selectedItems.some(
                item => item.id === id && item.type === type
            );
            if (!isSelected) {
                this.clearSelection();
            }
        }

        // Normal behavior
        if (type === 'folder') {
            this.selectFolder(id);
        } else {
            this.clara.viewer.open(id);
        }
    }

    // Toggle item selection
    toggleSelection(id, type) {
        const index = this.state.selectedItems.findIndex(
            item => item.id === id && item.type === type
        );

        if (index > -1) {
            // Remove from selection
            this.state.selectedItems.splice(index, 1);
        } else {
            // Add to selection
            this.state.selectedItems.push({ id, type });
        }

        this.updateSelectionUI();
    }

    // Clear all selections
    clearSelection() {
        this.state.selectedItems = [];
        this.updateSelectionUI();
    }

    // Select all items in current view
    selectAll() {
        this.state.selectedItems = [];

        // Get current folder's documents and subfolders
        let docs = [];
        let subfolders = [];

        if (this.state.viewingTrash) {
            docs = this.state.documents.filter(d => !!d.deleted_at);
            subfolders = this.state.folders.filter(f => !!f.deleted_at);
        } else {
            docs = this.state.currentFolderId
                ? this.state.documents.filter(d => d.folder_id === this.state.currentFolderId && !d.deleted_at)
                : this.state.documents.filter(d => !d.deleted_at && !d.folder_id);

            subfolders = this.state.folders.filter(f => {
                if (f.deleted_at) return false;
                if (this.state.currentFolderId) {
                    return f.parent_id === this.state.currentFolderId;
                }
                return !f.parent_id;
            });
        }

        subfolders.forEach(f => this.state.selectedItems.push({ id: f.id, type: 'folder' }));
        docs.forEach(d => this.state.selectedItems.push({ id: d.id, type: 'document' }));

        this.updateSelectionUI();
    }

    // Update UI to reflect selection state
    updateSelectionUI() {
        const count = this.state.selectedItems.length;
        const toolbar = document.getElementById('selection-toolbar');
        const countSpan = document.getElementById('selection-count');
        const deleteBtn = document.getElementById('btn-delete-selected');
        const restoreBtn = document.getElementById('btn-restore-selected');
        const emptyTrashBtn = document.getElementById('btn-empty-trash');

        if (deleteBtn) {
            deleteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                ${this.state.viewingTrash ? 'Delete Permanently' : 'Move to Trash'}
            `;
        }
        if (restoreBtn) {
            restoreBtn.classList.toggle('hidden', !this.state.viewingTrash || count === 0);
        }
        if (emptyTrashBtn) {
            emptyTrashBtn.classList.toggle('hidden', !this.state.viewingTrash);
        }

        // Update toolbar visibility
        if (toolbar) {
            if (count > 0 || this.state.viewingTrash) {
                toolbar.classList.add('visible');
                if (countSpan) countSpan.textContent = count;
            } else {
                toolbar.classList.remove('visible');
            }
        }

        // Update card selection state
        document.querySelectorAll('.document-card').forEach(card => {
            const docId = card.dataset.docId;
            const folderId = card.dataset.folderId;

            const isSelected = this.state.selectedItems.some(item => {
                if (docId && item.type === 'document') return item.id === docId;
                if (folderId && item.type === 'folder') return item.id === folderId;
                return false;
            });

            if (isSelected) {
                card.classList.add('selected');
                const cb = card.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = true;
            } else {
                card.classList.remove('selected');
                const cb = card.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = false;
            }
        });
    }

    // Delete selected items
    async deleteSelected() {
        const count = this.state.selectedItems.length;
        if (count === 0) return;

        const permanent = this.state.viewingTrash;
        const message = permanent
            ? `Permanently delete ${count} item${count > 1 ? 's' : ''}? This cannot be undone.`
            : `Move ${count} item${count > 1 ? 's' : ''} to Trash?`;
        const confirmed = confirm(message);
        if (!confirmed) return;

        const docIds = this.state.selectedItems.filter(i => i.type === 'document').map(i => i.id);
        const folderIds = this.state.selectedItems.filter(i => i.type === 'folder').map(i => i.id);

        try {
            await fetch(permanent ? '/library/delete-multiple-permanent' : '/library/delete-multiple', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ doc_ids: docIds, folder_ids: folderIds })
            });

            this.clearSelection();
            await this.load();
            this.clara.ui.showToast(
                permanent
                    ? `Deleted ${count} item${count > 1 ? 's' : ''}`
                    : `Moved ${count} item${count > 1 ? 's' : ''} to Trash`
            );
        } catch (err) {
            this.clara.ui.showToast('Delete failed: ' + err.message, true);
        }
    }

    async restoreSelected() {
        if (!this.state.viewingTrash || this.state.selectedItems.length === 0) return;

        const docIds = this.state.selectedItems.filter(i => i.type === 'document').map(i => i.id);
        const folderIds = this.state.selectedItems.filter(i => i.type === 'folder').map(i => i.id);

        try {
            await Promise.all([
                ...docIds.map(id => fetch(`/library/document/${id}/restore`, { method: 'POST' })),
                ...folderIds.map(id => fetch(`/library/folder/${id}/restore`, { method: 'POST' }))
            ]);

            this.clearSelection();
            await this.load();
            this.clara.ui.showToast('Restored selected items');
        } catch (err) {
            this.clara.ui.showToast('Restore failed: ' + err.message, true);
        }
    }

    async emptyTrash() {
        if (!this.state.viewingTrash) return;
        if (!confirm('Empty Trash permanently? This cannot be undone.')) return;

        try {
            await fetch('/library/empty-trash', { method: 'POST' });
            this.clearSelection();
            // After emptying trash, return to normal library root to avoid sticky trash state.
            this.state.viewingTrash = false;
            this.state.currentFolderId = null;
            await this.load();
            this.clara.ui.showToast('Trash emptied');
        } catch (err) {
            this.clara.ui.showToast('Failed to empty trash: ' + err.message, true);
        }
    }

    async handleFile(file) {
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        if (this.state.currentFolderId) {
            formData.append('folder_id', this.state.currentFolderId);
        }

        this.clara.modals.hideUpload();
        this.clara.ui.showLoading('Uploading document...');

        try {
            const res = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (data.error) {
                this.clara.ui.showToast(data.error, true);
                this.clara.ui.hideLoading();
                return;
            }

            await this.load();
            this.clara.ui.hideLoading();
            this.clara.viewer.open(data.id);

        } catch (err) {
            this.clara.ui.showToast('Upload failed: ' + err.message, true);
            this.clara.ui.hideLoading();
        }
    }

    // Upload file without opening viewer (for batch uploads)
    async uploadFileOnly(file) {
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        if (this.state.currentFolderId) {
            formData.append('folder_id', this.state.currentFolderId);
        }

        try {
            const res = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (data.error) {
                console.error('Upload failed:', data.error);
            }
            return data;
        } catch (err) {
            console.error('Upload failed:', err);
        }
    }

    async deleteItem(id, type) {
        try {
            const permanent = this.state.viewingTrash;
            const endpoint = permanent
                ? (type === 'folder' ? `/library/folder/${id}` : `/library/document/${id}`)
                : (type === 'folder' ? `/library/folder/${id}/trash` : `/library/document/${id}/trash`);
            await fetch(endpoint, { method: permanent ? 'DELETE' : 'POST' });
            await this.load();
            this.clara.ui.showToast(
                permanent
                    ? `${type === 'folder' ? 'Folder' : 'Document'} deleted`
                    : `${type === 'folder' ? 'Folder' : 'Document'} moved to Trash`
            );
        } catch (err) {
            this.clara.ui.showToast('Delete failed: ' + err.message, true);
        }
    }

    async moveDocument(docId, folderId) {
        if (this.state.viewingTrash) return;
        try {
            await fetch(`/library/document/${docId}/move`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_id: folderId })
            });
            await this.load();
            this.clara.ui.showToast('Document moved');
        } catch (err) {
            this.clara.ui.showToast('Move failed: ' + err.message, true);
        }
    }

    async moveFolder(folderId, parentId) {
        if (this.state.viewingTrash) return;
        try {
            await fetch(`/library/folder/${folderId}/move`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_id: parentId })
            });
            await this.load();
            this.clara.ui.showToast('Folder moved');
        } catch (err) {
            this.clara.ui.showToast('Move failed: ' + err.message, true);
        }
    }

    async moveDocumentToTrash(docId) {
        try {
            await fetch(`/library/document/${docId}/trash`, { method: 'POST' });
            await this.load();
            this.clara.ui.showToast('Document moved to Trash');
        } catch (err) {
            this.clara.ui.showToast('Move failed: ' + err.message, true);
        }
    }

    async moveFolderToTrash(folderId) {
        try {
            await fetch(`/library/folder/${folderId}/trash`, { method: 'POST' });
            await this.load();
            this.clara.ui.showToast('Folder moved to Trash');
        } catch (err) {
            this.clara.ui.showToast('Move failed: ' + err.message, true);
        }
    }
}
