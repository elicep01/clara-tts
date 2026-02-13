// Clara - Reading/TTS Module
// Handles text-to-speech, word highlighting, audio playback, and reading sessions

export class ReadingManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.audio = null;
        this.wordTimings = [];
        this.pendingWordIndex = null;
        this.forceStartPage = null;

        // Performance: Cache word box references
        this.wordBoxes = [];
        this.lastHighlightedIndex = -1;
        this.scrollThrottleTimer = null;
        this.isScrolling = false;

        // User scroll detection
        this.userIsScrolling = false;
        this.userScrollTimeout = null;

        // Audio preloading cache
        this.preloadedAudio = {
            pageNum: null,
            audioBlob: null,
            words: null,
            pageText: null,
            isLoading: false
        };

        // Chunked playback state
        this.audioChunks = [];
        this.currentChunkIndex = 0;
        this.totalChunks = 0;
        this.isLoadingChunks = false;
        this.readFromCommandId = 0;

        // Timing correction
        this.lastTimingCheck = 0;
        this.timingDriftCorrection = 0;
        this.manualSelection = {
            active: false,
            start: null,
            end: null
        };
    }

    setup() {
        this.audio = document.getElementById('audio');

        if (!this.audio) {
            console.error('Audio element not found!');
            return;
        }

        document.getElementById('btn-play-pause').addEventListener('click', () => {
            this.togglePlayPause();
        });

        document.getElementById('reading-speed').addEventListener('change', (e) => {
            this.state.playbackSpeed = parseFloat(e.target.value);
            if (this.audio) {
                this.audio.playbackRate = this.state.playbackSpeed;
                // CRITICAL: Validate position after speed change
                this.validateAndCorrectPosition();
            }
        });

        document.getElementById('btn-stop-reading').addEventListener('click', () => {
            this.stop();
        });

        document.getElementById('btn-read-prev').addEventListener('click', () => {
            this.previousPage();
        });

        document.getElementById('btn-read-next').addEventListener('click', () => {
            this.nextPage();
        });

        document.getElementById('btn-send').addEventListener('click', () => {
            this.askQuestion();
        });

        document.getElementById('question-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.askQuestion();
        });

        document.getElementById('btn-dismiss-answer').addEventListener('click', () => {
            document.getElementById('answer-box').classList.add('hidden');
        });

        document.getElementById('reading-progress-bar').addEventListener('click', (e) => {
            const rect = e.target.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const wordIndex = Math.floor(percent * this.state.words.length);
            this.seekToWord(wordIndex);
        });

        const syncBtn = document.getElementById('btn-sync-reading');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.syncToCurrentWord());
        }

        this.audio.addEventListener('ended', () => {
            this.onAudioEnded();
        });

        // CRITICAL: Use requestAnimationFrame for frame-perfect sync
        // timeupdate only fires ~4x per second, causing visible lag
        this.syncRAF = null;

        this.audio.addEventListener('play', () => {
            console.log('[Audio] Play event - starting sync');
            this.state.isPlaying = true;
            this.updatePlayPauseButton();
            this.startAnimationFrameSync();
        });

        this.audio.addEventListener('pause', () => {
            console.log('[Audio] Pause event');
            this.state.isPlaying = false;
            this.updatePlayPauseButton();
            this.stopAnimationFrameSync();
        });

        this.audio.addEventListener('ended', () => {
            console.log('[Audio] Ended event');
            this.stopAnimationFrameSync();
        });

        this.audio.addEventListener('error', (e) => {
            console.error('[Audio] Error:', e);
            this.clara.ui.showToast('Audio playback error', true);
        });

        // Detect user manual scrolling during reading mode
        const documentDisplay = document.getElementById('document-display');
        documentDisplay.addEventListener('wheel', () => {
            if (this.state.isReadingMode && this.state.isPlaying) {
                this.userIsScrolling = true;
                clearTimeout(this.userScrollTimeout);
                this.userScrollTimeout = setTimeout(() => {
                    this.userIsScrolling = false;
                }, 2000); // User scroll lock for 2 seconds
            }
        }, { passive: true });

        documentDisplay.addEventListener('touchstart', () => {
            if (this.state.isReadingMode && this.state.isPlaying) {
                this.userIsScrolling = true;
                clearTimeout(this.userScrollTimeout);
                this.userScrollTimeout = setTimeout(() => {
                    this.userIsScrolling = false;
                }, 2000);
            }
        }, { passive: true });

        // Debug mode toggle (press 'D' key to toggle word box visibility)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'D' && e.shiftKey && this.state.isReadingMode) {
                const overlay = document.getElementById('word-highlight-overlay');
                if (overlay) {
                    overlay.classList.toggle('debug');
                    const isDebug = overlay.classList.contains('debug');
                    console.log(`[Debug] Word boxes ${isDebug ? 'VISIBLE' : 'HIDDEN'}`);
                    this.clara.ui.showToast(`Debug mode: ${isDebug ? 'ON' : 'OFF'}`);
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (!this.manualSelection.active) return;
            this.manualSelection.active = false;
        });
        document.addEventListener('touchend', () => {
            if (!this.manualSelection.active) return;
            this.manualSelection.active = false;
        }, { passive: true });
    }

    clearManualSelection() {
        this.wordBoxes.forEach(box => box.classList.remove('manual-selected'));
        this.manualSelection.start = null;
        this.manualSelection.end = null;
    }

    getManualSelectionText() {
        if (this.manualSelection.start === null || this.manualSelection.end === null) return '';
        const start = Math.min(this.manualSelection.start, this.manualSelection.end);
        const end = Math.max(this.manualSelection.start, this.manualSelection.end);
        return this.state.words.slice(start, end + 1).map(w => w.text).join(' ').trim();
    }

    renderManualSelectionRange() {
        if (this.manualSelection.start === null || this.manualSelection.end === null) return;
        const start = Math.min(this.manualSelection.start, this.manualSelection.end);
        const end = Math.max(this.manualSelection.start, this.manualSelection.end);

        this.wordBoxes.forEach((box, idx) => {
            box.classList.toggle('manual-selected', idx >= start && idx <= end);
        });
    }

    getWordBoxIndexFromPoint(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el || !el.classList || !el.classList.contains('word-box')) return null;
        const idx = Number.parseInt(el.dataset.index ?? '', 10);
        return Number.isFinite(idx) ? idx : null;
    }

    async start() {
        this.clara.ui.showInlineLoading('Preparing to read...');

        try {
            // Always sync to the page currently visible in the viewport before reading.
            if (document.querySelector('.continuous-pages-container')) {
                if (this.forceStartPage !== null && this.forceStartPage !== undefined) {
                    this.state.viewerCurrentPage = this.forceStartPage;
                } else {
                    this.clara.viewer.updateCurrentPageFromScroll();
                }
                this.clara.viewer.updatePageIndicator();
                this.clara.viewer.setActiveThumbnail(this.state.viewerCurrentPage);
            }

            // RESET STATE for fresh start
            this.wordBoxes = [];
            this.wordTimings = [];
            this.lastHighlightedIndex = -1;
            this.lastTimingCheck = 0;

            const hasSession = this.hasSession(this.state.viewerDocId, this.state.viewerCurrentPage);

            if (hasSession) {
                this.restoreSession();
            } else {
                // Fetch words for positioning
                const wordsRes = await fetch(`/document/${this.state.viewerDocId}/page/${this.state.viewerCurrentPage}/words`);
                const wordsData = await wordsRes.json();

                if (wordsData.error) {
                    this.clara.ui.showToast(wordsData.error, true);
                    this.clara.ui.hideInlineLoading();
                    return;
                }

                this.state.currentDocId = this.state.viewerDocId;
                this.state.currentDocName = this.state.viewerDocName;

                // Use words for positioning overlay (exact coordinates)
                if (wordsData.words && wordsData.words.length > 0) {
                    this.state.words = wordsData.words;
                } else {
                    this.clara.ui.showToast('No text found on this page', true);
                    this.clara.ui.hideInlineLoading();
                    return;
                }

                // CRITICAL: Build page text from words to ensure 1:1 match
                this.state.pageText = this.state.words.map(w => w.text).join(' ');

                // Always start from beginning unless resuming
                this.state.currentWordIndex = this.pendingWordIndex || 0;
            }

            console.log('[Reading] Starting with', this.state.words.length, 'words');

            // Set up UI first
            this.enterReadingMode();
            await this.createWordOverlay();

            if (hasSession) {
                this.applyReadWordsFromSession();
            }

            this.updateProgress();
            this.updatePageNav();

            // Generate audio and start playback
            this.clara.ui.showInlineLoading('Generating audio...');
            await this.generateAudioInBackground();
            this.forceStartPage = null;

        } catch (err) {
            console.error('[Reading] Start failed:', err);
            this.clara.ui.showToast('Failed to start reading: ' + err.message, true);
            this.clara.ui.hideInlineLoading();
            this.forceStartPage = null;
        }
    }

    async generateAudioInBackground() {
        // Generate audio and start playback when ready
        if (this.state.words.length === 0) {
            this.clara.ui.hideInlineLoading();
            return;
        }

        // SIMPLE: Always use word text directly - no complex pageText handling
        const textToRead = this.state.words.map(w => w.text).join(' ');
        const wordCount = this.state.words.length;

        console.log('[AudioGen] Generating for', wordCount, 'words');

        try {
            const res = await fetch('/play-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: textToRead,
                    voice: this.state.selectedVoice
                })
            });

            if (!res.ok) {
                const err = await res.json();
                this.clara.ui.showToast(err.error || 'Playback failed', true);
                this.clara.ui.hideInlineLoading();
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            this.audio.src = url;
            this.audio.playbackRate = this.state.playbackSpeed;

            // Fetch word timings from backend
            await this.fetchActualWordTimings();

            console.log('[AudioGen] Got', this.wordTimings.length, 'timings for', this.state.words.length, 'words');

            // Resume from saved position if needed
            const resumeWordIndex = this.state.currentWordIndex;
            if (resumeWordIndex > 0 && resumeWordIndex < this.wordTimings.length) {
                const timing = this.wordTimings[resumeWordIndex];
                if (timing) {
                    console.log('[AudioGen] Resuming from word', resumeWordIndex);
                    this.audio.currentTime = timing.start;
                }
            }

            // START PLAYBACK
            this.audio.play();
            this.clara.ui.hideInlineLoading();

            // Highlight first word immediately
            if (this.state.currentWordIndex === 0 && this.wordBoxes.length > 0) {
                this.highlightWord(0);
            }

            // Preload next page
            this.preloadNextPageAudio();

        } catch (err) {
            console.error('[AudioGen] Failed:', err);
            this.clara.ui.showToast('Playback failed: ' + err.message, true);
            this.clara.ui.hideInlineLoading();
        }
    }

    enterReadingMode() {
        this.state.isReadingMode = true;

        document.getElementById('browse-controls').classList.add('hidden');
        document.getElementById('reading-controls').classList.remove('hidden');
        // Q&A section is now controlled by the toggle button, not reading mode

        this.clara.navigation.updateTitle();
    }

    stop() {
        this.saveSession();

        if (this.state.isPlaying) {
            this.pause();
        }

        // CRITICAL: Complete cleanup
        this.stopAnimationFrameSync();
        this.state.isReadingMode = false;
        this.state.isPlaying = false;
        this.clearPreloadedAudio();

        // Reset all sync state
        this.wordBoxes = [];
        this.wordTimings = [];
        this.lastHighlightedIndex = -1;
        this.lastTimingCheck = 0;
        this.state.currentWordIndex = 0;

        // Clean up the reading wrapper
        this.cleanupReadingWrapper();

        document.getElementById('browse-controls').classList.remove('hidden');
        document.getElementById('reading-controls').classList.add('hidden');
        // Q&A section is now controlled by the toggle button, not reading mode

        this.clara.navigation.updateTitle();
        this.clara.viewer.updateReadButtonText();
    }

    async nextPage() {
        if (this.state.viewerCurrentPage >= this.state.viewerPageCount - 1) {
            this.clara.ui.showToast('This is the last page');
            return;
        }

        this.saveSession();

        // CRITICAL: Stop all sync before page change
        this.stopAnimationFrameSync();

        if (this.state.isPlaying) {
            this.audio.pause();
        }

        // Store reference to old page wrapper BEFORE incrementing page
        const oldPageNum = this.state.viewerCurrentPage;
        const oldWrapper = document.querySelector(`.page-image-wrapper.reading-mode[data-reading-page="${oldPageNum}"]`);

        // CRITICAL: Complete state reset for new page
        this.wordBoxes = [];
        this.wordTimings = [];
        this.lastHighlightedIndex = -1;
        this.lastTimingCheck = 0;

        this.state.viewerCurrentPage++;

        // In continuous mode, just scroll to the next page
        // loadPage will handle scrolling without reloading
        await this.clara.viewer.loadPage(this.state.viewerCurrentPage);

        this.clara.viewer.updatePageIndicator();
        this.clara.viewer.setActiveThumbnail(this.state.viewerCurrentPage);

        this.state.readingSession = null;
        this.state.currentWordIndex = 0;

        // Start loading new page FIRST, then cleanup old wrapper
        if (this.preloadedAudio.pageNum === this.state.viewerCurrentPage && this.preloadedAudio.audioBlob) {
            await this.usePreloadedAudio();
        } else {
            this.state.words = [];
            await this.start();
        }

        // NOW cleanup the old page wrapper (after new page is ready)
        if (oldWrapper) {
            this.cleanupOldPageWrapper(oldWrapper);
        }

        // Sync page change to study session
        this.clara.studySession?.syncPageChange(this.state.viewerCurrentPage);
    }

    cleanupReadingWrapper() {
        // Remove the reading wrapper and restore the page to browse mode
        const wrapper = document.querySelector('.page-image-wrapper.reading-mode');
        if (!wrapper) return;
        this.cleanupOldPageWrapper(wrapper);
    }

    cleanupOldPageWrapper(wrapper) {
        // Remove a specific reading wrapper and restore the page
        if (!wrapper) return;

        const img = wrapper.querySelector('img');
        const parent = wrapper.parentNode;

        if (!parent) return;

        // Check if we're in continuous mode - could be directly in continuous-page
        // OR nested inside a browse wrapper that's in continuous-page
        let inContinuousMode = parent.classList.contains('continuous-page');

        // Check if parent is a browse wrapper inside continuous-page (nested structure)
        if (!inContinuousMode && parent.classList.contains('page-image-wrapper') && parent.classList.contains('browse-mode')) {
            const grandparent = parent.parentNode;
            if (grandparent && grandparent.classList.contains('continuous-page')) {
                // Reading wrapper is nested inside browse wrapper
                // Move img back to browse wrapper and remove reading wrapper
                if (img) {
                    parent.insertBefore(img, wrapper);
                }
                wrapper.remove();
                return;
            }
        }

        if (inContinuousMode) {
            // In continuous mode, check if there's already a browse wrapper
            const existingBrowseWrapper = parent.querySelector('.page-image-wrapper.browse-mode');

            if (existingBrowseWrapper) {
                // Browse wrapper exists, just remove the reading wrapper
                wrapper.remove();
            } else if (img) {
                // No browse wrapper, restore image directly to the page
                parent.insertBefore(img, wrapper);
                wrapper.remove();
            }
        } else {
            // In single-page mode, move img back to page-content
            const pageContent = document.getElementById('page-content');
            if (img && pageContent) {
                pageContent.appendChild(img);
            }
            wrapper.remove();
        }
    }

    async usePreloadedAudio() {
        this.state.words = this.preloadedAudio.words;
        this.state.pageText = this.preloadedAudio.pageText;
        this.state.isReadingMode = true;
        this.state.currentWordIndex = 0;
        this.lastHighlightedIndex = -1;

        document.getElementById('browse-controls').classList.add('hidden');
        document.getElementById('reading-controls').classList.remove('hidden');
        document.getElementById('question-section').classList.remove('hidden');

        await this.createWordOverlay();

        this.updatePageNav();
        this.clara.navigation.updateTitle();

        const url = URL.createObjectURL(this.preloadedAudio.audioBlob);
        this.audio.src = url;
        this.audio.playbackRate = this.state.playbackSpeed;

        // CRITICAL: Use ACTUAL timings for preloaded audio, not estimation
        // This ensures perfect sync even on preloaded pages
        await this.fetchActualWordTimings();

        this.audio.play();

        this.clearPreloadedAudio();
        this.preloadNextPageAudio();
    }

    async previousPage() {
        if (this.state.viewerCurrentPage <= 0) {
            this.clara.ui.showToast('This is the first page');
            return;
        }

        this.saveSession();

        // CRITICAL: Stop all sync before page change
        this.stopAnimationFrameSync();

        if (this.state.isPlaying) {
            this.audio.pause();
        }

        // Store reference to old page wrapper BEFORE changing page
        const oldPageNum = this.state.viewerCurrentPage;
        const oldWrapper = document.querySelector(`.page-image-wrapper.reading-mode[data-reading-page="${oldPageNum}"]`);

        // CRITICAL: Complete state reset for new page
        this.wordBoxes = [];
        this.wordTimings = [];
        this.lastHighlightedIndex = -1;
        this.lastTimingCheck = 0;

        this.state.viewerCurrentPage--;

        // In continuous mode, just scroll to the previous page
        // loadPage will handle scrolling without reloading
        await this.clara.viewer.loadPage(this.state.viewerCurrentPage);

        this.clara.viewer.updatePageIndicator();
        this.clara.viewer.setActiveThumbnail(this.state.viewerCurrentPage);

        // Start new page FIRST, then cleanup old
        await this.start();

        // NOW cleanup the old page wrapper (after new page is ready)
        if (oldWrapper) {
            this.cleanupOldPageWrapper(oldWrapper);
        }

        // Sync page change to study session
        this.clara.studySession?.syncPageChange(this.state.viewerCurrentPage);
    }

    updatePageNav() {
        const prevBtn = document.getElementById('btn-read-prev');
        const nextBtn = document.getElementById('btn-read-next');

        prevBtn.disabled = this.state.viewerCurrentPage <= 0;
        nextBtn.disabled = this.state.viewerCurrentPage >= this.state.viewerPageCount - 1;
    }

    async createWordOverlay() {
        // Clean up existing reading wrapper (not browse wrappers)
        const existingWrapper = document.querySelector('.page-image-wrapper.reading-mode');
        if (existingWrapper) {
            this.cleanupReadingWrapper();
        }

        this.wordBoxes = [];
        this.lastHighlightedIndex = -1;

        // Find the correct page - either in continuous mode or single page mode
        let pageContainer, img;
        const currentPageNum = this.state.viewerCurrentPage;

        // Check if we're in continuous scroll mode
        const continuousPage = document.getElementById(`page-${currentPageNum}`);
        if (continuousPage) {
            // Continuous mode: find the image within the specific page
            pageContainer = continuousPage;
            img = continuousPage.querySelector('img');
        } else {
            // Single page mode: use page-content
            pageContainer = document.getElementById('page-content');
            img = pageContainer ? pageContainer.querySelector('img') : null;
        }

        if (!img) {
            console.warn('[Overlay] No image found for word overlay on page', currentPageNum);
            return;
        }

        // Ensure image is loaded before measuring - CSS percentages need correct container size
        if (!img.complete || img.naturalWidth === 0) {
            console.log('[Overlay] Waiting for image to load...');
            await new Promise(resolve => {
                img.onload = resolve;
                // Fallback timeout
                setTimeout(resolve, 1000);
            });
        }

        console.log(`[Overlay] Image natural size: ${img.naturalWidth}x${img.naturalHeight}, displayed: ${img.clientWidth}x${img.clientHeight}`);

        const wrapper = document.createElement('div');
        wrapper.className = 'page-image-wrapper reading-mode';
        wrapper.dataset.readingPage = currentPageNum;

        const overlay = document.createElement('div');
        overlay.id = 'word-highlight-overlay';
        overlay.className = 'word-highlight-overlay';

        overlay.addEventListener('contextmenu', (e) => {
            if (e.target !== overlay) return;
            const selectedText =
                window.getSelection().toString().trim() ||
                this.getManualSelectionText();
            this.clara.contextMenu.showPdf(e, null, selectedText);
        });
        this.clara.contextMenu.attachPdfLongPress(overlay, () => ({
            target: overlay,
            wordIndex: null,
            selectedText: window.getSelection().toString().trim() || this.getManualSelectionText()
        }));

        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);
        wrapper.appendChild(overlay);

        // CRITICAL: Filter words to only those with coordinates FIRST
        // Then use filtered array consistently everywhere
        const wordsWithCoords = this.state.words.filter(w => w.x !== undefined && w.y !== undefined);

        // Update state.words to filtered version so everything is aligned
        if (wordsWithCoords.length !== this.state.words.length) {
            console.log('[Overlay] Filtered', this.state.words.length, 'words to', wordsWithCoords.length, 'with coordinates');
            this.state.words = wordsWithCoords;
            // Rebuild pageText to match
            this.state.pageText = wordsWithCoords.map(w => w.text).join(' ');
        }

        // Create word boxes using DocumentFragment for performance
        const fragment = document.createDocumentFragment();

        this.state.words.forEach((word, idx) => {
            const box = document.createElement('div');
            box.className = 'word-box';
            box.dataset.index = idx;
            box.dataset.word = word.text || '';
            box.style.cssText = `left:${word.x}%;top:${word.y}%;width:${word.w}%;height:${word.h}%`;

            box.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.clara.dictionary.lookup(word.text, box);
            });

            // In focus mode, single click gives quick meaning without extra UI hops.
            box.addEventListener('click', (e) => {
                const focusMode = this.clara.settings?.getReadingSetting('focusMode') ?? false;
                if (!focusMode) return;
                if (window.getSelection().toString().trim()) return;
                e.stopPropagation();
                this.clara.dictionary.lookup(word.text, box);
            });

            box.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                const selectedText =
                    window.getSelection().toString().trim() ||
                    this.getManualSelectionText();
                this.clara.contextMenu.showPdf(e, idx, selectedText || word.text);
            });
            this.clara.contextMenu.attachPdfLongPress(box, () => ({
                target: box,
                wordIndex: idx,
                selectedText: window.getSelection().toString().trim() || this.getManualSelectionText() || word.text
            }));

            box.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (window.getSelection().toString().trim()) return;
                this.manualSelection.active = true;
                this.manualSelection.start = idx;
                this.manualSelection.end = idx;
                this.renderManualSelectionRange();
            });

            box.addEventListener('mouseenter', () => {
                if (!this.manualSelection.active) return;
                this.manualSelection.end = idx;
                this.renderManualSelectionRange();
            });

            box.addEventListener('touchstart', (e) => {
                if (!e.touches || e.touches.length !== 1) return;
                if (window.getSelection().toString().trim()) return;
                this.manualSelection.active = true;
                this.manualSelection.start = idx;
                this.manualSelection.end = idx;
                this.renderManualSelectionRange();
            }, { passive: true });

            box.addEventListener('touchmove', (e) => {
                if (!this.manualSelection.active) return;
                if (!e.touches || e.touches.length !== 1) return;
                const touch = e.touches[0];
                const touchedIdx = this.getWordBoxIndexFromPoint(touch.clientX, touch.clientY);
                if (touchedIdx === null) return;
                this.manualSelection.end = touchedIdx;
                this.renderManualSelectionRange();
            }, { passive: true });

            fragment.appendChild(box);
            this.wordBoxes.push(box);
        });

        overlay.appendChild(fragment);

        // Debug: Log first few word positions to verify accuracy
        if (this.state.words.length > 0) {
            console.log(`[ReadingOverlay] Created ${this.wordBoxes.length} word boxes on page ${currentPageNum}`);
            const sampleWords = this.state.words.slice(0, 5);
            console.log('[ReadingOverlay] Sample positions:', sampleWords.map(w =>
                `"${w.text}" at (${w.x?.toFixed(1)}%, ${w.y?.toFixed(1)}%) size ${w.w?.toFixed(1)}x${w.h?.toFixed(1)}%`
            ));
        }

        // Keep note tags synced with current reading page overlay.
        this.clara.notes.renderMarkers();
    }

    tokenizeText(text) {
        const words = [];
        const regex = /(\S+)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            words.push({
                text: match[1],
                start: match.index,
                end: match.index + match[1].length
            });
        }

        return words;
    }

    async playPageAudio() {
        if (this.state.words.length === 0) {
            this.clara.ui.showToast('No text to read on this page', true);
            return;
        }

        // Use full audio for perfect word synchronization
        // Backend caching makes subsequent plays instant
        // This ensures accurate word highlighting, overlays, and progress tracking
        return this.playPageAudioFull();
    }

    async playPageAudioFull() {
        const wordCount = this.state.words.length;
        const estimatedTime = Math.ceil(wordCount / 10); // ~10 words per second generation

        if (wordCount > 300) {
            this.clara.ui.showInlineLoading(`Generating audio (large page, ~${estimatedTime}s)...`);
        } else {
            this.clara.ui.showInlineLoading('Generating audio...');
        }

        // Add a timeout warning for very long pages
        let warningShown = false;
        const warningTimeout = setTimeout(() => {
            if (!warningShown && wordCount > 400) {
                this.clara.ui.showInlineLoading('Still generating... large pages take longer');
                warningShown = true;
            }
        }, 20000); // Show warning after 20 seconds

        // Reset timing correction for new audio
        this.lastTimingCheck = 0;
        this.timingDriftCorrection = 0;

        // Preserve the current word index before generating new audio
        const resumeWordIndex = this.state.currentWordIndex;
        console.log('[PlayAudioFull] Resuming from word index:', resumeWordIndex);

        // Limit words to match backend limit (500 words)
        const MAX_WORDS = 500;
        let wordsToHighlight = this.state.words;
        let textToRead;

        if (this.state.words.length > MAX_WORDS) {
            console.log('[PlayAudioFull] Limiting from', this.state.words.length, 'to', MAX_WORDS, 'words');
            wordsToHighlight = this.state.words.slice(0, MAX_WORDS);
        }

        // CRITICAL: Always build text from exact words to ensure 1:1 sync
        textToRead = wordsToHighlight.map(w => w.text).join(' ');

        try {
            const res = await fetch('/play-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: textToRead,
                    voice: this.state.selectedVoice
                })
            });

            if (!res.ok) {
                const err = await res.json();
                this.clara.ui.showToast(err.error || 'Playback failed', true);
                this.clara.ui.hideInlineLoading();
                return;
            }

            // Clear the warning timeout since we got the audio
            clearTimeout(warningTimeout);

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            this.audio.src = url;
            this.audio.playbackRate = this.state.playbackSpeed;

            // Temporarily use limited words for timing
            const originalWords = this.state.words;
            this.state.words = wordsToHighlight;

            // Use ACTUAL word timings from Edge TTS for 100% accuracy
            // Falls back to estimation if Edge TTS not available
            await this.fetchActualWordTimings();

            // Restore full words list (but timing only covers first MAX_WORDS)
            this.state.words = originalWords;

            // Use the preserved index for seeking (but only if within range)
            if (resumeWordIndex > 0 && resumeWordIndex < wordsToHighlight.length && this.wordTimings.length > resumeWordIndex) {
                const timing = this.wordTimings[resumeWordIndex];
                if (timing) {
                    console.log('[PlayAudioFull] Seeking to time:', timing.start, 'for word index:', resumeWordIndex);
                    this.audio.currentTime = timing.start;
                    // Update the state to reflect the resume position
                    this.state.currentWordIndex = resumeWordIndex;
                }
            }

            this.audio.play();
            this.clara.ui.hideInlineLoading();

            // Preload next page in background
            this.preloadNextPageAudio();

        } catch (err) {
            this.clara.ui.showToast('Playback failed: ' + err.message, true);
            this.clara.ui.hideInlineLoading();
        }
    }

    async playPageAudioChunked() {
        this.clara.ui.showInlineLoading('Starting...');

        // Reset timing correction for new audio
        this.lastTimingCheck = 0;
        this.timingDriftCorrection = 0;

        // Preserve the current word index before generating new audio
        const resumeWordIndex = this.state.currentWordIndex;
        console.log('[PlayAudioChunked] Resuming from word index:', resumeWordIndex);

        try {
            // Reset chunked playback state
            this.audioChunks = [];
            this.currentChunkIndex = 0;
            this.totalChunks = 0;

            // Load first chunk to start immediately
            const firstChunkRes = await fetch('/play-text-chunked', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: this.state.pageText,
                    voice: this.state.selectedVoice,
                    chunk_index: 0
                })
            });

            if (!firstChunkRes.ok) {
                const err = await firstChunkRes.json();
                this.clara.ui.showToast(err.error || 'Playback failed', true);
                this.clara.ui.hideInlineLoading();
                return;
            }

            this.totalChunks = parseInt(firstChunkRes.headers.get('X-Total-Chunks') || '1');
            const firstBlob = await firstChunkRes.blob();
            this.audioChunks[0] = URL.createObjectURL(firstBlob);

            // Start playing first chunk immediately
            this.audio.src = this.audioChunks[0];
            this.audio.playbackRate = this.state.playbackSpeed;

            await this.estimateWordTimings();

            // Use the preserved index for seeking
            if (resumeWordIndex > 0 && this.wordTimings.length > resumeWordIndex) {
                const timing = this.wordTimings[resumeWordIndex];
                if (timing) {
                    console.log('[PlayAudioChunked] Seeking to time:', timing.start, 'for word index:', resumeWordIndex);
                    this.audio.currentTime = timing.start;
                    // Update the state to reflect the resume position
                    this.state.currentWordIndex = resumeWordIndex;
                }
            }

            this.audio.play();
            this.clara.ui.hideInlineLoading();

            // Load remaining chunks in background if there are more
            if (this.totalChunks > 1) {
                this.loadRemainingChunks();
            }

            // Set up event listener for when first chunk ends
            if (this.totalChunks > 1) {
                const handleChunkEnd = () => {
                    this.playNextChunk();
                };
                this.audio.addEventListener('ended', handleChunkEnd, { once: true });
            }

        } catch (err) {
            this.clara.ui.showToast('Playback failed: ' + err.message, true);
            this.clara.ui.hideInlineLoading();
        }
    }

    async loadRemainingChunks() {
        if (this.isLoadingChunks) return;
        this.isLoadingChunks = true;

        // Load all remaining chunks in parallel
        const promises = [];
        for (let i = 1; i < this.totalChunks; i++) {
            promises.push(this.loadChunk(i));
        }

        try {
            await Promise.all(promises);
            console.log(`Loaded ${this.totalChunks} chunks`);
        } catch (err) {
            console.error('Failed to load some chunks:', err);
        }

        this.isLoadingChunks = false;
    }

    async loadChunk(index) {
        try {
            const res = await fetch('/play-text-chunked', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: this.state.pageText,
                    voice: this.state.selectedVoice,
                    chunk_index: index
                })
            });

            if (res.ok) {
                const blob = await res.blob();
                this.audioChunks[index] = URL.createObjectURL(blob);
            }
        } catch (err) {
            console.error(`Failed to load chunk ${index}:`, err);
        }
    }

    playNextChunk() {
        this.currentChunkIndex++;

        if (this.currentChunkIndex < this.totalChunks && this.audioChunks[this.currentChunkIndex]) {
            // Play next chunk
            this.audio.src = this.audioChunks[this.currentChunkIndex];
            this.audio.playbackRate = this.state.playbackSpeed;
            this.audio.play();

            // Set up listener for next chunk if there are more
            if (this.currentChunkIndex < this.totalChunks - 1) {
                const handleChunkEnd = () => {
                    this.playNextChunk();
                };
                this.audio.addEventListener('ended', handleChunkEnd, { once: true });
            }
        }
    }

    async preloadNextPageAudio() {
        const nextPage = this.state.viewerCurrentPage + 1;

        if (nextPage >= this.state.viewerPageCount) return;
        if (this.preloadedAudio.pageNum === nextPage) return;
        if (this.preloadedAudio.isLoading) return;

        this.preloadedAudio.isLoading = true;

        try {
            const wordsRes = await fetch(`/document/${this.state.viewerDocId}/page/${nextPage}/words`);
            const wordsData = await wordsRes.json();

            if (!wordsData.words || wordsData.words.length === 0) {
                this.preloadedAudio.isLoading = false;
                return;
            }

            const pageText = wordsData.words.map(w => w.text).join(' ');

            const audioRes = await fetch('/play-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: pageText,
                    voice: this.state.selectedVoice
                })
            });

            if (!audioRes.ok) {
                this.preloadedAudio.isLoading = false;
                return;
            }

            const audioBlob = await audioRes.blob();

            this.preloadedAudio = {
                pageNum: nextPage,
                audioBlob: audioBlob,
                words: wordsData.words,
                pageText: pageText,
                isLoading: false
            };

            console.log(`Preloaded audio for page ${nextPage + 1}`);

        } catch (err) {
            console.log('Preload failed:', err);
            this.preloadedAudio.isLoading = false;
        }
    }

    clearPreloadedAudio() {
        this.preloadedAudio = {
            pageNum: null,
            audioBlob: null,
            words: null,
            pageText: null,
            isLoading: false
        };
    }

    async estimateWordTimings() {
        const duration = await this.getAudioDuration();

        console.log('[WordTiming] Audio duration:', duration, 'seconds for', this.state.words.length, 'words');

        // More sophisticated word timing that accounts for TTS speech patterns
        const wordWeights = this.state.words.map((word, idx) => {
            const text = word.text;
            const prevWord = idx > 0 ? this.state.words[idx - 1].text : '';

            // Estimate syllables more accurately
            const syllables = this.estimateSyllables(text);

            // Base weight on syllables (more accurate than character count)
            // Average speaking rate is ~2.5 syllables per second
            let weight = syllables * 0.4;

            // Add significant pauses for punctuation
            if (/[.!?]$/.test(text)) {
                weight += 0.8; // Longer pause for sentence ends
            } else if (/[,;:]$/.test(text)) {
                weight += 0.4; // Medium pause for commas
            } else if (/[-–—]$/.test(text)) {
                weight += 0.2; // Small pause for dashes
            }

            // Start of sentence after punctuation gets slight delay
            if (idx > 0 && /[.!?]$/.test(prevWord)) {
                weight += 0.3;
            }

            // Longer words take more time
            if (text.length > 10) {
                weight += text.length * 0.05;
            }

            // Very short common words are faster
            if (/^(a|an|the|is|of|to|in|on|at|by|for|it)$/i.test(text)) {
                weight *= 0.6;
            }

            // Numbers and technical terms slower
            if (/\d/.test(text) || /[A-Z]{2,}/.test(text)) {
                weight *= 1.3;
            }

            return Math.max(weight, 0.15);
        });

        const totalWeight = wordWeights.reduce((sum, w) => sum + w, 0);

        // Distribute duration across words based on weights
        let currentTime = 0;
        this.wordTimings = wordWeights.map((weight, idx) => {
            const wordDuration = (weight / totalWeight) * duration;
            const timing = {
                start: currentTime,
                end: currentTime + wordDuration,
                word: this.state.words[idx].text
            };
            currentTime += wordDuration;
            return timing;
        });

        console.log('[WordTiming] First 5 words:', this.wordTimings.slice(0, 5).map(t =>
            `${t.word}: ${t.start.toFixed(2)}s-${t.end.toFixed(2)}s (${(t.end - t.start).toFixed(2)}s)`
        ));
    }

    estimateSyllables(word) {
        // Simple syllable estimation based on vowel groups
        word = word.toLowerCase().replace(/[^a-z]/g, '');
        if (word.length <= 3) return 1;

        // Count vowel groups
        const vowelGroups = word.match(/[aeiouy]+/g);
        let count = vowelGroups ? vowelGroups.length : 1;

        // Adjust for silent e
        if (word.endsWith('e') && count > 1) count--;

        // Adjust for common patterns
        if (word.endsWith('le') && count > 1) count++;
        if (word.match(/tion|sion|ture/)) count = Math.max(count, 2);

        return Math.max(count, 1);
    }

    async fetchActualWordTimings() {
        console.log('[WordTiming] Fetching ACTUAL timings from Edge TTS backend...');

        // Get text that matches our words exactly for timing request
        const textForTiming = this.state.words.map(w => w.text).join(' ');

        try {
            const res = await fetch('/word-timings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: textForTiming,  // Use exact word text for perfect match
                    voice: this.state.selectedVoice
                })
            });

            if (!res.ok) {
                console.warn('[WordTiming] Backend timing request failed, falling back to estimation');
                return await this.estimateWordTimings();
            }

            const backendResponse = await res.json();
            const backendTimings = Array.isArray(backendResponse)
                ? backendResponse
                : (backendResponse?.timings || []);

            // If no timings returned (Edge TTS not available), fall back to estimation
            if (!backendTimings || backendTimings.length === 0) {
                console.log('[WordTiming] No backend timings available, using estimation');
                return await this.estimateWordTimings();
            }

            console.log(`[WordTiming] Got ${backendTimings.length} word-level timings from backend`);
            console.log('[WordTiming] Our words:', this.state.words.length);

            // CRITICAL: Filter out punctuation-only items from backend
            const filteredBackend = backendTimings.filter(t => {
                const normalized = t.text.toLowerCase().replace(/[^a-z0-9]/g, '');
                return normalized.length > 0;
            });

            console.log(`[WordTiming] Filtered to ${filteredBackend.length} actual words`);

            // Get audio duration for fallback distribution
            const duration = await this.getAudioDuration();

            // IMPROVED MATCHING ALGORITHM
            this.wordTimings = [];

            const ourWords = this.state.words.map(w => ({
                original: w.text,
                normalized: w.text.toLowerCase().replace(/[^a-z0-9]/g, '')
            }));

            // If word counts match exactly, use 1:1 mapping (ideal case).
            if (filteredBackend.length === ourWords.length) {
                console.log('[WordTiming] ✓ Perfect 1:1 word count match!');
                for (let i = 0; i < ourWords.length; i++) {
                    const bt = filteredBackend[i];
                    this.wordTimings.push({
                        start: bt.offset,
                        end: bt.offset + bt.duration,
                        word: ourWords[i].original
                    });
                }
            } else {
                console.log('[WordTiming] Word count mismatch, using sequential matching + fallback');

                // Baseline timings by proportional length so every word always has a timing.
                const totalChars = Math.max(ourWords.reduce((sum, w) => sum + Math.max(w.original.length, 1), 0), 1);
                let fallbackCurrent = 0;
                this.wordTimings = ourWords.map((w) => {
                    const wordDuration = (Math.max(w.original.length, 1) / totalChars) * duration;
                    const timing = {
                        start: fallbackCurrent,
                        end: fallbackCurrent + wordDuration,
                        word: w.original
                    };
                    fallbackCurrent += wordDuration;
                    return timing;
                });

                // Overlay real backend timings in order using a forward-only pointer.
                let backendIndex = 0;
                const maxScanAhead = 16;

                for (let i = 0; i < ourWords.length; i++) {
                    const target = ourWords[i].normalized;
                    if (!target) continue;

                    let matchIdx = -1;
                    const scanLimit = Math.min(filteredBackend.length, backendIndex + maxScanAhead);

                    for (let k = backendIndex; k < scanLimit; k++) {
                        const candidate = filteredBackend[k].text.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (candidate === target) {
                            matchIdx = k;
                            break;
                        }
                    }

                    if (matchIdx !== -1) {
                        const bt = filteredBackend[matchIdx];
                        this.wordTimings[i] = {
                            start: bt.offset,
                            end: bt.offset + bt.duration,
                            word: ourWords[i].original
                        };
                        backendIndex = matchIdx + 1;
                    }
                }

                // Keep the timings aligned to word order and audio duration.
                this.normalizeTimings(duration);
            }

            console.log('[WordTiming] ✓ Matched timings to PDF words');
            console.log('[WordTiming] First 5:', this.wordTimings.slice(0, 5).map(t =>
                `"${t.word}" @ ${t.start.toFixed(2)}s (${(t.end-t.start).toFixed(2)}s)`
            ));

        } catch (err) {
            console.error('[WordTiming] Error fetching actual timings:', err);
            console.log('[WordTiming] Falling back to estimation');
            return await this.estimateWordTimings();
        }
    }

    // Ensure timings are sequential in word order and cover the full audio duration.
    normalizeTimings(duration) {
        if (this.wordTimings.length === 0) return;

        // Keep original array order (PDF word order). Never sort by start time.
        for (let i = 0; i < this.wordTimings.length; i++) {
            const t = this.wordTimings[i];
            if (!Number.isFinite(t.start) || t.start < 0) t.start = 0;
            if (!Number.isFinite(t.end) || t.end <= t.start) t.end = t.start + 0.05;
        }

        // Enforce monotonic progression while preserving word order.
        for (let i = 1; i < this.wordTimings.length; i++) {
            const prev = this.wordTimings[i - 1];
            const current = this.wordTimings[i];
            if (current.start < prev.end) {
                current.start = prev.end;
            }
            if (current.end <= current.start) {
                current.end = current.start + 0.05;
            }
        }

        // Scale to fit duration.
        const lastTiming = this.wordTimings[this.wordTimings.length - 1];
        if (duration > 0 && lastTiming.end > 0 && (lastTiming.end < duration * 0.9 || lastTiming.end > duration * 1.1)) {
            const scale = duration / lastTiming.end;
            for (const timing of this.wordTimings) {
                timing.start *= scale;
                timing.end *= scale;
            }
        }
    }

    getAudioDuration() {
        return new Promise((resolve) => {
            // Check if duration is already available
            if (this.audio.duration && !isNaN(this.audio.duration) && this.audio.duration > 0) {
                console.log('[Audio] Duration already available:', this.audio.duration);
                resolve(this.audio.duration);
                return;
            }

            // Set up listener for metadata
            const onMetadata = () => {
                console.log('[Audio] Metadata loaded, duration:', this.audio.duration);
                resolve(this.audio.duration);
            };

            this.audio.addEventListener('loadedmetadata', onMetadata, { once: true });

            // Also listen for canplaythrough as fallback
            this.audio.addEventListener('canplaythrough', () => {
                if (this.audio.duration && !isNaN(this.audio.duration)) {
                    console.log('[Audio] Canplaythrough, duration:', this.audio.duration);
                    resolve(this.audio.duration);
                }
            }, { once: true });

            // Timeout fallback - if we can't get duration, estimate based on word count
            setTimeout(() => {
                if (this.audio.duration && !isNaN(this.audio.duration)) {
                    resolve(this.audio.duration);
                } else {
                    // Estimate: ~150ms per word average
                    const estimatedDuration = this.state.words.length * 0.15;
                    console.warn('[Audio] Duration timeout, estimating:', estimatedDuration);
                    resolve(estimatedDuration);
                }
            }, 5000);
        });
    }

    startAnimationFrameSync() {
        if (this.syncRAF) return; // Already running

        // Reset timing check on start
        this.lastTimingCheck = 0;

        const syncLoop = () => {
            if (!this.state.isPlaying) {
                this.syncRAF = null;
                return;
            }

            this.updateWordHighlight();
            this.syncRAF = requestAnimationFrame(syncLoop);
        };

        this.syncRAF = requestAnimationFrame(syncLoop);

        // CRITICAL: Immediately validate position on sync start
        setTimeout(() => this.validateAndCorrectPosition(), 100);

        console.log('[Sync] Started animation frame sync (60 FPS)');
    }

    stopAnimationFrameSync() {
        if (this.syncRAF) {
            cancelAnimationFrame(this.syncRAF);
            this.syncRAF = null;
            console.log('[Sync] Stopped animation frame sync');
        }
    }

    updateWordHighlight() {
        if (!this.state.isReadingMode || !this.state.isPlaying) return;

        // Need both timings and word boxes to highlight
        if (this.wordTimings.length === 0 || this.wordBoxes.length === 0) {
            return;
        }

        const currentTime = this.audio.currentTime;

        // Check every second for drift and correct immediately
        if (currentTime - this.lastTimingCheck > 1) {
            this.recalibrateWordTiming(currentTime);
            this.lastTimingCheck = currentTime;
        }

        // Binary search for the word at current time
        let newWordIndex = this.findWordAtTime(currentTime);

        // Ensure we don't go beyond available word timings or boxes
        const maxIndex = Math.min(this.wordTimings.length, this.wordBoxes.length) - 1;
        newWordIndex = Math.min(newWordIndex, maxIndex);
        newWordIndex = Math.max(newWordIndex, 0);

        // CRITICAL FIX: Always highlight if index changed OR if first word hasn't been highlighted yet
        const needsHighlight = newWordIndex !== this.lastHighlightedIndex;

        if (needsHighlight && newWordIndex >= 0) {
            this.highlightWord(newWordIndex);
        }
    }

    recalibrateWordTiming(currentTime) {
        // CRITICAL: Detect AND CORRECT drift to ensure perfect sync
        const expectedIndex = this.state.currentWordIndex;
        const actualIndex = this.findWordAtTime(currentTime);

        const drift = Math.abs(actualIndex - expectedIndex);

        // ALWAYS correct any drift immediately - this is the key to perfect sync
        if (drift > 0 && actualIndex >= 0 && actualIndex < this.wordTimings.length) {
            if (drift > 1) {
                console.log('[Sync] Correcting drift:', actualIndex - expectedIndex, 'words at', currentTime.toFixed(2), 's');
            }
            // Force highlight to the CORRECT word based on audio time
            this.state.currentWordIndex = actualIndex;
            this.highlightWord(actualIndex);

            // If drift is significant (> 3 words), run more frequent checks
            if (drift > 3) {
                this.lastTimingCheck = currentTime - 0.5; // Check again in 0.5 seconds
            }
        }
    }

    findWordAtTime(currentTime) {
        // Binary search for the word at current time
        let left = 0;
        let right = this.wordTimings.length - 1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const timing = this.wordTimings[mid];

            if (currentTime >= timing.start && currentTime < timing.end) {
                return mid;
            } else if (currentTime < timing.start) {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }

        return Math.min(left, this.wordTimings.length - 1);
    }

    highlightWord(index) {
        if (!this.state.isReadingMode) return;

        // CRITICAL: Ensure word boxes exist
        if (this.wordBoxes.length === 0) {
            console.warn('[Highlight] No word boxes available');
            return;
        }

        // CRITICAL: Validate index is within bounds of WORD BOXES (what we actually highlight)
        if (index < 0 || index >= this.wordBoxes.length) {
            console.warn('[Highlight] Index out of bounds:', index, '/', this.wordBoxes.length);
            return;
        }

        // Log first highlight for debugging
        if (this.lastHighlightedIndex === -1) {
            console.log('[Highlight] First word highlight at index', index);
        }

        // Check reading settings
        const highlightEnabled = this.clara.settings?.getReadingSetting('highlightEnabled') ?? true;
        const showReadWords = this.clara.settings?.getReadingSetting('showReadWords') ?? true;

        // Only update changed boxes (incremental update)
        const prevIndex = this.lastHighlightedIndex;

        // Determine line boundaries for read-word overlays.
        const currentWord = this.state.words[index];
        const currentLineKey = this.getWordLineKey(currentWord, index);

        const prevWord = prevIndex >= 0 ? this.state.words[prevIndex] : null;
        const prevLineKey = prevWord ? this.getWordLineKey(prevWord, prevIndex) : null;
        const hasChangedLine = prevLineKey !== null && prevLineKey !== currentLineKey;

        if (hasChangedLine) {
            // Clear gray overlay from words on the previous line.
            for (let i = 0; i < this.wordBoxes.length; i++) {
                if (this.getWordLineKey(this.state.words[i], i) === prevLineKey) {
                    this.wordBoxes[i].classList.remove('read');
                }
            }
        }

        // Remove active from previous word
        if (prevIndex >= 0 && prevIndex < this.wordBoxes.length) {
            this.wordBoxes[prevIndex].classList.remove('active');
        }

        // Mark words on the current line before the active word as read.
        if (showReadWords && index > 0) {
            for (let i = 0; i < index && i < this.wordBoxes.length; i++) {
                if (this.getWordLineKey(this.state.words[i], i) === currentLineKey) {
                    this.wordBoxes[i].classList.add('read');
                }
            }
        }

        // Set current as active (if highlight setting enabled)
        if (index >= 0 && index < this.wordBoxes.length) {
            const currentBox = this.wordBoxes[index];
            if (highlightEnabled) {
                currentBox.classList.add('active');
            }
            currentBox.classList.remove('read');

            // Throttled scroll - only scroll if needed and not already scrolling
            this.scrollToWordIfNeeded(currentBox);
        }

        this.lastHighlightedIndex = index;
        this.state.currentWordIndex = index;
        this.updateProgress();
    }

    scrollToWordIfNeeded(box) {
        // Don't auto-scroll if user is manually scrolling
        if (this.isScrolling || this.userIsScrolling) return;

        const container = document.getElementById('document-display');
        if (!container) return;

        const boxRect = box.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const padding = 80;
        const isOutOfView = boxRect.top < containerRect.top + padding ||
                           boxRect.bottom > containerRect.bottom - padding;

        if (isOutOfView) {
            this.isScrolling = true;

            const targetScroll = container.scrollTop + (boxRect.top - containerRect.top) - (containerRect.height / 3);
            container.scrollTo({
                top: Math.max(0, targetScroll),
                behavior: 'auto' // Use 'auto' for instant scroll, less jank
            });

            // Reset scroll lock after a short delay
            setTimeout(() => {
                this.isScrolling = false;
            }, 100);
        }
    }

    seekToWord(wordIndex) {
        if (wordIndex < 0 || wordIndex >= this.wordTimings.length) return;

        const timing = this.wordTimings[wordIndex];
        if (timing) {
            // Set audio position FIRST
            this.audio.currentTime = timing.start;

            // Clear all visual states
            for (let i = 0; i < this.wordBoxes.length; i++) {
                this.wordBoxes[i].classList.remove('read');
                this.wordBoxes[i].classList.remove('active');
            }

            // Get the target word's line.
            const targetWord = this.state.words[wordIndex];
            const targetLineKey = this.getWordLineKey(targetWord, wordIndex);

            // Mark only words on the same line before the target word as read.
            for (let i = 0; i < wordIndex && i < this.wordBoxes.length; i++) {
                if (this.getWordLineKey(this.state.words[i], i) === targetLineKey) {
                    this.wordBoxes[i].classList.add('read');
                }
            }

            // Set target word as active
            if (wordIndex < this.wordBoxes.length) {
                this.wordBoxes[wordIndex].classList.add('active');
            }

            this.lastHighlightedIndex = wordIndex;
            this.state.currentWordIndex = wordIndex;

            // CRITICAL: Force immediate position validation after seek
            this.validateAndCorrectPosition();
        }
    }

    // CRITICAL: Validate current position and correct any mismatch
    validateAndCorrectPosition() {
        if (!this.audio || !this.wordTimings.length) return;

        const currentTime = this.audio.currentTime;
        const expectedIndex = this.state.currentWordIndex;
        const actualIndex = this.findWordAtTime(currentTime);

        if (actualIndex !== expectedIndex && actualIndex >= 0) {
            console.log('[Validate] Correcting position:', expectedIndex, '->', actualIndex);
            this.state.currentWordIndex = actualIndex;
            this.lastHighlightedIndex = actualIndex - 1;

            // Update visual highlight
            for (let i = 0; i < this.wordBoxes.length; i++) {
                this.wordBoxes[i].classList.remove('active');
            }
            if (actualIndex < this.wordBoxes.length) {
                this.wordBoxes[actualIndex].classList.add('active');
            }
        }
    }

    syncToCurrentWord() {
        if (!this.state.isReadingMode) return;

        // Reset user scrolling flag when sync is clicked
        this.userIsScrolling = false;
        clearTimeout(this.userScrollTimeout);

        // CRITICAL: Validate and correct position first
        this.validateAndCorrectPosition();

        const currentPageNum = this.state.viewerCurrentPage;
        const readingWrapper = document.querySelector(`.page-image-wrapper.reading-mode[data-reading-page="${currentPageNum}"]`);

        // Check if we're in continuous mode
        const continuousPage = document.getElementById(`page-${currentPageNum}`);

        if (continuousPage) {
            // In continuous mode, scroll to the reading page
            const container = document.getElementById('document-display');

            if (!readingWrapper || !container) return;

            // Calculate the position to scroll to - center the reading page
            const pageTop = continuousPage.offsetTop;
            const containerHeight = container.clientHeight;
            const targetScroll = pageTop - (containerHeight / 4); // Offset from top

            container.scrollTo({
                top: Math.max(0, targetScroll),
                behavior: 'smooth'
            });

            // Update the viewer state
            this.clara.viewer.updateCurrentPageFromScroll();
        } else {
            // In single page mode, just scroll to current word
            const index = this.state.currentWordIndex;
            if (index >= 0 && index < this.wordBoxes.length) {
                const currentBox = this.wordBoxes[index];
                const container = document.getElementById('document-display');

                if (container && currentBox) {
                    const boxRect = currentBox.getBoundingClientRect();
                    const containerRect = container.getBoundingClientRect();

                    const targetScroll = container.scrollTop + (boxRect.top - containerRect.top) - (containerRect.height / 2);
                    container.scrollTo({
                        top: Math.max(0, targetScroll),
                        behavior: 'smooth'
                    });
                }
            }
        }

        const syncBtn = document.getElementById('btn-sync-reading');
        if (syncBtn) {
            syncBtn.classList.add('syncing');
            setTimeout(() => syncBtn.classList.remove('syncing'), 300);
        }
    }

    updateProgress() {
        const progress = this.state.words.length > 0
            ? (this.state.currentWordIndex / this.state.words.length) * 100
            : 0;

        document.getElementById('reading-progress-fill').style.width = `${progress}%`;
        document.getElementById('reading-progress-text').textContent = `${Math.round(progress)}%`;
    }

    togglePlayPause() {
        if (this.state.isPlaying) {
            this.pause();
        } else {
            this.resume();
        }
    }

    pause() {
        this.audio.pause();
        this.state.isPlaying = false;
        this.stopAnimationFrameSync();
        this.updatePlayPauseButton();
        // Sync reading state to study session
        this.clara.studySession?.syncReadingState(false, this.state.currentWordIndex);
    }

    resume() {
        if (this.audio.src) {
            this.audio.play();
            this.startAnimationFrameSync();
            // CRITICAL: Validate position immediately on resume
            setTimeout(() => this.validateAndCorrectPosition(), 50);
        } else {
            this.playPageAudio();
        }
        this.state.isPlaying = true;
        this.updatePlayPauseButton();
        // Sync reading state to study session
        this.clara.studySession?.syncReadingState(true, this.state.currentWordIndex);
    }

    updatePlayPauseButton() {
        const playIcon = document.querySelector('#btn-play-pause .icon-play');
        const pauseIcon = document.querySelector('#btn-play-pause .icon-pause');

        if (this.state.isPlaying) {
            playIcon?.classList.add('hidden');
            pauseIcon?.classList.remove('hidden');
        } else {
            playIcon?.classList.remove('hidden');
            pauseIcon?.classList.add('hidden');
        }
    }

    async onAudioEnded() {
        this.state.isPlaying = false;
        this.updatePlayPauseButton();

        // Check auto-advance setting
        const autoAdvance = this.clara.settings?.getReadingSetting('autoAdvance') ?? true;

        // Check if there's a next page to read and auto-advance is enabled
        if (autoAdvance && this.state.viewerCurrentPage < this.state.viewerPageCount - 1) {
            console.log('[AudioEnded] Auto-advancing to next page');
            this.clara.ui.showToast('Moving to next page...');

            // Save current session before moving
            this.saveSession();

            // Small delay for user to see the transition
            await new Promise(resolve => setTimeout(resolve, 500));

            // Advance to next page
            await this.nextPage();
        } else if (this.state.viewerCurrentPage >= this.state.viewerPageCount - 1) {
            // Last page - finished reading document
            this.clara.ui.showToast('Finished reading document');
        } else {
            // Auto-advance disabled - just finished this page
            this.clara.ui.showToast('Page finished. Press next to continue.');
        }
    }

    saveSession() {
        if (this.state.currentDocId && this.state.words.length > 0) {
            this.state.readingSession = {
                docId: this.state.currentDocId,
                docName: this.state.currentDocName,
                pageNum: this.state.viewerCurrentPage,
                wordIndex: this.state.currentWordIndex,
                words: this.state.words,
                pageText: this.state.pageText,
                isPdf: this.state.isPdf,
                // CRITICAL: Also save timings for perfect restore
                wordTimings: this.wordTimings.length > 0 ? this.wordTimings : null,
                audioTime: this.audio ? this.audio.currentTime : 0
            };
            console.log('[Session] Saved at word', this.state.currentWordIndex, 'time', this.audio?.currentTime?.toFixed(2));
        }
    }

    hasSession(docId, pageNum) {
        return this.state.readingSession &&
               this.state.readingSession.docId === docId &&
               this.state.readingSession.pageNum === pageNum &&
               this.state.readingSession.wordIndex > 0;
    }

    restoreSession() {
        const session = this.state.readingSession;
        if (!session) return false;

        this.state.currentDocId = session.docId;
        this.state.currentDocName = session.docName;
        this.state.pageText = session.pageText;
        this.state.words = session.words;
        this.state.currentWordIndex = session.wordIndex;

        // CRITICAL: Restore timings if available for perfect sync
        if (session.wordTimings && session.wordTimings.length > 0) {
            this.wordTimings = session.wordTimings;
            console.log('[Session] Restored with', this.wordTimings.length, 'timings at word', session.wordIndex);
        }

        return true;
    }

    applyReadWordsFromSession() {
        const savedIndex = this.state.currentWordIndex;
        const savedLineKey = savedIndex >= 0
            ? this.getWordLineKey(this.state.words[savedIndex], savedIndex)
            : null;

        for (let i = 0; i < savedIndex && i < this.wordBoxes.length; i++) {
            if (savedLineKey !== null && this.getWordLineKey(this.state.words[i], i) === savedLineKey) {
                this.wordBoxes[i].classList.add('read');
            }
        }

        this.lastHighlightedIndex = savedIndex - 1;
    }

    async readFromWord(wordIndex, pageNum = null) {
        if (wordIndex === null || wordIndex === undefined) return;
        const commandId = ++this.readFromCommandId;
        const requestedWordIndex = Math.max(0, parseInt(wordIndex, 10) || 0);
        const currentPageBefore = this.state.viewerCurrentPage;
        const hasExplicitPage = Number.isInteger(pageNum) && pageNum >= 0 && pageNum < this.state.viewerPageCount;
        const targetPage = hasExplicitPage ? pageNum : currentPageBefore;

        if (hasExplicitPage) {
            this.forceStartPage = targetPage;
            this.state.viewerCurrentPage = targetPage;

            // Ensure the clicked page is actually loaded before reading overlay is built.
            if (typeof this.clara.viewer?.loadSinglePageLazy === 'function') {
                await this.clara.viewer.loadSinglePageLazy(targetPage);
                if (commandId !== this.readFromCommandId) return;
            }

            await this.clara.viewer.loadPage(targetPage);
            if (commandId !== this.readFromCommandId) return;

            const targetPageEl = document.getElementById(`page-${targetPage}`);
            if (targetPageEl) {
                targetPageEl.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
            this.clara.viewer.updatePageIndicator();
            this.clara.viewer.setActiveThumbnail(targetPage);
        } else {
            this.forceStartPage = null;
        }

        console.log('[ReadFromWord] Starting from word index:', requestedWordIndex, '/', this.state.words.length);

        this.pendingWordIndex = requestedWordIndex;

        // Preempt current playback immediately so latest "read from here" wins.
        if (this.audio && !this.audio.paused) {
            this.audio.pause();
        }
        this.state.isPlaying = false;

        // If command points to a different page while already reading, restart pipeline on that page.
        if (this.state.isReadingMode && targetPage !== currentPageBefore) {
            this.stop();
            this.state.readingSession = null;
        }

        if (!this.state.isReadingMode) {
            console.log('[ReadFromWord] Starting reading mode first...');
            // Ignore stale resume pointer when user explicitly asks to start from a word.
            this.state.readingSession = null;
            await this.start();
            if (commandId !== this.readFromCommandId) return;
        }

        // Wait for timings so seeking starts at the exact selected word.
        const waitUntil = Date.now() + 5000;
        while (this.wordTimings.length <= requestedWordIndex && Date.now() < waitUntil) {
            if (commandId !== this.readFromCommandId) return;
            await new Promise(resolve => setTimeout(resolve, 80));
        }
        if (commandId !== this.readFromCommandId) return;

        const wordMaxIndex = Math.max(0, (this.state.words?.length || 1) - 1);
        const timingMaxIndex = Math.max(0, (this.wordTimings?.length || 1) - 1);
        const clampedWordIndex = Math.min(requestedWordIndex, wordMaxIndex, timingMaxIndex);

        if (this.wordTimings.length > clampedWordIndex) {
            console.log('[ReadFromWord] Seeking to word', clampedWordIndex, 'at time:', this.wordTimings[clampedWordIndex].start, 's');
            this.seekToWord(clampedWordIndex);
            if (commandId === this.readFromCommandId) {
                this.audio.play().catch(() => {});
            }
        } else {
            console.log('[ReadFromWord] Word timings not ready yet, setting index manually');
            this.state.currentWordIndex = clampedWordIndex;
            for (let i = 0; i < clampedWordIndex && i < this.wordBoxes.length; i++) {
                this.wordBoxes[i].classList.add('read');
            }
        }

        if (commandId === this.readFromCommandId) {
            this.pendingWordIndex = null;
        }
    }

    async askQuestion() {
        const input = document.getElementById('question-input');
        const question = input.value.trim();

        if (!question) return;

        const wasPlaying = this.state.isPlaying;
        if (wasPlaying) this.pause();

        this.clara.ui.showInlineLoading('Thinking...');

        try {
            const requestBody = {
                question: question,
                page_num: this.state.viewerCurrentPage,
                page_text: this.state.pageText || '',
                doc_id: this.state.viewerDocId || ''
            };

            const res = await fetch('/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const data = await res.json();

            if (data.error && !data.fallback_answer) {
                this.clara.ui.showToast(data.error, true);
                this.clara.ui.hideInlineLoading();
                return;
            }

            const answerText = data.answer || data.fallback_answer || 'No answer found.';
            document.getElementById('answer-text').textContent = answerText;
            document.getElementById('answer-box').classList.remove('hidden');
            this.renderAnswerSources(question, answerText);

            this.state.lastQuestion = question;
            this.state.lastAnswer = answerText;

            input.value = '';
            this.clara.ui.hideInlineLoading();

        } catch (err) {
            this.clara.ui.showToast('Question failed: ' + err.message, true);
            this.clara.ui.hideInlineLoading();
        }
    }

    renderAnswerSources(question, answerText) {
        const sourcesEl = document.getElementById('answer-sources');
        if (!sourcesEl) return;

        const snippets = this.findSourceSnippets(this.state.pageText || '', `${question} ${answerText}`);

        if (snippets.length === 0) {
            sourcesEl.classList.add('hidden');
            sourcesEl.innerHTML = '';
            return;
        }

        sourcesEl.classList.remove('hidden');
        sourcesEl.innerHTML = `
            <div class="answer-sources-label">From this page</div>
            ${snippets.map((snippet, idx) => `
                <div class="answer-source-item">
                    <span class="answer-source-index">${idx + 1}.</span>
                    <span class="answer-source-text">${this.clara.ui.escapeHtml(snippet)}</span>
                </div>
            `).join('')}
        `;
    }

    findSourceSnippets(pageText, queryText) {
        if (!pageText || pageText.length < 20) return [];

        const words = (queryText || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 4);

        const unique = [...new Set(words)].slice(0, 8);
        if (unique.length === 0) return [];

        const rawSentences = pageText.split(/(?<=[.!?])\s+/);
        const scored = rawSentences.map(sentence => {
            const lower = sentence.toLowerCase();
            const score = unique.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
            return { sentence: sentence.trim(), score };
        }).filter(s => s.score > 0 && s.sentence.length > 20);

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, 2).map(s => s.sentence.length > 220 ? `${s.sentence.slice(0, 220)}...` : s.sentence);
    }

    getWordLineKey(word, index = -1) {
        if (!word) return `idx:${index}`;

        if (word.line_id !== undefined && word.line_id !== null) {
            return `line:${word.line_id}`;
        }

        if (word.block !== undefined && word.line !== undefined) {
            return `blk:${word.block}:line:${word.line}`;
        }

        if (typeof word.y === 'number') {
            // Fallback for legacy word data without explicit line id.
            return `y:${Math.round(word.y * 2) / 2}`;
        }

        return `idx:${index}`;
    }
}
