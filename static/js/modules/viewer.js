// Clara - Document Viewer Module
// Handles document viewing, page navigation, zoom, and word overlays

export class ViewerManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.browseWords = [];
    }

    setup() {
        document.getElementById('btn-prev-page').addEventListener('click', () => {
            this.goToPage(this.state.viewerCurrentPage - 1);
        });

        document.getElementById('btn-next-page').addEventListener('click', () => {
            this.goToPage(this.state.viewerCurrentPage + 1);
        });

        document.getElementById('btn-start-reading').addEventListener('click', () => {
            this.clara.reading.start();
        });

        // Scroll-based page navigation and tracking
        const documentDisplay = document.getElementById('document-display');
        let scrollTimeout = null;
        let lastScrollTop = 0;

        documentDisplay.addEventListener('scroll', () => {
            if (scrollTimeout) clearTimeout(scrollTimeout);

            scrollTimeout = setTimeout(() => {
                const scrollTop = documentDisplay.scrollTop;
                const scrollHeight = documentDisplay.scrollHeight;
                const clientHeight = documentDisplay.clientHeight;

                // In continuous mode (always active now), track which page is currently visible
                if (document.querySelector('.continuous-pages-container')) {
                    this.updateCurrentPageFromScroll();
                    lastScrollTop = scrollTop;
                    return;
                }

                // Single-page mode scrolling (for reading mode)
                if (scrollTop + clientHeight >= scrollHeight - 20) {
                    if (this.state.viewerCurrentPage < this.state.viewerPageCount - 1) {
                        if (this.state.isReadingMode) {
                            this.clara.reading.nextPage();
                        } else {
                            this.goToPage(this.state.viewerCurrentPage + 1);
                            setTimeout(() => documentDisplay.scrollTop = 0, 100);
                        }
                    }
                } else if (scrollTop <= 0 && lastScrollTop > 0) {
                    if (this.state.viewerCurrentPage > 0) {
                        if (this.state.isReadingMode) {
                            this.clara.reading.previousPage();
                        } else {
                            this.goToPage(this.state.viewerCurrentPage - 1);
                            setTimeout(() => {
                                documentDisplay.scrollTop = documentDisplay.scrollHeight;
                            }, 100);
                        }
                    }
                }

                lastScrollTop = scrollTop;
            }, 150);
        });
    }

    setupZoom() {
        document.getElementById('btn-zoom-in').addEventListener('click', () => {
            this.setZoom(this.state.viewerZoom + 0.25);
        });

        document.getElementById('btn-zoom-out').addEventListener('click', () => {
            this.setZoom(this.state.viewerZoom - 0.25);
        });

        document.getElementById('btn-zoom-fit').addEventListener('click', () => {
            this.setZoom(1.0);
        });
    }

    setZoom(level) {
        this.state.viewerZoom = Math.max(0.5, Math.min(3.0, level));
        document.getElementById('zoom-level').textContent = `${Math.round(this.state.viewerZoom * 100)}%`;

        const pageContent = document.getElementById('page-content');
        pageContent.style.transform = `scale(${this.state.viewerZoom})`;
    }

    async open(docId) {
        this.clara.ui.showLoading('Loading document...');

        try {
            const infoRes = await fetch(`/document/${docId}/info`);
            const info = await infoRes.json();

            if (info.error) {
                this.clara.ui.showToast(info.error, true);
                this.clara.ui.hideLoading();
                return;
            }

            // Clear previous document content before loading new document
            const pageContent = document.getElementById('page-content');
            pageContent.innerHTML = '';

            // Reset scroll position to top
            const documentDisplay = document.getElementById('document-display');
            documentDisplay.scrollTop = 0;

            this.state.viewerDocId = docId;
            this.state.viewerDocName = info.filename;
            this.state.viewerPageCount = info.page_count || 1;
            this.state.isPdf = info.is_pdf;
            this.state.viewerZoom = 1.0;

            let startPage = 0;
            if (this.state.readingSession && this.state.readingSession.docId === docId) {
                startPage = this.state.readingSession.pageNum;
            }
            this.state.viewerCurrentPage = startPage;

            document.getElementById('zoom-level').textContent = '100%';
            document.getElementById('page-content').style.transform = 'scale(1)';

            this.updatePageIndicator();
            await this.renderPageThumbnails();
            await this.loadPage(startPage);

            if (startPage > 0) {
                document.querySelectorAll('.page-thumb').forEach(el => {
                    el.classList.remove('active');
                    if (parseInt(el.dataset.page) === startPage) {
                        el.classList.add('active');
                    }
                });
            }

            this.updateReadButtonText();
            await this.clara.notes.load();

            // Load TOC if available
            if (this.clara.toc) {
                this.clara.toc.reset();
                await this.clara.toc.load(docId);
            }

            this.clara.navigation.switchView('viewer');
            this.clara.ui.hideLoading();

        } catch (err) {
            this.clara.ui.showToast('Failed to open document: ' + err.message, true);
            this.clara.ui.hideLoading();
        }
    }

    updateReadButtonText() {
        const btn = document.getElementById('btn-start-reading');
        const hasSession = this.clara.reading.hasSession(this.state.viewerDocId, this.state.viewerCurrentPage);

        if (hasSession) {
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
                Resume Reading
            `;
        } else {
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
                Read This Page
            `;
        }
    }

    async renderPageThumbnails() {
        const list = document.getElementById('page-list');
        list.innerHTML = '';

        for (let i = 0; i < this.state.viewerPageCount; i++) {
            const thumb = document.createElement('div');
            thumb.className = 'page-thumb' + (i === 0 ? ' active' : '');
            thumb.dataset.page = i;

            thumb.innerHTML = `
                <div class="page-thumb-placeholder">${i + 1}</div>
                <span class="page-num">Page ${i + 1}</span>
            `;

            thumb.addEventListener('click', () => this.goToPage(i));
            list.appendChild(thumb);

            if (this.state.isPdf) {
                this.loadThumbnail(thumb, i);
            }
        }
    }

    async loadThumbnail(thumbEl, pageNum) {
        const img = new Image();
        img.src = `/document/${this.state.viewerDocId}/thumbnail/${pageNum}`;

        img.onload = () => {
            const placeholder = thumbEl.querySelector('.page-thumb-placeholder');
            if (placeholder) {
                placeholder.remove();
            }
            thumbEl.insertBefore(img, thumbEl.firstChild);
        };
    }

    async loadPage(pageNum) {
        // Check if we're already in continuous mode (all pages are loaded)
        const inContinuousMode = document.querySelector('.continuous-pages-container');

        if (inContinuousMode) {
            // Already in continuous mode, don't reload - just scroll to the page
            const targetPage = document.getElementById(`page-${pageNum}`);
            if (targetPage) {
                targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            return;
        }

        // Always load in continuous mode for seamless scrolling
        return this.loadContinuousPages(pageNum);
    }

    async loadSinglePage(pageNum) {
        const content = document.getElementById('page-content');
        content.innerHTML = '<div class="spinner"></div>';
        content.style.transform = `scale(${this.state.viewerZoom})`;

        try {
            if (this.state.isPdf) {
                const img = new Image();
                img.src = `/document/${this.state.viewerDocId}/page/${pageNum}`;

                img.onload = async () => {
                    content.innerHTML = '';
                    content.appendChild(img);
                    await this.createBrowseWordOverlay(pageNum);
                };

                img.onerror = async () => {
                    const textRes = await fetch(`/document/${this.state.viewerDocId}/page/${pageNum}/text`);
                    const data = await textRes.json();
                    content.innerHTML = `<div class="text-content">${this.clara.ui.escapeHtml(data.text || 'No content')}</div>`;
                };
            } else {
                const textRes = await fetch(`/document/${this.state.viewerDocId}/page/${pageNum}/text`);
                const data = await textRes.json();
                content.innerHTML = `<div class="text-content">${this.clara.ui.escapeHtml(data.text || 'No content')}</div>`;
            }

        } catch (err) {
            content.innerHTML = `<div class="text-content">Failed to load page</div>`;
        }
    }

    async loadContinuousPages(startPage) {
        const content = document.getElementById('page-content');
        content.innerHTML = '<div class="spinner"></div>';
        content.style.transform = `scale(${this.state.viewerZoom})`;

        const container = document.createElement('div');
        container.className = 'continuous-pages-container';

        // Load all pages for continuous scrolling
        for (let i = 0; i < this.state.viewerPageCount; i++) {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'continuous-page';
            pageWrapper.dataset.pageNum = i;
            pageWrapper.id = `page-${i}`;

            if (this.state.isPdf) {
                const img = new Image();
                img.src = `/document/${this.state.viewerDocId}/page/${i}`;
                img.dataset.pageNum = i;

                pageWrapper.appendChild(img);

                // Load word overlay after image loads
                img.onload = async () => {
                    await this.createContinuousPageWordOverlay(i, pageWrapper);
                };

                // Handle image loading errors
                img.onerror = async () => {
                    console.error(`Failed to load page ${i} image from: ${img.src}`);
                    // Try to load as text fallback
                    try {
                        const textRes = await fetch(`/document/${this.state.viewerDocId}/page/${i}/text`);
                        const data = await textRes.json();
                        pageWrapper.innerHTML = `<div class="text-content">${this.clara.ui.escapeHtml(data.text || 'No content')}</div>`;
                    } catch (err) {
                        pageWrapper.innerHTML = `<div class="text-content">Failed to load page ${i + 1}</div>`;
                    }
                };
            } else {
                try {
                    const textRes = await fetch(`/document/${this.state.viewerDocId}/page/${i}/text`);
                    const data = await textRes.json();
                    pageWrapper.innerHTML = `<div class="text-content">${this.clara.ui.escapeHtml(data.text || 'No content')}</div>`;
                } catch (err) {
                    pageWrapper.innerHTML = `<div class="text-content">Failed to load page ${i + 1}</div>`;
                }
            }

            container.appendChild(pageWrapper);
        }

        content.innerHTML = '';
        content.appendChild(container);

        // Scroll to the requested page
        setTimeout(() => {
            const targetPage = document.getElementById(`page-${startPage}`);
            if (targetPage) {
                targetPage.scrollIntoView({ behavior: 'auto' });
            }
        }, 100);
    }

    async createBrowseWordOverlay(pageNum) {
        if (this.state.isReadingMode) return;

        const pageContent = document.getElementById('page-content');
        const img = pageContent.querySelector('img');
        if (!img) return;

        if (!img.complete) {
            await new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
            });
        }

        try {
            const wordsRes = await fetch(`/document/${this.state.viewerDocId}/page/${pageNum}/words`);
            const wordsData = await wordsRes.json();

            if (!wordsData.words || wordsData.words.length === 0) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'page-image-wrapper browse-mode';

            const overlay = document.createElement('div');
            overlay.id = 'browse-word-overlay';
            overlay.className = 'word-highlight-overlay browse-overlay';

            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
            wrapper.appendChild(overlay);

            this.browseWords = wordsData.words;

            wordsData.words.forEach((word, idx) => {
                if (word.x !== undefined && word.y !== undefined) {
                    const box = document.createElement('div');
                    box.className = 'word-box browse-word';
                    box.dataset.index = idx;
                    box.dataset.word = word.text;
                    box.style.left = `${word.x}%`;
                    box.style.top = `${word.y}%`;
                    box.style.width = `${word.w}%`;
                    box.style.height = `${word.h}%`;

                    box.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        this.clara.dictionary.lookup(word.text, box);
                    });

                    box.addEventListener('contextmenu', (e) => {
                        e.stopPropagation();
                        const selectedText = window.getSelection().toString().trim();
                        this.clara.contextMenu.showPdf(e, idx, selectedText || word.text);
                    });

                    overlay.appendChild(box);
                }
            });
        } catch (err) {
            console.log('Could not load word positions for dictionary:', err);
        }
    }

    async createContinuousPageWordOverlay(pageNum, pageWrapper) {
        if (this.state.isReadingMode) return;

        const img = pageWrapper.querySelector('img');
        if (!img || !img.complete) return;

        try {
            const wordsRes = await fetch(`/document/${this.state.viewerDocId}/page/${pageNum}/words`);
            const wordsData = await wordsRes.json();

            if (!wordsData.words || wordsData.words.length === 0) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'page-image-wrapper browse-mode';

            const overlay = document.createElement('div');
            overlay.className = 'word-highlight-overlay browse-overlay';
            overlay.dataset.pageNum = pageNum;

            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
            wrapper.appendChild(overlay);

            wordsData.words.forEach((word, idx) => {
                if (word.x !== undefined && word.y !== undefined) {
                    const box = document.createElement('div');
                    box.className = 'word-box browse-word';
                    box.dataset.index = idx;
                    box.dataset.word = word.text;
                    box.style.left = `${word.x}%`;
                    box.style.top = `${word.y}%`;
                    box.style.width = `${word.w}%`;
                    box.style.height = `${word.h}%`;

                    box.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        this.clara.dictionary.lookup(word.text, box);
                    });

                    box.addEventListener('contextmenu', (e) => {
                        e.stopPropagation();
                        const selectedText = window.getSelection().toString().trim();
                        this.clara.contextMenu.showPdf(e, idx, selectedText || word.text);
                    });

                    overlay.appendChild(box);
                }
            });
        } catch (err) {
            console.log('Could not load word positions for dictionary:', err);
        }
    }

    updateCurrentPageFromScroll() {
        const documentDisplay = document.getElementById('document-display');
        const scrollTop = documentDisplay.scrollTop;
        const viewportMiddle = scrollTop + documentDisplay.clientHeight / 2;

        // Find which page is currently in the middle of the viewport
        const pages = document.querySelectorAll('.continuous-page');
        let currentPage = 0;

        pages.forEach((page, index) => {
            const pageTop = page.offsetTop;
            const pageBottom = pageTop + page.offsetHeight;

            if (viewportMiddle >= pageTop && viewportMiddle <= pageBottom) {
                currentPage = index;
            }
        });

        if (currentPage !== this.state.viewerCurrentPage) {
            this.state.viewerCurrentPage = currentPage;
            this.updatePageIndicator();

            // Update active thumbnail
            document.querySelectorAll('.page-thumb').forEach(el => {
                el.classList.remove('active');
                if (parseInt(el.dataset.page) === currentPage) {
                    el.classList.add('active');
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        }
    }

    goToPage(pageNum) {
        if (pageNum < 0 || pageNum >= this.state.viewerPageCount) return;

        if (this.state.isReadingMode) {
            this.clara.reading.saveSession();

            this.clara.reading.audio.pause();
            this.clara.reading.audio.currentTime = 0;
            this.clara.reading.audio.src = '';
            this.state.isPlaying = false;
            this.clara.reading.wordTimings = [];

            this.state.isReadingMode = false;
            this.state.words = [];
            this.clara.reading.clearPreloadedAudio();

            const wrapper = document.querySelector('.page-image-wrapper');
            if (wrapper) {
                const img = wrapper.querySelector('img');
                const pageContent = document.getElementById('page-content');
                if (img && pageContent) {
                    pageContent.appendChild(img);
                }
                wrapper.remove();
            }

            document.getElementById('browse-controls').classList.remove('hidden');
            document.getElementById('reading-controls').classList.add('hidden');
            document.getElementById('question-section').classList.add('hidden');
        }

        this.state.viewerCurrentPage = pageNum;
        this.updatePageIndicator();

        // Check if we're in continuous mode
        const targetPage = document.getElementById(`page-${pageNum}`);
        if (targetPage) {
            // In continuous mode, just scroll to the page
            targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            // In single-page mode, load the page
            this.loadPage(pageNum);
        }

        document.querySelectorAll('.page-thumb').forEach(el => {
            el.classList.remove('active');
            if (parseInt(el.dataset.page) === pageNum) {
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        this.updateReadButtonText();
        this.clara.navigation.updateTitle();

        setTimeout(() => this.clara.notes.renderMarkers(), 200);
    }

    updatePageIndicator() {
        const indicator = document.getElementById('page-indicator');
        indicator.textContent = `Page ${this.state.viewerCurrentPage + 1} / ${this.state.viewerPageCount}`;

        document.getElementById('btn-prev-page').disabled = this.state.viewerCurrentPage === 0;
        document.getElementById('btn-next-page').disabled = this.state.viewerCurrentPage >= this.state.viewerPageCount - 1;
    }
}