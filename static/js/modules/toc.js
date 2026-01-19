// Clara - Table of Contents Module
// Handles document TOC display and navigation

export class TOCManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.tocData = [];
    }

    setup() {
        // Sidebar toggle buttons
        document.getElementById('btn-show-thumbnails').addEventListener('click', () => {
            this.showThumbnails();
        });

        document.getElementById('btn-show-toc').addEventListener('click', () => {
            this.showTOC();
        });
    }

    showThumbnails() {
        document.getElementById('btn-show-thumbnails').classList.add('active');
        document.getElementById('btn-show-toc').classList.remove('active');

        document.getElementById('page-list').classList.remove('hidden');
        document.getElementById('toc-list').classList.add('hidden');
        document.getElementById('toc-empty').classList.add('hidden');
    }

    showTOC() {
        document.getElementById('btn-show-toc').classList.add('active');
        document.getElementById('btn-show-thumbnails').classList.remove('active');

        document.getElementById('page-list').classList.add('hidden');

        if (this.tocData.length > 0) {
            document.getElementById('toc-list').classList.remove('hidden');
            document.getElementById('toc-empty').classList.add('hidden');
        } else {
            document.getElementById('toc-list').classList.add('hidden');
            document.getElementById('toc-empty').classList.remove('hidden');
        }
    }

    async load(docId) {
        this.tocData = [];

        try {
            const res = await fetch(`/document/${docId}/toc`);
            const data = await res.json();

            if (data.toc && data.toc.length > 0) {
                this.tocData = data.toc;
                this.render();
            } else {
                this.tocData = [];
                document.getElementById('toc-list').innerHTML = '';
            }
        } catch (err) {
            console.log('Could not load TOC:', err);
            this.tocData = [];
        }
    }

    render() {
        const list = document.getElementById('toc-list');
        list.innerHTML = '';

        // Backend returns flat items with 'level' property (1, 2, 3, etc.)
        // We use level directly for indentation depth
        this.tocData.forEach(item => {
            const tocItem = this.createTOCItem(item);
            list.appendChild(tocItem);
        });
    }

    createTOCItem(item) {
        // Use the item's level property (1-based from backend) for depth
        // Level 1 = no indent, Level 2 = one indent, etc.
        const depth = Math.max(0, (item.level || 1) - 1);

        const div = document.createElement('div');
        div.className = `toc-item depth-${Math.min(depth, 3)}`;

        div.innerHTML = `
            <span class="toc-title">${this.clara.ui.escapeHtml(item.title)}</span>
            ${item.page !== undefined ? `<span class="toc-page">${item.page + 1}</span>` : ''}
        `;

        div.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.page !== undefined) {
                this.navigateToHeading(item);
            }
        });

        return div;
    }

    navigateToHeading(item) {
        // Navigate to the page first
        const pageNum = item.page;
        const yPosition = item.y_position || 0;

        // Check if we're in continuous mode
        const targetPage = document.getElementById(`page-${pageNum}`);

        if (targetPage) {
            // In continuous mode, scroll to the exact position on the page
            const documentDisplay = document.getElementById('document-display');
            const pageTop = targetPage.offsetTop;
            const pageHeight = targetPage.offsetHeight;
            const scrollPosition = pageTop + (pageHeight * yPosition);

            documentDisplay.scrollTo({
                top: scrollPosition,
                behavior: 'smooth'
            });

            // Update current page state
            this.state.viewerCurrentPage = pageNum;
            this.clara.viewer.updatePageIndicator();
        } else {
            // In single-page mode, go to page and scroll after load
            this.clara.viewer.goToPage(pageNum);

            // Wait for page to load, then scroll to position
            setTimeout(() => {
                const pageContent = document.getElementById('page-content');
                const img = pageContent.querySelector('img');

                if (img && img.complete) {
                    const scrollPosition = img.height * yPosition;
                    const documentDisplay = document.getElementById('document-display');
                    documentDisplay.scrollTo({
                        top: scrollPosition,
                        behavior: 'smooth'
                    });
                }
            }, 300);
        }
    }

    reset() {
        this.tocData = [];
        document.getElementById('toc-list').innerHTML = '';

        // Reset to thumbnails view
        this.showThumbnails();
    }
}