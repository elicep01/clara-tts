// Clara - Document Viewer Module
// Handles document viewing, page navigation, zoom, and word overlays

export class ViewerManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.browseWords = [];
        this.scrollRafPending = false;
        this.scrollSettleTimer = null;
        this.lastScrollCandidate = null;
        this.lastScrollCandidateAt = 0;
        this.lastThumbnailAutoScrollAt = 0;
        this.scrollSyncLockUntil = 0;
    }

    lockScrollSync(ms = 260) {
        this.scrollSyncLockUntil = performance.now() + ms;
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
        let lastScrollTop = 0;

        documentDisplay.addEventListener('scroll', () => {
            if (this.scrollRafPending) return;
            this.scrollRafPending = true;

            requestAnimationFrame(() => {
                this.scrollRafPending = false;

                const scrollTop = documentDisplay.scrollTop;
                const scrollHeight = documentDisplay.scrollHeight;
                const clientHeight = documentDisplay.clientHeight;

                // In continuous mode (always active now), track page on every animation frame.
                if (document.querySelector('.continuous-pages-container')) {
                    if (performance.now() < this.scrollSyncLockUntil) {
                        lastScrollTop = scrollTop;
                        return;
                    }
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
            });
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
            this.state.viewerZoom = 0.75;  // Default zoom 75%

            // Restore last page position from database or reading session
            let startPage = Number.parseInt(`${info.current_page ?? 0}`, 10);
            if (!Number.isFinite(startPage)) startPage = 0;
            if (this.state.readingSession && this.state.readingSession.docId === docId) {
                startPage = this.state.readingSession.pageNum;
            }
            startPage = Math.max(0, Math.min(startPage, Math.max(0, this.state.viewerPageCount - 1)));
            this.state.viewerCurrentPage = startPage;
            console.log('[Viewer] Restored to page:', startPage);

            document.getElementById('zoom-level').textContent = '75%';
            document.getElementById('page-content').style.transform = 'scale(0.75)';

            this.updatePageIndicator();

            // Switch to viewer IMMEDIATELY so user can see the UI
            this.clara.navigation.switchView('viewer');
            this.clara.ui.hideLoading();

            // Load main page FIRST (most important - user can start reading)
            this.lockScrollSync(700);
            await this.loadPage(startPage);

            // Load thumbnails in BACKGROUND (don't block UI)
            this.renderPageThumbnails().catch(err => console.error('[Viewer] Thumbnail error:', err));
            this.setActiveThumbnail(startPage, false);

            this.updateReadButtonText();

            // Load notes and TOC in BACKGROUND (don't block UI)
            this.clara.notes.load().catch(err => console.error('[Viewer] Notes error:', err));

            if (this.clara.toc) {
                this.clara.toc.reset();
            }

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
        const currentPage = Math.max(0, this.state.viewerCurrentPage || 0);

        // LAZY LOADING FOR THUMBNAILS
        // Create all thumbnail placeholders instantly
        for (let i = 0; i < this.state.viewerPageCount; i++) {
            const thumb = document.createElement('div');
            thumb.className = 'page-thumb' + (i === currentPage ? ' active' : '');
            thumb.dataset.page = i;
            thumb.dataset.loaded = 'false';

            thumb.innerHTML = `
                <div class="page-thumb-placeholder">${i + 1}</div>
                <span class="page-num">Page ${i + 1}</span>
            `;

            thumb.addEventListener('click', () => this.goToPage(i));
            list.appendChild(thumb);
        }

        if (this.state.isPdf) {
            // Load only nearby thumbnails first so reading view stays smooth
            const immediateStart = Math.max(0, currentPage - 1);
            const immediateEnd = Math.min(this.state.viewerPageCount - 1, currentPage + 1);
            for (let i = immediateStart; i <= immediateEnd; i++) {
                const thumb = list.children[i];
                this.loadThumbnail(thumb, i);
            }

            // Set up Intersection Observer for remaining thumbnails
            this.setupLazyThumbnailLoading();
        }
    }

    setupLazyThumbnailLoading() {
        const options = {
            root: document.getElementById('page-list'),
            rootMargin: '120px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const thumb = entry.target;
                    const pageNum = parseInt(thumb.dataset.page);
                    const loaded = thumb.dataset.loaded === 'true';

                    if (!loaded) {
                        this.loadThumbnail(thumb, pageNum);
                        observer.unobserve(thumb);
                    }
                }
            });
        }, options);

        // Observe thumbnails that aren't loaded yet
        document.querySelectorAll('.page-thumb').forEach((thumb) => {
            if (thumb.dataset.loaded === 'false') {
                observer.observe(thumb);
            }
        });
    }

    async loadThumbnail(thumbEl, pageNum) {
        if (thumbEl.dataset.loaded === 'true') return;

        thumbEl.dataset.loaded = 'loading';

        const img = new Image();
        img.decoding = 'async';

        img.onload = () => {
            const placeholder = thumbEl.querySelector('.page-thumb-placeholder');
            if (placeholder) {
                placeholder.remove();
            }
            thumbEl.insertBefore(img, thumbEl.firstChild);
            thumbEl.dataset.loaded = 'true';
        };

        img.onerror = () => {
            thumbEl.dataset.loaded = 'error';
            console.error(`Failed to load thumbnail for page ${pageNum}`);
        };

        img.src = `/document/${this.state.viewerDocId}/thumbnail/${pageNum}`;
        if (img.complete && img.naturalWidth > 0) {
            img.onload?.();
        }
    }

    async loadPage(pageNum) {
        // Check if we're already in continuous mode (all pages are loaded)
        const inContinuousMode = document.querySelector('.continuous-pages-container');

        if (inContinuousMode) {
            // Already in continuous mode, don't reload - just scroll to the page
            this.scrollToContinuousPage(pageNum, 0, 'smooth');
            return;
        }

        // Always load in continuous mode for seamless scrolling
        return this.loadContinuousPages(pageNum);
    }

    scrollToContinuousPage(pageNum, yPosition = 0, behavior = 'smooth') {
        const targetPage = document.getElementById(`page-${pageNum}`);
        const documentDisplay = document.getElementById('document-display');
        if (!targetPage || !documentDisplay) return false;

        const zoom = this.state.viewerZoom || 1;
        const clampedY = Math.max(0, Math.min(1, Number(yPosition) || 0));
        const pageTop = targetPage.offsetTop;
        const pageHeight = targetPage.offsetHeight;
        const scrollTop = (pageTop + (pageHeight * clampedY)) * zoom;

        documentDisplay.scrollTo({
            top: scrollTop,
            behavior
        });
        return true;
    }

    async loadSinglePage(pageNum) {
        const content = document.getElementById('page-content');
        content.innerHTML = '<div class="spinner"></div>';
        content.style.transform = `scale(${this.state.viewerZoom})`;

        try {
            if (this.state.isPdf) {
                const img = new Image();

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

                img.src = `/document/${this.state.viewerDocId}/page/${pageNum}`;
                if (img.complete && img.naturalWidth > 0) {
                    img.onload?.();
                }
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

        // SMART LAZY LOADING STRATEGY
        // Load pages in chunks for better performance
        const CHUNK_SIZE = 5; // Load 5 pages at a time
        const INITIAL_RANGE = 3; // Load 3 pages before and after start page initially

        // Calculate which pages to load initially (current page +/- 3 pages)
        const initialStart = Math.max(0, startPage - INITIAL_RANGE);
        const initialEnd = Math.min(this.state.viewerPageCount - 1, startPage + INITIAL_RANGE);

        console.log(`[Lazy Load] Loading pages ${initialStart}-${initialEnd} initially (start page: ${startPage})`);

        // Create placeholder divs for ALL pages (instant)
        for (let i = 0; i < this.state.viewerPageCount; i++) {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'continuous-page';
            pageWrapper.dataset.pageNum = i;
            pageWrapper.id = `page-${i}`;
            pageWrapper.dataset.loaded = 'false';

            // Add placeholder with page number
            pageWrapper.innerHTML = `
                <div class="page-placeholder" style="min-height: 1100px; display: flex; align-items: center; justify-content: center; background: #f5f5f5; border: 1px solid #ddd;">
                    <div style="text-align: center; color: #666;">
                        <div style="font-size: 48px; font-weight: bold;">${i + 1}</div>
                        <div style="margin-top: 10px;">Loading page...</div>
                    </div>
                </div>
            `;

            container.appendChild(pageWrapper);
        }

        content.innerHTML = '';
        content.appendChild(container);

        // Load current page FIRST, then others in parallel
        await this.loadSinglePageLazy(startPage);

        // Scroll to start page IMMEDIATELY after first page loads
        this.lockScrollSync(700);
        this.scrollToContinuousPage(startPage, 0, 'auto');
        this.state.viewerCurrentPage = startPage;
        this.updatePageIndicator();
        this.setActiveThumbnail(startPage, false);

        // Load surrounding pages in BACKGROUND (don't block)
        const surroundingPages = [];
        for (let i = initialStart; i <= initialEnd; i++) {
            if (i !== startPage) {
                surroundingPages.push(this.loadSinglePageLazy(i));
            }
        }
        Promise.all(surroundingPages).catch(err => console.error('[Lazy Load] Error:', err));

        // Set up Intersection Observer for lazy loading remaining pages
        this.setupLazyPageLoading();

        console.log(`[Lazy Load] Initial load complete. Lazy loading enabled for remaining pages.`);
    }

    setupLazyPageLoading() {
        // Use Intersection Observer to load pages as they come into view
        const options = {
            root: document.getElementById('document-display'),
            rootMargin: '500px', // Load pages 500px before they enter viewport
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const pageWrapper = entry.target;
                    const pageNum = parseInt(pageWrapper.dataset.pageNum);
                    const loaded = pageWrapper.dataset.loaded === 'true';

                    if (!loaded) {
                        console.log(`[Lazy Load] Page ${pageNum} entering viewport, loading...`);
                        this.loadSinglePageLazy(pageNum);
                        observer.unobserve(pageWrapper); // Stop observing once loaded
                    }
                }
            });
        }, options);

        // Observe all page wrappers
        document.querySelectorAll('.continuous-page').forEach(pageWrapper => {
            const loaded = pageWrapper.dataset.loaded === 'true';
            if (!loaded) {
                observer.observe(pageWrapper);
            }
        });

        // Store observer for cleanup
        this.pageObserver = observer;
    }

    async loadSinglePageLazy(i) {
        const pageWrapper = document.getElementById(`page-${i}`);
        if (!pageWrapper || pageWrapper.dataset.loaded === 'true') {
            return; // Already loaded
        }

        // Mark as loading
        pageWrapper.dataset.loaded = 'loading';

        if (this.state.isPdf) {
            // Return a promise that resolves when image loads
            return new Promise((resolve) => {
                const img = new Image();
                img.dataset.pageNum = i;

                // Clear placeholder
                pageWrapper.innerHTML = '';
                pageWrapper.appendChild(img);

                img.onload = () => {
                    pageWrapper.dataset.loaded = 'true';
                    // Load word overlay in background (don't block)
                    this.createContinuousPageWordOverlay(i, pageWrapper)
                        .catch(err => console.error(`[Viewer] Word overlay error for page ${i}:`, err));
                    console.log(`[Lazy Load] Page ${i} loaded`);
                    resolve();
                };

                img.onerror = () => {
                    console.error(`[Viewer] Failed to load page ${i}`);
                    pageWrapper.dataset.loaded = 'error';
                    pageWrapper.innerHTML = `
                        <div style="min-height: 800px; display: flex; align-items: center; justify-content: center; background: #ffe6e6;">
                            <div style="text-align: center; color: #d00;">
                                <h3>Page ${i + 1} Failed</h3>
                            </div>
                        </div>
                    `;
                    resolve(); // Resolve anyway to not block
                };

                img.src = `/document/${this.state.viewerDocId}/page/${i}`;
                if (img.complete && img.naturalWidth > 0) {
                    img.onload?.();
                }
            });
        } else {
            // Text document
            try {
                const textRes = await fetch(`/document/${this.state.viewerDocId}/page/${i}/text`);
                const data = await textRes.json();
                pageWrapper.innerHTML = `<div class="text-content">${this.clara.ui.escapeHtml(data.text || 'No content')}</div>`;
                pageWrapper.dataset.loaded = 'true';
            } catch (err) {
                pageWrapper.innerHTML = `<div class="text-content">Failed to load page ${i + 1}</div>`;
                pageWrapper.dataset.loaded = 'error';
            }
        }
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
            overlay.addEventListener('contextmenu', (e) => {
                if (e.target !== overlay) return;
                const selectedText = window.getSelection().toString().trim();
                this.clara.contextMenu.showPdf(e, null, selectedText);
            });
            this.clara.contextMenu.attachPdfLongPress(overlay, () => ({
                target: overlay,
                wordIndex: null,
                selectedText: window.getSelection().toString().trim()
            }));

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
                    this.clara.contextMenu.attachPdfLongPress(box, () => ({
                        target: box,
                        wordIndex: idx,
                        selectedText: window.getSelection().toString().trim() || word.text
                    }));

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
            overlay.addEventListener('contextmenu', (e) => {
                if (e.target !== overlay) return;
                const selectedText = window.getSelection().toString().trim();
                this.clara.contextMenu.showPdf(e, null, selectedText);
            });
            this.clara.contextMenu.attachPdfLongPress(overlay, () => ({
                target: overlay,
                wordIndex: null,
                selectedText: window.getSelection().toString().trim()
            }));

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
                    this.clara.contextMenu.attachPdfLongPress(box, () => ({
                        target: box,
                        wordIndex: idx,
                        selectedText: window.getSelection().toString().trim() || word.text
                    }));

                    overlay.appendChild(box);
                }
            });
        } catch (err) {
            console.log('Could not load word positions for dictionary:', err);
        }
    }

    updateCurrentPageFromScroll() {
        if (performance.now() < this.scrollSyncLockUntil) return;

        const documentDisplay = document.getElementById('document-display');
        if (!documentDisplay) return;

        const displayRect = documentDisplay.getBoundingClientRect();
        const viewportMiddle = displayRect.top + (displayRect.height / 2);
        const pages = document.querySelectorAll('.continuous-page');
        if (!pages.length) return;

        const currentPage = this.state.viewerCurrentPage || 0;
        let visibleBest = null;
        let fallbackBest = null;
        let currentMetrics = null;

        pages.forEach((page) => {
            const rect = page.getBoundingClientRect();
            const pageNum = parseInt(page.dataset.pageNum || '0', 10);
            const visibleTop = Math.max(rect.top, displayRect.top);
            const visibleBottom = Math.min(rect.bottom, displayRect.bottom);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            const visibleRatio = rect.height > 0 ? (visibleHeight / rect.height) : 0;
            const pageCenter = rect.top + (rect.height / 2);
            const centerDistance = Math.abs(pageCenter - viewportMiddle);
            const score = (visibleRatio * 1000) - centerDistance;

            if (!fallbackBest || centerDistance < fallbackBest.centerDistance) {
                fallbackBest = { pageNum, centerDistance };
            }

            if (pageNum === currentPage) {
                currentMetrics = { visibleRatio, centerDistance, visibleHeight };
            }

            if (visibleHeight > 0) {
                if (!visibleBest || score > visibleBest.score) {
                    visibleBest = { pageNum, centerDistance, visibleRatio, score };
                }
            }
        });

        const candidate = visibleBest ? visibleBest.pageNum : (fallbackBest ? fallbackBest.pageNum : currentPage);
        if (candidate === currentPage) {
            this.lastScrollCandidate = candidate;
            this.lastScrollCandidateAt = 0;
            return;
        }

        const now = performance.now();
        if (this.lastScrollCandidate !== candidate) {
            this.lastScrollCandidate = candidate;
            this.lastScrollCandidateAt = now;
            return;
        }

        const stableForMs = now - this.lastScrollCandidateAt;
        const candidateIsStrong =
            !visibleBest ||
            !currentMetrics ||
            (visibleBest.visibleRatio >= currentMetrics.visibleRatio + 0.12) ||
            (visibleBest.centerDistance <= currentMetrics.centerDistance - 100) ||
            (currentMetrics.visibleHeight <= 0);

        // Avoid rapid page bouncing when two pages are both visible during fast scroll.
        if (!candidateIsStrong && stableForMs < 85) return;

        this.state.viewerCurrentPage = candidate;
        this.updatePageIndicator();
        this.setActiveThumbnail(candidate, false);

        if (this.scrollSettleTimer) clearTimeout(this.scrollSettleTimer);
        this.scrollSettleTimer = setTimeout(() => {
            this.updateCurrentPageFromScroll();
        }, 90);
    }

    isThumbnailVisible(thumbEl, listEl) {
        if (!thumbEl || !listEl) return false;
        const top = thumbEl.offsetTop;
        const bottom = top + thumbEl.offsetHeight;
        const viewTop = listEl.scrollTop;
        const viewBottom = viewTop + listEl.clientHeight;
        return top >= viewTop && bottom <= viewBottom;
    }

    setActiveThumbnail(pageNum, smooth = false) {
        const list = document.getElementById('page-list');
        let targetEl = null;

        document.querySelectorAll('.page-thumb').forEach(el => {
            const isTarget = parseInt(el.dataset.page) === pageNum;
            el.classList.toggle('active', isTarget);
            if (isTarget) targetEl = el;
        });

        if (!targetEl || !list) return;

        const shouldAutoScroll = smooth || !this.isThumbnailVisible(targetEl, list);
        if (!shouldAutoScroll) return;

        const now = performance.now();
        if (!smooth && (now - this.lastThumbnailAutoScrollAt) < 120) return;

        this.lastThumbnailAutoScrollAt = now;
        targetEl.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' });
    }

    goToPage(pageNum) {
        if (pageNum < 0 || pageNum >= this.state.viewerPageCount) return;

        this.lockScrollSync(320);
        this.lastScrollCandidate = pageNum;
        this.lastScrollCandidateAt = 0;

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
            // Don't force-hide question-section - let the Q&A toggle button control it
        }

        this.state.viewerCurrentPage = pageNum;
        this.updatePageIndicator();
        this.setActiveThumbnail(pageNum, true);

        // Save page position to database
        if (this.state.viewerDocId) {
            this.savePagePosition(pageNum);
        }

        // Check if we're in continuous mode
        if (!this.scrollToContinuousPage(pageNum, 0, 'smooth')) {
            // In single-page mode, load the page
            this.loadPage(pageNum);
        }

        this.updateReadButtonText();
        this.clara.navigation.updateTitle();

        setTimeout(() => this.clara.notes.renderMarkers(), 200);
    }

    updatePageIndicator() {
        const indicator = document.getElementById('page-indicator');
        indicator.textContent = `Page ${this.state.viewerCurrentPage + 1} / ${this.state.viewerPageCount}`;
        this.clara.notes?.syncStudySheetPage?.();

        document.getElementById('btn-prev-page').disabled = this.state.viewerCurrentPage === 0;
        document.getElementById('btn-next-page').disabled = this.state.viewerCurrentPage >= this.state.viewerPageCount - 1;
    }

    async savePagePosition(pageNum) {
        try {
            await fetch(`/document/${this.state.viewerDocId}/position`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageNum })
            });
            console.log('[Viewer] Saved page position:', pageNum);
        } catch (err) {
            console.error('[Viewer] Failed to save page position:', err);
        }
    }
}
