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

        const rootFolders = this.state.folders.filter(f => !f.parent_id);
        rootFolders.forEach(folder => {
            this.renderFolderWithChildren(tree, folder, 0);
        });

        const allDocsBtn = document.querySelector('[data-folder-id=""]');
        if (this.state.currentFolderId === null) {
            allDocsBtn.classList.add('active');
        } else {
            allDocsBtn.classList.remove('active');
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

        const children = this.state.folders.filter(f => f.parent_id === folder.id);
        children.forEach(child => {
            this.renderFolderWithChildren(container, child, depth + 1);
        });
    }

    selectFolder(folderId) {
        this.state.currentFolderId = folderId;

        document.querySelectorAll('.folder-item').forEach(el => {
            el.classList.remove('active');
        });

        const activeEl = folderId
            ? document.querySelector(`.folder-item[data-folder-id="${folderId}"]`)
            : document.querySelector('[data-folder-id=""]');
        if (activeEl) activeEl.classList.add('active');

        this.updateBreadcrumb();
        this.renderDocuments();
    }

    updateBreadcrumb() {
        const breadcrumb = document.getElementById('breadcrumb');
        breadcrumb.innerHTML = '';

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
        let docs;
        if (this.state.currentFolderId) {
            docs = this.state.documents.filter(d => d.folder_id === this.state.currentFolderId);
        } else {
            docs = this.state.documents;
        }

        const subfolders = this.state.folders.filter(f => {
            if (this.state.currentFolderId) {
                return f.parent_id === this.state.currentFolderId;
            }
            return !f.parent_id;
        });

        grid.innerHTML = '';

        // Show folder-specific empty message if in a folder with no content
        if (docs.length === 0 && subfolders.length === 0 && this.state.currentFolderId) {
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
        card.draggable = true;

        card.innerHTML = `
            <div class="doc-icon folder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
            </div>
            <div class="doc-title">${folder.name}</div>
            <div class="doc-meta">Folder</div>
        `;

        card.addEventListener('click', () => this.selectFolder(folder.id));
        card.addEventListener('contextmenu', (e) => this.clara.contextMenu.show(e, folder.id, 'folder'));

        return card;
    }

    createDocumentCard(doc) {
        const card = document.createElement('div');
        card.className = 'document-card';
        card.dataset.docId = doc.id;
        card.draggable = true;

        const progress = doc.progress || 0;
        const ext = doc.original_filename?.split('.').pop()?.toUpperCase() || 'DOC';

        card.innerHTML = `
            <div class="doc-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
            </div>
            <div class="doc-title">${doc.name}</div>
            <div class="doc-meta">${ext}</div>
            ${progress > 0 ? `
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
            ` : ''}
        `;

        card.addEventListener('click', () => this.clara.viewer.open(doc.id));
        card.addEventListener('contextmenu', (e) => this.clara.contextMenu.show(e, doc.id, 'document'));

        return card;
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

    async deleteItem(id, type) {
        try {
            const endpoint = type === 'folder' ? `/library/folder/${id}` : `/library/document/${id}`;
            await fetch(endpoint, { method: 'DELETE' });
            await this.load();
            this.clara.ui.showToast(`${type === 'folder' ? 'Folder' : 'Document'} deleted`);
        } catch (err) {
            this.clara.ui.showToast('Delete failed: ' + err.message, true);
        }
    }

    async moveDocument(docId, folderId) {
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
}