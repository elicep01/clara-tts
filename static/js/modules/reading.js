// Clara - Reading/TTS Module
// Handles text-to-speech, word highlighting, audio playback, and reading sessions

export class ReadingManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.audio = null;
        this.wordTimings = [];
        this.pendingWordIndex = null;

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

        // Timing correction
        this.lastTimingCheck = 0;
        this.timingDriftCorrection = 0;
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

        // Throttled timeupdate for performance
        this.audio.addEventListener('timeupdate', () => {
            this.updateWordHighlight();
        });

        this.audio.addEventListener('play', () => {
            this.state.isPlaying = true;
            this.updatePlayPauseButton();
        });

        this.audio.addEventListener('pause', () => {
            this.state.isPlaying = false;
            this.updatePlayPauseButton();
        });

        // Detect user manual scrolling during reading mode
        const documentDisplay = document.getElementById('document-display');
        documentDisplay.addEventListener('wheel', () => {
            if (this.state.isReadingMode) {
                this.userIsScrolling = true;
                clearTimeout(this.userScrollTimeout);
                this.userScrollTimeout = setTimeout(() => {
                    this.userIsScrolling = false;
                }, 2000); // User scroll lock for 2 seconds
            }
        }, { passive: true });

        documentDisplay.addEventListener('touchstart', () => {
            if (this.state.isReadingMode) {
                this.userIsScrolling = true;
                clearTimeout(this.userScrollTimeout);
                this.userScrollTimeout = setTimeout(() => {
                    this.userIsScrolling = false;
                }, 2000);
            }
        }, { passive: true });
    }

    async start() {
        this.clara.ui.showInlineLoading('Preparing to read...');

        try {
            const hasSession = this.hasSession(this.state.viewerDocId, this.state.viewerCurrentPage);

            if (hasSession) {
                this.restoreSession();
            } else {
                // Fetch words - single API call
                const wordsRes = await fetch(`/document/${this.state.viewerDocId}/page/${this.state.viewerCurrentPage}/words`);
                const wordsData = await wordsRes.json();

                if (wordsData.error) {
                    this.clara.ui.showToast(wordsData.error, true);
                    this.clara.ui.hideInlineLoading();
                    return;
                }

                this.state.currentDocId = this.state.viewerDocId;
                this.state.currentDocName = this.state.viewerDocName;

                if (wordsData.words && wordsData.words.length > 0) {
                    this.state.words = wordsData.words;
                    this.state.pageText = wordsData.words.map(w => w.text).join(' ');
                } else {
                    // Fallback to text extraction
                    const textRes = await fetch(`/document/${this.state.viewerDocId}/page/${this.state.viewerCurrentPage}/text`);
                    const textData = await textRes.json();
                    this.state.pageText = textData.text || '';
                    this.state.words = this.tokenizeText(this.state.pageText);
                }

                this.state.currentWordIndex = this.pendingWordIndex || 0;
            }

            this.enterReadingMode();
            this.createWordOverlay(); // Synchronous, fast

            if (hasSession) {
                this.applyReadWordsFromSession();
            }

            this.updateProgress();
            this.updatePageNav();
            this.clara.ui.hideInlineLoading();

            // Start audio generation (async, shows its own loading)
            this.playPageAudio();

        } catch (err) {
            this.clara.ui.showToast('Failed to start reading: ' + err.message, true);
            this.clara.ui.hideInlineLoading();
        }
    }

    enterReadingMode() {
        this.state.isReadingMode = true;

        document.getElementById('browse-controls').classList.add('hidden');
        document.getElementById('reading-controls').classList.remove('hidden');
        document.getElementById('question-section').classList.remove('hidden');

        this.clara.navigation.updateTitle();
    }

    stop() {
        this.saveSession();

        if (this.state.isPlaying) {
            this.pause();
        }

        this.state.isReadingMode = false;
        this.clearPreloadedAudio();
        this.wordBoxes = [];
        this.lastHighlightedIndex = -1;

        // Clean up the reading wrapper
        this.cleanupReadingWrapper();

        document.getElementById('browse-controls').classList.remove('hidden');
        document.getElementById('reading-controls').classList.add('hidden');
        document.getElementById('question-section').classList.add('hidden');

        this.clara.navigation.updateTitle();
        this.clara.viewer.updateReadButtonText();
    }

    async nextPage() {
        if (this.state.viewerCurrentPage >= this.state.viewerPageCount - 1) {
            this.clara.ui.showToast('This is the last page');
            return;
        }

        this.saveSession();

        if (this.state.isPlaying) {
            this.audio.pause();
        }

        // Clean up the reading wrapper from current page
        this.cleanupReadingWrapper();

        this.wordBoxes = [];
        this.lastHighlightedIndex = -1;

        this.state.viewerCurrentPage++;

        // In continuous mode, just scroll to the next page
        // loadPage will handle scrolling without reloading
        await this.clara.viewer.loadPage(this.state.viewerCurrentPage);

        document.querySelectorAll('.page-thumb').forEach(el => {
            el.classList.remove('active');
            if (parseInt(el.dataset.page) === this.state.viewerCurrentPage) {
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        this.state.readingSession = null;
        this.state.currentWordIndex = 0;

        if (this.preloadedAudio.pageNum === this.state.viewerCurrentPage && this.preloadedAudio.audioBlob) {
            await this.usePreloadedAudio();
        } else {
            this.state.words = [];
            await this.start();
        }
    }

    cleanupReadingWrapper() {
        // Remove the reading wrapper and restore the page to browse mode
        const wrapper = document.querySelector('.page-image-wrapper.reading-mode');
        if (!wrapper) return;

        const img = wrapper.querySelector('img');
        const parent = wrapper.parentNode;

        if (!parent) return;

        // Check if we're in continuous mode
        const inContinuousMode = parent.classList.contains('continuous-page');

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

        document.getElementById('browse-controls').classList.add('hidden');
        document.getElementById('reading-controls').classList.remove('hidden');
        document.getElementById('question-section').classList.remove('hidden');

        this.createWordOverlay();

        this.updatePageNav();
        this.clara.navigation.updateTitle();

        const url = URL.createObjectURL(this.preloadedAudio.audioBlob);
        this.audio.src = url;
        this.audio.playbackRate = this.state.playbackSpeed;

        await this.estimateWordTimings();
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

        if (this.state.isPlaying) {
            this.audio.pause();
        }

        // Clean up the reading wrapper from current page
        this.cleanupReadingWrapper();

        this.wordBoxes = [];
        this.lastHighlightedIndex = -1;

        this.state.viewerCurrentPage--;

        // In continuous mode, just scroll to the previous page
        // loadPage will handle scrolling without reloading
        await this.clara.viewer.loadPage(this.state.viewerCurrentPage);

        document.querySelectorAll('.page-thumb').forEach(el => {
            el.classList.remove('active');
            if (parseInt(el.dataset.page) === this.state.viewerCurrentPage) {
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        await this.start();
    }

    updatePageNav() {
        const prevBtn = document.getElementById('btn-read-prev');
        const nextBtn = document.getElementById('btn-read-next');

        prevBtn.disabled = this.state.viewerCurrentPage <= 0;
        nextBtn.disabled = this.state.viewerCurrentPage >= this.state.viewerPageCount - 1;
    }

    createWordOverlay() {
        // Clean up existing reading wrapper (not browse wrappers)
        const existingWrapper = document.querySelector('.page-image-wrapper.reading-mode');
        if (existingWrapper) {
            this.cleanupReadingWrapper();
        }

        this.wordBoxes = [];
        this.lastHighlightedIndex = -1;

        if (!this.state.isPdf) {
            return;
        }

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
            console.warn('No image found for word overlay on page', currentPageNum);
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'page-image-wrapper reading-mode';
        wrapper.dataset.readingPage = currentPageNum;

        const overlay = document.createElement('div');
        overlay.id = 'word-highlight-overlay';
        overlay.className = 'word-highlight-overlay';

        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);
        wrapper.appendChild(overlay);

        // Create word boxes using DocumentFragment for performance
        const fragment = document.createDocumentFragment();

        this.state.words.forEach((word, idx) => {
            if (word.x !== undefined && word.y !== undefined) {
                const box = document.createElement('div');
                box.className = 'word-box';
                box.dataset.index = idx;
                box.style.cssText = `left:${word.x}%;top:${word.y}%;width:${word.w}%;height:${word.h}%`;

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

                fragment.appendChild(box);
                this.wordBoxes.push(box);
            }
        });

        overlay.appendChild(fragment);
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

        // Always use full audio for accurate word timing
        // Chunked audio breaks word-level synchronization
        return this.playPageAudioFull();
    }

    async playPageAudioFull() {
        this.clara.ui.showInlineLoading('Generating audio...');

        // Reset timing correction for new audio
        this.lastTimingCheck = 0;
        this.timingDriftCorrection = 0;

        // Preserve the current word index before generating new audio
        const resumeWordIndex = this.state.currentWordIndex;
        console.log('[PlayAudioFull] Resuming from word index:', resumeWordIndex);

        // Limit words to match backend limit (500 words)
        const MAX_WORDS = 500;
        let textToRead = this.state.pageText;
        let wordsToHighlight = this.state.words;

        if (this.state.words.length > MAX_WORDS) {
            console.log('[PlayAudioFull] Limiting from', this.state.words.length, 'to', MAX_WORDS, 'words');
            wordsToHighlight = this.state.words.slice(0, MAX_WORDS);
            textToRead = wordsToHighlight.map(w => w.text).join(' ');
        }

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

            // Temporarily use limited words for timing estimation
            const originalWords = this.state.words;
            this.state.words = wordsToHighlight;

            await this.estimateWordTimings();

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

    getAudioDuration() {
        return new Promise((resolve) => {
            if (this.audio.duration && !isNaN(this.audio.duration)) {
                resolve(this.audio.duration);
            } else {
                this.audio.addEventListener('loadedmetadata', () => {
                    resolve(this.audio.duration);
                }, { once: true });
            }
        });
    }

    updateWordHighlight() {
        if (!this.state.isReadingMode || !this.state.isPlaying || this.wordTimings.length === 0) return;

        const currentTime = this.audio.currentTime;

        // Check more frequently for better sync (every 5 seconds instead of 10)
        if (currentTime - this.lastTimingCheck > 5) {
            this.recalibrateWordTiming(currentTime);
            this.lastTimingCheck = currentTime;
        }

        // Apply drift correction to find accurate word
        const adjustedTime = currentTime + this.timingDriftCorrection;

        // Binary search for better performance
        let newWordIndex = this.findWordAtTime(adjustedTime);

        // Ensure we don't go beyond available word timings
        newWordIndex = Math.min(newWordIndex, this.wordTimings.length - 1);

        if (newWordIndex !== this.state.currentWordIndex && newWordIndex >= 0) {
            this.highlightWord(newWordIndex);
        }
    }

    recalibrateWordTiming(currentTime) {
        // Check if we're significantly off from expected position
        const expectedIndex = this.state.currentWordIndex;
        const actualIndex = this.findWordAtTime(currentTime);

        const drift = actualIndex - expectedIndex;

        // Apply correction if we're more than 3 words off (was 5)
        if (Math.abs(drift) > 3) {
            const expectedTiming = this.wordTimings[expectedIndex];
            const actualTiming = this.wordTimings[actualIndex];

            if (expectedTiming && actualTiming) {
                const timeDrift = actualTiming.start - expectedTiming.start;

                // More aggressive correction (40% instead of 20%) for better sync
                this.timingDriftCorrection += timeDrift * 0.4;

                // Allow larger corrections (±3 seconds instead of ±2)
                this.timingDriftCorrection = Math.max(-3, Math.min(3, this.timingDriftCorrection));

                console.log('[Recalibration] Drift:', drift, 'words, Time drift:', timeDrift.toFixed(2), 's, Correction:', this.timingDriftCorrection.toFixed(2), 's');
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

        // Only update changed boxes (incremental update)
        const prevIndex = this.lastHighlightedIndex;

        // Remove active from previous
        if (prevIndex >= 0 && prevIndex < this.wordBoxes.length) {
            this.wordBoxes[prevIndex].classList.remove('active');
            this.wordBoxes[prevIndex].classList.add('read');
        }

        // Mark words between prev and current as read
        if (prevIndex >= 0) {
            for (let i = prevIndex + 1; i < index && i < this.wordBoxes.length; i++) {
                this.wordBoxes[i].classList.add('read');
            }
        }

        // Set current as active
        if (index >= 0 && index < this.wordBoxes.length) {
            const currentBox = this.wordBoxes[index];
            currentBox.classList.add('active');
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
            this.audio.currentTime = timing.start;

            // Update all words up to this point as read
            for (let i = 0; i <= wordIndex && i < this.wordBoxes.length; i++) {
                if (i < wordIndex) {
                    this.wordBoxes[i].classList.add('read');
                    this.wordBoxes[i].classList.remove('active');
                } else {
                    this.wordBoxes[i].classList.add('active');
                    this.wordBoxes[i].classList.remove('read');
                }
            }

            this.lastHighlightedIndex = wordIndex;
            this.state.currentWordIndex = wordIndex;
        }
    }

    syncToCurrentWord() {
        if (!this.state.isReadingMode) return;

        // Reset user scrolling flag when sync is clicked
        this.userIsScrolling = false;
        clearTimeout(this.userScrollTimeout);

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
        this.updatePlayPauseButton();
    }

    resume() {
        if (this.audio.src) {
            this.audio.play();
        } else {
            this.playPageAudio();
        }
        this.state.isPlaying = true;
        this.updatePlayPauseButton();
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

        // Check if there's a next page to read
        if (this.state.viewerCurrentPage < this.state.viewerPageCount - 1) {
            console.log('[AudioEnded] Auto-advancing to next page');
            this.clara.ui.showToast('Moving to next page...');

            // Save current session before moving
            this.saveSession();

            // Small delay for user to see the transition
            await new Promise(resolve => setTimeout(resolve, 500));

            // Advance to next page
            await this.nextPage();
        } else {
            // Last page - finished reading document
            this.clara.ui.showToast('Finished reading document');
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
                isPdf: this.state.isPdf
            };
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

        return true;
    }

    applyReadWordsFromSession() {
        const savedIndex = this.state.currentWordIndex;

        for (let i = 0; i < savedIndex && i < this.wordBoxes.length; i++) {
            this.wordBoxes[i].classList.add('read');
        }

        this.lastHighlightedIndex = savedIndex - 1;
    }

    async readFromWord(wordIndex) {
        if (wordIndex === null || wordIndex === undefined) return;

        console.log('[ReadFromWord] Starting from word index:', wordIndex, '/', this.state.words.length);

        this.pendingWordIndex = wordIndex;

        if (!this.state.isReadingMode) {
            console.log('[ReadFromWord] Starting reading mode first...');
            await this.start();
        }

        // Wait for audio to be ready
        await new Promise(resolve => setTimeout(resolve, 100));

        if (this.wordTimings.length > wordIndex) {
            console.log('[ReadFromWord] Seeking to word', wordIndex, 'at time:', this.wordTimings[wordIndex].start, 's');
            this.seekToWord(wordIndex);

            if (!this.state.isPlaying) {
                this.audio.play();
            }
        } else {
            console.log('[ReadFromWord] Word timings not ready yet, setting index manually');
            this.state.currentWordIndex = wordIndex;
            for (let i = 0; i < wordIndex && i < this.wordBoxes.length; i++) {
                this.wordBoxes[i].classList.add('read');
            }
        }

        this.pendingWordIndex = null;
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
                page_text: this.state.pageText || ''
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

            this.state.lastQuestion = question;
            this.state.lastAnswer = answerText;

            input.value = '';
            this.clara.ui.hideInlineLoading();

        } catch (err) {
            this.clara.ui.showToast('Question failed: ' + err.message, true);
            this.clara.ui.hideInlineLoading();
        }
    }
}