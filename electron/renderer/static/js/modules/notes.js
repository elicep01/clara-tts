// Clara - Notes Management Module
// Handles notes creation, editing, positioning, and rendering

export class NotesManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.pendingNewNoteDraft = null;
        this.noteDictation = {
            recognition: null,
            recorder: null,
            stream: null,
            chunks: [],
            mimeType: 'audio/webm',
            supported: false,
            active: false,
            baseText: '',
            finalText: '',
            interimText: '',
            style: 'study'
        };
        this.studyDraftAnchors = [];
        this.studyLastWordTarget = null;
        this.pageWordsCache = new Map();
    }

    setup() {
        document.getElementById('btn-toggle-notes').addEventListener('click', () => {
            this.toggleSidebar();
        });
        document.getElementById('btn-study-mode').addEventListener('click', () => {
            this.setStudyMode(!this.state.studyMode);
        });

        document.getElementById('btn-close-notes').addEventListener('click', () => {
            this.hideSidebar();
        });

        document.getElementById('btn-save-as-note').addEventListener('click', () => {
            this.saveAnswerAsNote();
        });

        document.getElementById('btn-cancel-note').addEventListener('click', () => {
            this.hideModal();
        });

        document.getElementById('btn-save-note').addEventListener('click', () => {
            this.save();
        });

        document.getElementById('btn-delete-note').addEventListener('click', () => {
            this.deleteCurrent();
        });

        document.getElementById('btn-dictate-note').addEventListener('click', async () => {
            await this.toggleNoteDictation();
        });

        document.getElementById('btn-clean-note').addEventListener('click', () => {
            this.cleanCurrentNoteText();
        });

        const styleSelect = document.getElementById('note-dictation-style');
        if (styleSelect) {
            const savedStyle = localStorage.getItem('note_dictation_style');
            if (savedStyle && ['study', 'verbatim', 'summary'].includes(savedStyle)) {
                this.noteDictation.style = savedStyle;
                styleSelect.value = savedStyle;
            } else {
                styleSelect.value = this.noteDictation.style;
            }

            styleSelect.addEventListener('change', () => {
                const value = styleSelect.value;
                if (['study', 'verbatim', 'summary'].includes(value)) {
                    this.noteDictation.style = value;
                    localStorage.setItem('note_dictation_style', value);
                }
            });
        }

        document.querySelector('#note-modal .modal-backdrop').addEventListener('click', () => {
            this.hideModal();
        });

        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
            });
        });

        document.getElementById('btn-study-link-selection')?.addEventListener('click', async () => {
            await this.captureStudyAnchor('selection');
        });
        document.getElementById('btn-study-link-paragraph')?.addEventListener('click', async () => {
            await this.captureStudyAnchor('paragraph');
        });
        document.getElementById('btn-study-clear-draft')?.addEventListener('click', () => {
            this.clearStudyDraft();
        });
        document.getElementById('btn-study-save-note')?.addEventListener('click', () => {
            this.saveStudyDraftNote();
        });
        this.setupStudyEditorToolbar();

        const savedStudyMode = localStorage.getItem('clara_study_mode_v1') === 'true';
        this.state.studyMode = savedStudyMode;
        this.syncStudyModeUI();

        // Track last clicked word in both browse and reading overlays for study tagging.
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (!target || !target.closest) return;

            const chip = target.closest('.study-anchor-chip');
            if (chip) {
                const idx = Number.parseInt(chip.dataset.anchorIndex || '', 10);
                if (Number.isFinite(idx) && this.studyDraftAnchors[idx]) {
                    this.scrollToStudyAnchor(this.studyDraftAnchors[idx]);
                }
                return;
            }
            const wordEl = target.closest('.word-box');
            if (!wordEl) return;

            const wordIndex = Number.parseInt(wordEl.dataset.index || '', 10);
            if (!Number.isFinite(wordIndex)) return;

            const pageNum = this.getPageNumFromElement(wordEl);
            const wordText = String(wordEl.dataset.word || '').trim();
            this.studyLastWordTarget = {
                page_num: pageNum,
                word_index: wordIndex,
                text: wordText
            };
        });
    }

    toggleSidebar() {
        const sidebar = document.getElementById('notes-sidebar');
        if (sidebar.classList.contains('hidden')) {
            this.showSidebar();
        } else {
            this.hideSidebar();
        }
    }

    async showSidebar() {
        const sidebar = document.getElementById('notes-sidebar');
        sidebar.classList.remove('hidden');
        this.syncStudySheetPage();
        await this.load();
    }

    hideSidebar() {
        if (this.state.studyMode) return;
        document.getElementById('notes-sidebar').classList.add('hidden');
    }

    syncStudyModeUI() {
        const enabled = !!this.state.studyMode;
        document.body.classList.toggle('study-mode', enabled);
        const studyBtn = document.getElementById('btn-study-mode');
        const notesTitle = document.querySelector('#notes-sidebar .notes-header h3');
        const sheet = document.getElementById('study-sheet');

        if (studyBtn) {
            studyBtn.classList.toggle('active', enabled);
            studyBtn.title = enabled ? 'Disable Study Mode' : 'Enable Study Mode';
        }
        if (sheet) sheet.classList.toggle('hidden', !enabled);
        if (notesTitle) notesTitle.textContent = enabled ? 'Linked Notes' : 'Notes';

        if (this.state.currentView === 'viewer') {
            if (enabled) {
                this.showSidebar();
            }
            this.syncStudySheetPage();
        }
    }

    setStudyMode(enabled) {
        this.state.studyMode = !!enabled;
        localStorage.setItem('clara_study_mode_v1', this.state.studyMode ? 'true' : 'false');
        this.syncStudyModeUI();
        this.clara.ui.showToast(this.state.studyMode ? 'Study Mode enabled' : 'Study Mode disabled');
    }

    syncStudySheetPage() {
        const page = document.getElementById('study-sheet-page');
        if (page) page.textContent = `Page ${Number(this.state.viewerCurrentPage || 0) + 1}`;
        this.renderStudyAnchorBoxes();
    }

    clearStudyDraft() {
        this.setStudyEditorHtml('');
        this.studyDraftAnchors = [];
        this.renderStudyAnchorPreview();
        this.renderStudyAnchorBoxes();
    }

    isRichStudyContent(value) {
        return typeof value === 'string' && value.startsWith('__CLARA_RICH__');
    }

    decodeRichStudyContent(value) {
        if (!this.isRichStudyContent(value)) return String(value || '');
        return String(value).replace(/^__CLARA_RICH__/, '');
    }

    getNotePreviewText(note) {
        const raw = String(note?.content || '');
        const plain = this.isRichStudyContent(raw)
            ? this.decodeRichStudyContent(raw).replace(/<[^>]+>/g, ' ')
            : raw;
        return plain.replace(/\s+/g, ' ').trim();
    }

    getStudyEditor() {
        return document.getElementById('study-note-editor');
    }

    getStudyEditorText() {
        const editor = this.getStudyEditor();
        if (!editor) return '';
        return String(editor.textContent || '').replace(/\u00a0/g, ' ').trim();
    }

    getStudyEditorHtml() {
        const editor = this.getStudyEditor();
        if (!editor) return '';
        return String(editor.innerHTML || '').trim();
    }

    setStudyEditorHtml(html = '') {
        const editor = this.getStudyEditor();
        if (!editor) return;
        editor.innerHTML = html;
    }

    setupStudyEditorToolbar() {
        const exec = (cmd, value = null) => {
            const editor = this.getStudyEditor();
            if (!editor) return;
            editor.focus();
            document.execCommand(cmd, false, value);
        };

        document.getElementById('btn-study-h2')?.addEventListener('click', () => exec('formatBlock', 'h2'));
        document.getElementById('btn-study-h3')?.addEventListener('click', () => exec('formatBlock', 'h3'));
        document.getElementById('btn-study-bold')?.addEventListener('click', () => exec('bold'));
        document.getElementById('btn-study-italic')?.addEventListener('click', () => exec('italic'));
        document.getElementById('btn-study-bullet')?.addEventListener('click', () => exec('insertUnorderedList'));
        document.getElementById('btn-study-highlight')?.addEventListener('click', () => exec('hiliteColor', '#fff2a8'));
    }

    sanitizeStudyHtml(html = '') {
        const safe = String(html || '');
        return safe
            .replace(/<(?!\/?(h2|h3|p|ul|ol|li|strong|b|em|i|u|br|span)\b)[^>]*>/gi, '')
            .replace(/ on\w+="[^"]*"/gi, '')
            .replace(/ style="[^"]*"/gi, '');
    }

    scrollToStudyAnchor(anchor) {
        if (!anchor || !Number.isFinite(anchor.page_num)) return;
        const pageNum = anchor.page_num;
        this.clara.viewer.goToPage(pageNum);
        const yPos = Number.isFinite(anchor.anchor_y) ? (anchor.anchor_y / 100) : 0.3;
        setTimeout(() => {
            this.clara.viewer.scrollToContinuousPage(pageNum, yPos, 'smooth');
        }, 120);
    }

    renderStudyAnchorPreview() {
        const preview = document.getElementById('study-anchor-preview');
        if (!preview) return;

        if (!this.studyDraftAnchors || this.studyDraftAnchors.length === 0) {
            preview.classList.add('hidden');
            preview.textContent = '';
            return;
        }

        preview.classList.remove('hidden');
        preview.innerHTML = this.studyDraftAnchors.map((anchor, index) => {
            const anchorType = this.formatAnchorType(anchor.anchor_type || 'selection');
            const pageNum = Number.isFinite(anchor.page_num) ? anchor.page_num + 1 : this.state.viewerCurrentPage + 1;
            return `<button class="study-anchor-chip" data-anchor-index="${index}" title="Jump to linked spot">${anchorType} · p${pageNum}</button>`;
        }).join('');
    }

    getStudySelectionText() {
        const sel = window.getSelection();
        if (!sel) return '';
        return String(sel.toString() || '').trim();
    }

    clamp01Percent(value) {
        return Math.max(0, Math.min(100, Number(value) || 0));
    }

    extractAnchorsFromSelection(mode = 'selection') {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];

        const rawText = String(sel.toString() || '').trim();
        if (!rawText) return [];

        const range = sel.getRangeAt(0);
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
        if (rects.length === 0) return [];

        const anchorsByPage = new Map();

        rects.forEach((rect) => {
            const cx = rect.left + (rect.width / 2);
            const cy = rect.top + (rect.height / 2);
            const hit = document.elementFromPoint(cx, cy);
            const pageEl = hit?.closest?.('.continuous-page');
            const wrapper = pageEl
                ? (pageEl.querySelector('.page-image-wrapper') || pageEl)
                : (document.querySelector('.page-image-wrapper') || document.getElementById('page-content'));
            if (!wrapper) return;

            const wrapperRect = wrapper.getBoundingClientRect();
            if (wrapperRect.width <= 0 || wrapperRect.height <= 0) return;

            const pageNum = pageEl
                ? Number.parseInt(pageEl.dataset.pageNum || `${this.state.viewerCurrentPage}`, 10)
                : this.state.viewerCurrentPage;

            const box = {
                x: this.clamp01Percent(((rect.left - wrapperRect.left) / wrapperRect.width) * 100),
                y: this.clamp01Percent(((rect.top - wrapperRect.top) / wrapperRect.height) * 100),
                w: this.clamp01Percent((rect.width / wrapperRect.width) * 100),
                h: this.clamp01Percent((rect.height / wrapperRect.height) * 100)
            };

            const key = Number.isFinite(pageNum) ? pageNum : this.state.viewerCurrentPage;
            if (!anchorsByPage.has(key)) {
                anchorsByPage.set(key, []);
            }
            anchorsByPage.get(key).push(box);
        });

        const anchorType = mode === 'sentence' ? 'sentence' : (mode === 'paragraph' ? 'paragraph' : 'selection');
        const anchors = [];
        anchorsByPage.forEach((boxes, pageNum) => {
            const merged = this.mergeSelectionBoxes(boxes);
            const first = merged[0] || { x: 50, y: 30, w: 0, h: 0 };
            anchors.push({
                page_num: pageNum,
                anchor_type: anchorType,
                anchor_text: rawText,
                anchor_x: this.clamp01Percent(first.x + (first.w / 2)),
                anchor_y: this.clamp01Percent(first.y + (first.h / 2)),
                boxes: merged
            });
        });

        return anchors;
    }

    mergeSelectionBoxes(boxes) {
        const sorted = (boxes || [])
            .filter(b => b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h))
            .sort((a, b) => (a.y - b.y) || (a.x - b.x));

        if (sorted.length === 0) return [];

        const merged = [];
        sorted.forEach((box) => {
            const last = merged[merged.length - 1];
            if (!last) {
                merged.push({ ...box });
                return;
            }

            const sameLine = Math.abs(last.y - box.y) <= 1.4;
            const touches = (box.x <= (last.x + last.w + 1.8));
            if (sameLine && touches) {
                const right = Math.max(last.x + last.w, box.x + box.w);
                last.x = Math.min(last.x, box.x);
                last.y = Math.min(last.y, box.y);
                last.h = Math.max(last.h, box.h);
                last.w = right - last.x;
            } else {
                merged.push({ ...box });
            }
        });

        return merged.slice(0, 24);
    }

    appendStudyDraftAnchors(anchors) {
        if (!Array.isArray(anchors) || anchors.length === 0) return 0;
        let added = 0;

        anchors.forEach((anchor) => {
            const exists = this.studyDraftAnchors.some((a) => {
                if (a.page_num !== anchor.page_num) return false;
                const dx = Math.abs((a.anchor_x || 0) - (anchor.anchor_x || 0));
                const dy = Math.abs((a.anchor_y || 0) - (anchor.anchor_y || 0));
                return dx < 1.2 && dy < 1.2 && a.anchor_type === anchor.anchor_type;
            });
            if (!exists) {
                this.studyDraftAnchors.push(anchor);
                added += 1;
            }
        });

        return added;
    }

    renderStudyAnchorBoxes() {
        document.querySelectorAll('.study-anchor-box').forEach(el => el.remove());
        if (!this.studyDraftAnchors || this.studyDraftAnchors.length === 0) return;

        this.studyDraftAnchors.forEach((anchor) => {
            const pageNum = Number.isFinite(anchor.page_num) ? anchor.page_num : this.state.viewerCurrentPage;
            const pageEl = document.getElementById(`page-${pageNum}`);
            const container = pageEl
                ? (pageEl.querySelector('.page-image-wrapper') || pageEl)
                : (document.querySelector('.page-image-wrapper') || document.getElementById('page-content'));
            if (!container) return;

            const boxes = Array.isArray(anchor.boxes) && anchor.boxes.length > 0
                ? anchor.boxes
                : [{ x: (anchor.anchor_x || 50) - 2.5, y: (anchor.anchor_y || 30) - 1.4, w: 5, h: 2.8 }];

            boxes.forEach((box) => {
                const el = document.createElement('div');
                el.className = 'study-anchor-box';
                el.style.left = `${this.clamp01Percent(box.x)}%`;
                el.style.top = `${this.clamp01Percent(box.y)}%`;
                el.style.width = `${this.clamp01Percent(box.w)}%`;
                el.style.height = `${this.clamp01Percent(box.h)}%`;
                container.appendChild(el);
            });
        });
    }

    getPageNumFromElement(el) {
        if (!el || !el.closest) return this.state.viewerCurrentPage;
        const readingWrapper = el.closest('.page-image-wrapper.reading-mode');
        if (readingWrapper?.dataset?.readingPage !== undefined) {
            const n = Number.parseInt(readingWrapper.dataset.readingPage, 10);
            if (Number.isFinite(n)) return n;
        }
        const pageEl = el.closest('.continuous-page');
        if (pageEl?.dataset?.pageNum !== undefined) {
            const n = Number.parseInt(pageEl.dataset.pageNum, 10);
            if (Number.isFinite(n)) return n;
        }
        const overlay = el.closest('.word-highlight-overlay');
        if (overlay?.dataset?.pageNum !== undefined) {
            const n = Number.parseInt(overlay.dataset.pageNum, 10);
            if (Number.isFinite(n)) return n;
        }
        return this.state.viewerCurrentPage;
    }

    getCacheKey(pageNum) {
        return `${this.state.viewerDocId || ''}:${pageNum}`;
    }

    async loadWordsForPage(pageNum) {
        if (!this.state.viewerDocId && !Number.isFinite(pageNum)) return [];
        const key = this.getCacheKey(pageNum);
        if (this.pageWordsCache.has(key)) return this.pageWordsCache.get(key);

        const res = await fetch(`/document/${this.state.viewerDocId}/page/${pageNum}/words`);
        const data = await res.json();
        const words = Array.isArray(data.words) ? data.words : [];
        this.pageWordsCache.set(key, words);
        return words;
    }

    extractSentenceBounds(words, wordIndex) {
        if (!Array.isArray(words) || words.length === 0) return null;
        if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= words.length) return null;

        const endsSentence = (token) => /[.!?]["')\]]*$/.test(String(token || ''));
        let start = wordIndex;
        while (start > 0) {
            const prev = words[start - 1]?.text || '';
            if (endsSentence(prev)) break;
            start -= 1;
        }
        let end = wordIndex;
        while (end < words.length - 1) {
            const cur = words[end]?.text || '';
            if (endsSentence(cur)) break;
            end += 1;
        }

        const text = words.slice(start, end + 1).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
        return { start, end, text };
    }

    extractParagraphBounds(words, wordIndex) {
        if (!Array.isArray(words) || words.length === 0) return null;
        if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= words.length) return null;

        const currentLine = words[wordIndex]?.line;
        if (!Number.isFinite(currentLine)) {
            return this.extractSentenceBounds(words, wordIndex);
        }

        const lineMeta = new Map();
        words.forEach((w) => {
            if (!Number.isFinite(w.line)) return;
            const existing = lineMeta.get(w.line) || {
                minY: Number.POSITIVE_INFINITY,
                maxH: 0
            };
            existing.minY = Math.min(existing.minY, Number(w.y || 0));
            existing.maxH = Math.max(existing.maxH, Number(w.h || 0));
            lineMeta.set(w.line, existing);
        });

        const isParagraphBreak = (lineA, lineB) => {
            if (!lineMeta.has(lineA) || !lineMeta.has(lineB)) return true;
            const a = lineMeta.get(lineA);
            const b = lineMeta.get(lineB);
            const gap = Math.abs(b.minY - a.minY);
            const baseH = Math.max(a.maxH, b.maxH, 0.8);
            return gap > (baseH * 1.9);
        };

        let startLine = currentLine;
        while (startLine > 0 && !isParagraphBreak(startLine - 1, startLine)) {
            startLine -= 1;
        }

        let endLine = currentLine;
        const maxLine = Math.max(...Array.from(lineMeta.keys()));
        while (endLine < maxLine && !isParagraphBreak(endLine, endLine + 1)) {
            endLine += 1;
        }

        let start = wordIndex;
        while (start > 0 && Number.isFinite(words[start - 1]?.line) && words[start - 1].line >= startLine) {
            start -= 1;
        }
        let end = wordIndex;
        while (end < words.length - 1 && Number.isFinite(words[end + 1]?.line) && words[end + 1].line <= endLine) {
            end += 1;
        }

        const text = words.slice(start, end + 1).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
        return { start, end, text };
    }

    boxesFromWordRange(words, start, end) {
        const slice = words.slice(start, end + 1).filter(w =>
            Number.isFinite(w?.x) && Number.isFinite(w?.y) && Number.isFinite(w?.w) && Number.isFinite(w?.h)
        );
        if (slice.length === 0) return [];

        const lines = new Map();
        slice.forEach((w) => {
            const key = Number.isFinite(w.line) ? w.line : `${Math.round(Number(w.y || 0) * 5) / 5}`;
            const existing = lines.get(key) || { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, right: 0, h: 0 };
            existing.x = Math.min(existing.x, Number(w.x));
            existing.y = Math.min(existing.y, Number(w.y));
            existing.right = Math.max(existing.right, Number(w.x) + Number(w.w));
            existing.h = Math.max(existing.h, Number(w.h));
            lines.set(key, existing);
        });

        return Array.from(lines.values()).map((line) => ({
            x: this.clamp01Percent(line.x),
            y: this.clamp01Percent(line.y),
            w: this.clamp01Percent(line.right - line.x),
            h: this.clamp01Percent(line.h)
        }));
    }

    async captureStudyAnchor(mode = 'selection') {
        const anchors = this.extractAnchorsFromSelection(mode);
        let finalAnchors = anchors;

        if (finalAnchors.length === 0 && this.studyLastWordTarget) {
            const pageNum = this.studyLastWordTarget.page_num;
            const wordIndex = this.studyLastWordTarget.word_index;
            const words = await this.loadWordsForPage(pageNum);
            if (words.length > 0 && Number.isInteger(wordIndex) && wordIndex >= 0 && wordIndex < words.length) {
                let bounds = null;
                if (mode === 'paragraph') bounds = this.extractParagraphBounds(words, wordIndex);
                else if (mode === 'sentence') bounds = this.extractSentenceBounds(words, wordIndex);
                else bounds = { start: wordIndex, end: wordIndex, text: words[wordIndex]?.text || this.studyLastWordTarget.text || '' };

                if (bounds && bounds.text) {
                    const boxes = this.mergeSelectionBoxes(this.boxesFromWordRange(words, bounds.start, bounds.end));
                    const first = boxes[0] || { x: words[wordIndex]?.x || 50, y: words[wordIndex]?.y || 30, w: words[wordIndex]?.w || 4, h: words[wordIndex]?.h || 2 };
                    finalAnchors = [{
                        page_num: pageNum,
                        anchor_type: mode === 'paragraph' ? 'paragraph' : (mode === 'sentence' ? 'sentence' : 'word'),
                        anchor_text: bounds.text,
                        anchor_x: this.clamp01Percent(first.x + (first.w / 2)),
                        anchor_y: this.clamp01Percent(first.y + (first.h / 2)),
                        boxes
                    }];
                }
            }
        }

        if (finalAnchors.length === 0) {
            this.clara.ui.showToast('Select text first, or click a word then choose Sentence/Paragraph', true);
            return;
        }

        const added = this.appendStudyDraftAnchors(finalAnchors);
        this.renderStudyAnchorPreview();
        this.renderStudyAnchorBoxes();

        const typeLabel = this.formatAnchorType(finalAnchors[0].anchor_type);
        this.clara.ui.showToast(`Linked ${added} ${typeLabel.toLowerCase()} selection${added === 1 ? '' : 's'}`);
    }

    async captureCurrentSectionAnchor() {
        const fallbackPage = this.studyLastWordTarget?.page_num ?? this.state.viewerCurrentPage;
        const fallbackIndex = Number.isInteger(this.studyLastWordTarget?.word_index)
            ? this.studyLastWordTarget.word_index
            : (Number.isInteger(this.state.currentWordIndex) ? this.state.currentWordIndex : 0);
        const words = await this.loadWordsForPage(fallbackPage);
        const para = this.extractParagraphBounds(words, fallbackIndex);
        const sentence = this.extractSentenceBounds(words, fallbackIndex);
        let sectionText = para?.text || sentence?.text || '';

        if (!sectionText && Array.isArray(this.state.words) && this.state.words.length > 0) {
            sectionText = this.extractParagraphFromWordIndex(fallbackIndex) || this.extractSentenceFromWordIndex(fallbackIndex);
        }
        if (!sectionText) {
            sectionText = this.getStudySelectionText();
        }
        if (!sectionText) {
            this.clara.ui.showToast('No current section available yet', true);
            return;
        }

        const anchor = this.getAnchorFromSelection(fallbackIndex, sectionText, null, fallbackPage);
        anchor.page_num = fallbackPage;
        anchor.anchor_type = 'paragraph';
        if (para) {
            anchor.boxes = this.mergeSelectionBoxes(this.boxesFromWordRange(words, para.start, para.end));
        } else {
            anchor.boxes = [{ x: Math.max(0, (anchor.anchor_x || 50) - 4), y: Math.max(0, (anchor.anchor_y || 30) - 2), w: 8, h: 4 }];
        }
        this.appendStudyDraftAnchors([anchor]);
        this.renderStudyAnchorPreview();
        this.renderStudyAnchorBoxes();
        this.clara.ui.showToast('Current section linked');
    }

    async saveStudyDraftNote() {
        const contentText = this.getStudyEditorText();
        if (!contentText) {
            this.clara.ui.showToast('Write your note before saving', true);
            return;
        }
        const richHtml = this.sanitizeStudyHtml(this.getStudyEditorHtml());
        const content = `__CLARA_RICH__${richHtml}`;

        const anchors = (this.studyDraftAnchors && this.studyDraftAnchors.length > 0)
            ? this.studyDraftAnchors
            : [{
                page_num: this.state.viewerCurrentPage,
                anchor_type: 'manual',
                anchor_text: null,
                anchor_x: 50,
                anchor_y: 30
            }];

        try {
            const created = [];
            for (const anchor of anchors) {
                const res = await fetch(`/document/${this.state.viewerDocId}/notes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content,
                        page_num: Number.isFinite(anchor.page_num) ? anchor.page_num : this.state.viewerCurrentPage,
                        anchor_type: anchor.anchor_type || 'manual',
                        anchor_text: anchor.anchor_text || null,
                        anchor_x: anchor.anchor_x,
                        anchor_y: anchor.anchor_y,
                        color: '#FFE066'
                    })
                });
                const data = await res.json();
                if (data.error) {
                    this.clara.ui.showToast(data.error, true);
                    return;
                }
                created.push(data);
            }

            this.state.notes.push(...created);
            this.renderList();
            this.updateBadge();
            this.renderMarkers();
            this.setStudyEditorHtml('');
            this.studyDraftAnchors = [];
            this.renderStudyAnchorPreview();
            this.renderStudyAnchorBoxes();
            this.clara.ui.showToast(`Saved ${created.length} linked note${created.length === 1 ? '' : 's'}`);
        } catch (err) {
            this.clara.ui.showToast('Failed to save study note: ' + err.message, true);
        }
    }

    async load() {
        if (!this.state.viewerDocId) return;

        try {
            const res = await fetch(`/document/${this.state.viewerDocId}/notes`);
            const data = await res.json();

            this.state.notes = data.notes || [];
            this.renderList();
            this.updateBadge();
            this.renderMarkers();
        } catch (err) {
            console.error('Failed to load notes:', err);
        }
    }

    renderList() {
        const list = document.getElementById('notes-list');
        const empty = document.getElementById('notes-empty');

        list.innerHTML = '';

        if (this.state.notes.length === 0) {
            list.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }

        list.classList.remove('hidden');
        empty.classList.add('hidden');

        this.state.notes.forEach(note => {
            const card = document.createElement('div');
            card.className = 'note-card';
            card.dataset.noteId = note.id;

            const colorClass = this.getColorClass(note.color);
            if (colorClass) card.classList.add(colorClass);
            const preview = this.getNotePreviewText(note);

            card.innerHTML = `
                <div class="note-card-content">${this.clara.ui.escapeHtml(preview)}</div>
                ${note.question ? `<div class="note-card-answer">${this.clara.ui.escapeHtml(note.question)}</div>` : ''}
                <div class="note-card-meta">
                    <span>Page ${note.page_num + 1}</span>
                    <span class="note-anchor-kind">${this.formatAnchorType(note.anchor_type)}</span>
                    <button class="note-card-goto-btn" title="Go to Note Location" onclick="event.stopPropagation();">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                    </button>
                </div>
            `;

            card.addEventListener('click', () => {
                this.openModal(note);
            });

            const gotoBtn = card.querySelector('.note-card-goto-btn');
            gotoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToNotePage(note);
            });

            list.appendChild(card);
        });
    }

    getColorClass(color) {
        const colorMap = {
            '#A8E6CF': 'color-green',
            '#88D8F5': 'color-blue',
            '#FFB3BA': 'color-pink',
            '#DDA0DD': 'color-purple'
        };
        return colorMap[color] || '';
    }

    updateBadge() {
        const badge = document.getElementById('notes-badge');
        const count = this.state.notes.length;

        if (count > 0) {
            badge.textContent = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    formatAnchorType(anchorType) {
        const type = String(anchorType || '').toLowerCase();
        if (type.includes('figure') || type.includes('image')) return 'Figure';
        if (type.includes('word')) return 'Word';
        if (type.includes('sentence')) return 'Sentence';
        if (type.includes('paragraph')) return 'Paragraph';
        if (type.includes('ai')) return 'AI';
        if (type.includes('manual')) return 'Note';
        return 'Selection';
    }

    detectAnchorTypeFromText(text) {
        const value = String(text || '').trim();
        if (!value) return 'manual';

        const wordCount = value.split(/\s+/).filter(Boolean).length;
        const hasLineBreak = /\n/.test(value);
        const hasSentencePunctuation = /[.!?]["')\]]?$/.test(value);

        if (wordCount <= 1) return 'word';
        if (hasLineBreak || wordCount > 40 || value.length > 220) return 'paragraph';
        if (hasSentencePunctuation && wordCount >= 4) return 'sentence';
        return 'selection';
    }

    clampPercent(value) {
        return Math.max(0, Math.min(100, value));
    }

    getActivePageContainer(pageNum = this.state.viewerCurrentPage) {
        const continuousPage = document.getElementById(`page-${pageNum}`);
        if (continuousPage) {
            return continuousPage.querySelector('.page-image-wrapper') || continuousPage;
        }
        return document.querySelector('.page-image-wrapper') || document.getElementById('page-content');
    }

    getClosestWordIndexAtPosition(x, y) {
        if (!this.state.words || this.state.words.length === 0) return -1;

        let closestIndex = -1;
        let closestDistance = Infinity;
        for (let i = 0; i < this.state.words.length; i++) {
            const word = this.state.words[i];
            if (word.x === undefined || word.y === undefined || word.w === undefined || word.h === undefined) {
                continue;
            }

            if (x >= word.x && x <= word.x + word.w && y >= word.y && y <= word.y + word.h) {
                return i;
            }

            const centerX = word.x + word.w / 2;
            const centerY = word.y + word.h / 2;
            const distance = Math.hypot(x - centerX, y - centerY);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }

        return closestDistance < 12 ? closestIndex : -1;
    }

    getAnchorFromSelection(wordIndex, selectedText = '', anchorPoint = null, pageNum = this.state.viewerCurrentPage) {
        const text = String(selectedText || '').trim();
        const anchor = {
            anchor_text: text,
            anchor_type: this.detectAnchorTypeFromText(text),
            anchor_x: null,
            anchor_y: null
        };

        if (anchorPoint && Number.isFinite(anchorPoint.x) && Number.isFinite(anchorPoint.y)) {
            anchor.anchor_x = this.clampPercent(anchorPoint.x);
            anchor.anchor_y = this.clampPercent(anchorPoint.y);
            if (!anchor.anchor_text) {
                anchor.anchor_type = 'figure';
            }
        }

        const container = this.getActivePageContainer(pageNum);
        const selection = window.getSelection();
        if (container && selection && selection.rangeCount > 0 && text.length > 0) {
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (containerRect.width > 0 && containerRect.height > 0 && rect.width > 0 && rect.height > 0) {
                anchor.anchor_x = this.clampPercent(((rect.left + rect.width / 2 - containerRect.left) / containerRect.width) * 100);
                anchor.anchor_y = this.clampPercent(((rect.top + rect.height / 2 - containerRect.top) / containerRect.height) * 100);
            }
        }

        if (
            (anchor.anchor_x === null || anchor.anchor_y === null) &&
            pageNum === this.state.viewerCurrentPage &&
            Number.isInteger(wordIndex) &&
            this.state.words[wordIndex]
        ) {
            const word = this.state.words[wordIndex];
            if (word.x !== undefined && word.y !== undefined) {
                anchor.anchor_x = this.clampPercent(word.x + (word.w || 0) / 2);
                anchor.anchor_y = this.clampPercent(word.y + (word.h || 0) / 2);
                anchor.anchor_text = anchor.anchor_text || word.text || '';
                anchor.anchor_type = anchor.anchor_text ? this.detectAnchorTypeFromText(anchor.anchor_text) : 'word';
            }
        }

        if (anchor.anchor_x === null || anchor.anchor_y === null) {
            anchor.anchor_x = 50;
            anchor.anchor_y = 30;
        }

        if (!anchor.anchor_text) {
            anchor.anchor_type = 'manual';
        }

        return anchor;
    }

    renderMarkers() {
        document.querySelectorAll('.note-marker').forEach(m => m.remove());
        this.renderAnchoredHighlights();

        if (!this.state.isPdf) return;
        const inContinuousMode = !!document.querySelector('.continuous-pages-container');
        const notes = Array.isArray(this.state.notes) ? this.state.notes : [];
        if (notes.length === 0) return;

        notes.forEach(note => {
            if (note.anchor_x !== null && note.anchor_y !== null) {
                let container = null;
                if (inContinuousMode) {
                    const pageEl = document.getElementById(`page-${note.page_num}`);
                    if (!pageEl) return;
                    container = pageEl.querySelector('.page-image-wrapper') || pageEl;
                } else {
                    if (note.page_num !== this.state.viewerCurrentPage) return;
                    container = document.querySelector('.page-image-wrapper') || document.getElementById('page-content');
                }
                if (!container) return;

                const marker = document.createElement('div');
                marker.className = 'note-marker';
                marker.dataset.noteId = note.id;

                const colorClass = this.getColorClass(note.color);
                if (colorClass) marker.classList.add(colorClass);

                marker.style.left = `${note.anchor_x}%`;
                marker.style.top = `${note.anchor_y}%`;

                marker.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span class="note-marker-tag">${this.formatAnchorType(note.anchor_type)}</span>
                `;

                marker.addEventListener('click', (e) => {
                    if (!this.state.draggingNote) {
                        e.stopPropagation();
                        this.openModal(note);
                    }
                });

                marker.addEventListener('dblclick', async (e) => {
                    if (this.state.draggingNote) return;
                    e.stopPropagation();
                    if (!this.state.isReadingMode) return;
                    const wordIndex = this.getClosestWordIndexAtPosition(note.anchor_x, note.anchor_y);
                    if (wordIndex >= 0) {
                        await this.clara.reading.readFromWord(wordIndex);
                    }
                });

                this.setupMarkerDrag(marker, note);

                container.appendChild(marker);
            }
        });
    }

    renderAnchoredHighlights() {
        const boxes = document.querySelectorAll('.word-box');
        boxes.forEach(box => box.classList.remove('note-anchored'));

        if (!this.state.words || this.state.words.length === 0) return;
        if (!this.state.notes || this.state.notes.length === 0) return;

        const pageNotes = this.state.notes.filter(
            n => n.page_num === this.state.viewerCurrentPage && n.anchor_text
        );
        if (pageNotes.length === 0) return;

        const anchoredWords = new Set(
            pageNotes
                .flatMap(note => String(note.anchor_text).split(/\s+/))
                .map(w => w.trim().toLowerCase().replace(/[^\w'-]/g, ''))
                .filter(Boolean)
        );
        if (anchoredWords.size === 0) return;

        this.state.words.forEach((word, idx) => {
            const normalized = String(word?.text || '').toLowerCase().replace(/[^\w'-]/g, '');
            if (!normalized || !anchoredWords.has(normalized)) return;
            if (this.clara.reading.wordBoxes[idx]) {
                this.clara.reading.wordBoxes[idx].classList.add('note-anchored');
            }
        });
    }

    resolveDropTarget(point) {
        const hit = document.elementFromPoint(point.x, point.y);
        if (!hit || !hit.closest) return null;

        const continuousPage = hit.closest('.continuous-page');
        if (continuousPage) {
            const pageNum = Number.parseInt(continuousPage.dataset.pageNum || '', 10);
            if (!Number.isFinite(pageNum)) return null;
            const container = continuousPage.querySelector('.page-image-wrapper') || continuousPage;
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return null;
            const x = this.clampPercent(((point.x - rect.left) / rect.width) * 100);
            const y = this.clampPercent(((point.y - rect.top) / rect.height) * 100);
            return { pageNum, container, x, y };
        }

        const wrapper = hit.closest('.page-image-wrapper') || document.querySelector('.page-image-wrapper') || document.getElementById('page-content');
        if (!wrapper) return null;
        const rect = wrapper.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const x = this.clampPercent(((point.x - rect.left) / rect.width) * 100);
        const y = this.clampPercent(((point.y - rect.top) / rect.height) * 100);
        return {
            pageNum: this.state.viewerCurrentPage,
            container: wrapper,
            x,
            y
        };
    }

    setupMarkerDrag(marker, note) {
        let isDragging = false;
        let startX, startY;
        let lastDropTarget = null;

        const getPoint = (e) => {
            if (e.touches && e.touches[0]) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            if (e.changedTouches && e.changedTouches[0]) {
                return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        };

        const onStart = (e) => {
            const point = getPoint(e);
            if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
            isDragging = true;
            this.state.draggingNote = note.id;
            startX = point.x;
            startY = point.y;
            marker.classList.add('dragging');
            lastDropTarget = this.resolveDropTarget(point);

            if (e.cancelable) e.preventDefault();
            e.stopPropagation();

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
            document.addEventListener('touchcancel', onEnd);
        };

        const onMove = (e) => {
            if (!isDragging) return;
            const point = getPoint(e);
            if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

            const dropTarget = this.resolveDropTarget(point);
            if (!dropTarget) return;
            lastDropTarget = dropTarget;

            if (marker.parentElement !== dropTarget.container) {
                dropTarget.container.appendChild(marker);
            }

            marker.style.left = `${dropTarget.x}%`;
            marker.style.top = `${dropTarget.y}%`;

            if (e.cancelable) e.preventDefault();
        };

        const onEnd = async (e) => {
            if (!isDragging) return;
            const point = getPoint(e);
            if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

            isDragging = false;
            this.state.draggingNote = null;
            marker.classList.remove('dragging');

            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            document.removeEventListener('touchcancel', onEnd);
            const dropTarget = this.resolveDropTarget(point) || lastDropTarget;
            if (!dropTarget) return;

            const dx = Math.abs(point.x - startX);
            const dy = Math.abs(point.y - startY);

            if (dx > 5 || dy > 5) {
                const anchorText = await this.findWordAtPosition(dropTarget.x, dropTarget.y, dropTarget.pageNum);
                await this.updatePosition(note.id, dropTarget.x, dropTarget.y, anchorText, dropTarget.pageNum);
                this.renderMarkers();
            }
        };

        marker.addEventListener('mousedown', onStart);
        marker.addEventListener('touchstart', onStart, { passive: false });
    }

    async findWordAtPosition(x, y, pageNum = this.state.viewerCurrentPage) {
        const words = Number.isFinite(pageNum) && pageNum !== this.state.viewerCurrentPage
            ? await this.loadWordsForPage(pageNum)
            : (this.state.words || []);
        if (!words || words.length === 0) return '';

        let closestWord = null;
        let closestDistance = Infinity;

        for (const word of words) {
            if (word.x === undefined || word.y === undefined) continue;

            if (x >= word.x && x <= word.x + word.w &&
                y >= word.y && y <= word.y + word.h) {
                return word.text;
            }

            const centerX = word.x + word.w / 2;
            const centerY = word.y + word.h / 2;
            const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestWord = word;
            }
        }

        if (closestWord && closestDistance < 10) {
            return closestWord.text;
        }

        return '';
    }

    async updatePosition(noteId, x, y, anchorText, pageNum = this.state.viewerCurrentPage) {
        try {
            await fetch(`/notes/${noteId}/position`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    anchor_x: x,
                    anchor_y: y,
                    anchor_text: anchorText,
                    page_num: pageNum
                })
            });

            const noteIndex = this.state.notes.findIndex(n => n.id === noteId);
            if (noteIndex >= 0) {
                this.state.notes[noteIndex].anchor_x = x;
                this.state.notes[noteIndex].anchor_y = y;
                this.state.notes[noteIndex].anchor_text = anchorText;
                this.state.notes[noteIndex].page_num = pageNum;
            }

            if (anchorText) {
                this.clara.ui.showToast(`Note attached to "${anchorText}"`);
            } else {
                this.clara.ui.showToast('Note repositioned');
            }

        } catch (err) {
            this.clara.ui.showToast('Failed to update note position', true);
        }
    }

    async saveAnswerAsNote() {
        const answerText = document.getElementById('answer-text').textContent;
        if (!answerText || !this.state.lastQuestion) {
            this.clara.ui.showToast('No question to save', true);
            return;
        }

        let anchorX = null;
        let anchorY = null;

        if (this.state.currentWordIndex > 0 && this.state.words.length > 0) {
            const word = this.state.words[this.state.currentWordIndex];
            if (word && word.x !== undefined && word.y !== undefined) {
                anchorX = word.x;
                anchorY = word.y;
            }
        }

        if (anchorX === null) {
            anchorX = 50;
            anchorY = 30;
        }

        try {
            const res = await fetch(`/document/${this.state.viewerDocId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: this.state.lastQuestion,
                    question: answerText,
                    page_num: this.state.viewerCurrentPage,
                    anchor_type: 'ai_question',
                    anchor_x: anchorX,
                    anchor_y: anchorY,
                    color: '#FFE066'
                })
            });

            const data = await res.json();

            if (data.error) {
                this.clara.ui.showToast(data.error, true);
                return;
            }

            this.state.notes.push(data);

            this.updateBadge();
            this.renderMarkers();

            if (!document.getElementById('notes-sidebar').classList.contains('hidden')) {
                this.renderList();
            }

            document.getElementById('answer-box').classList.add('hidden');

            this.clara.ui.showToast('Note saved');

        } catch (err) {
            this.clara.ui.showToast('Failed to save note: ' + err.message, true);
        }
    }

    openModal(note, draft = null) {
        this.state.currentNote = note;
        this.pendingNewNoteDraft = note ? null : (draft || this.pendingNewNoteDraft);
        this.stopNoteDictation();
        const styleSelect = document.getElementById('note-dictation-style');
        if (styleSelect) {
            styleSelect.value = this.noteDictation.style || 'study';
        }

        const modal = document.getElementById('note-modal');
        const title = document.getElementById('note-modal-title');
        const questionDiv = document.getElementById('note-question');
        const questionText = document.getElementById('note-question-text');
        const anchorDiv = document.getElementById('note-anchor');
        const anchorText = document.getElementById('note-anchor-text');
        const contentInput = document.getElementById('note-content-input');
        const pageNum = document.getElementById('note-page-num');
        const deleteBtn = document.getElementById('btn-delete-note');

        title.textContent = note ? 'Edit Note' : 'New Note';
        deleteBtn.style.display = note ? 'block' : 'none';

        if (note) {
            contentInput.value = this.getNotePreviewText(note);
            pageNum.textContent = note.page_num + 1;

            if (note.question) {
                questionDiv.classList.remove('hidden');
                questionText.textContent = note.question;
            } else {
                questionDiv.classList.add('hidden');
            }

            if (note.anchor_text) {
                anchorDiv.classList.remove('hidden');
                anchorText.textContent = note.anchor_text;
            } else {
                anchorDiv.classList.add('hidden');
            }

            document.querySelectorAll('.color-dot').forEach(dot => {
                dot.classList.remove('active');
                if (dot.dataset.color === note.color) {
                    dot.classList.add('active');
                }
            });
        } else {
            const pending = this.pendingNewNoteDraft || {};
            contentInput.value = pending.content || '';
            const notePageNum = Number.isFinite(pending.page_num) ? pending.page_num : this.state.viewerCurrentPage;
            pageNum.textContent = notePageNum + 1;
            questionDiv.classList.add('hidden');
            if (pending.anchor_text) {
                anchorDiv.classList.remove('hidden');
                anchorText.textContent = pending.anchor_text;
            } else if (pending.anchor_type === 'figure') {
                anchorDiv.classList.remove('hidden');
                anchorText.textContent = 'Figure/Image area';
            } else {
                anchorDiv.classList.add('hidden');
            }

            document.querySelectorAll('.color-dot').forEach(dot => {
                dot.classList.remove('active');
                if (dot.dataset.color === (pending.color || '#FFE066')) {
                    dot.classList.add('active');
                }
            });
        }

        modal.classList.remove('hidden');
        contentInput.focus();
    }

    hideModal() {
        this.stopNoteDictation();
        document.getElementById('note-modal').classList.add('hidden');
        this.state.currentNote = null;
        this.pendingNewNoteDraft = null;
    }

    ensureNoteDictationSupport() {
        const hasMediaRecorder = typeof window.MediaRecorder !== 'undefined';
        const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        this.noteDictation.supported = hasMediaRecorder && hasMediaDevices;
        return this.noteDictation.supported;
    }

    updateDictateButton() {
        const btn = document.getElementById('btn-dictate-note');
        if (!btn) return;
        btn.classList.toggle('recording', this.noteDictation.active);
        btn.title = this.noteDictation.active ? 'Stop dictation' : 'Dictate note';
        btn.innerHTML = this.noteDictation.active
            ? `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
                Stop
              `
            : `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
                Dictate
              `;
    }

    async toggleNoteDictation() {
        if (!this.ensureNoteDictationSupport()) {
            this.clara.ui.showToast('Dictation is not supported on this device', true);
            return;
        }

        if (this.noteDictation.active) {
            this.stopNoteDictation();
            return;
        }

        const input = document.getElementById('note-content-input');
        this.noteDictation.baseText = (input?.value || '').trim();
        this.noteDictation.finalText = '';
        this.noteDictation.interimText = '';

        try {
            await this.startRecorderDictation();
            this.clara.ui.showToast('Dictation started');
        } catch (err) {
            console.error('[Dictation] Start failed:', err);
            this.clara.ui.showToast('Could not start dictation. Check microphone permission.', true);
        }
    }

    stopNoteDictation() {
        if (this.noteDictation.recorder && this.noteDictation.active) {
            try {
                this.noteDictation.recorder.stop();
            } catch (_) {}
            this.clara.ui.showToast('Dictation stopped');
            return;
        }

        if (this.noteDictation.recognition && this.noteDictation.active) {
            try {
                this.noteDictation.recognition.stop();
            } catch (_) {}
            this.clara.ui.showToast('Dictation stopped');
        }

        this.cleanupRecorderStream();
        this.noteDictation.active = false;
        this.updateDictateButton();
    }

    cleanupRecorderStream() {
        if (this.noteDictation.stream) {
            this.noteDictation.stream.getTracks().forEach(track => track.stop());
            this.noteDictation.stream = null;
        }
        this.noteDictation.recorder = null;
        this.noteDictation.chunks = [];
    }

    async startRecorderDictation() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.noteDictation.stream = stream;

        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = '';
        }

        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        this.noteDictation.mimeType = recorder.mimeType || 'audio/webm';
        this.noteDictation.recorder = recorder;
        this.noteDictation.chunks = [];

        recorder.onstart = () => {
            this.noteDictation.active = true;
            this.updateDictateButton();
        };

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                this.noteDictation.chunks.push(event.data);
            }
        };

        recorder.onerror = (event) => {
            console.error('[Dictation] Recorder error:', event);
            this.clara.ui.showToast('Dictation recorder error.', true);
        };

        recorder.onstop = async () => {
            this.noteDictation.active = false;
            this.updateDictateButton();

            try {
                await this.transcribeRecordedAudio();
            } finally {
                this.cleanupRecorderStream();
            }
        };

        recorder.start();
    }

    async transcribeRecordedAudio() {
        if (!this.noteDictation.chunks || this.noteDictation.chunks.length === 0) {
            this.clara.ui.showToast('No speech captured. Try speaking a bit longer.', true);
            return;
        }

        const input = document.getElementById('note-content-input');
        if (!input) return;

        this.clara.ui.showInlineLoading('Transcribing dictation...');

        try {
            const blob = new Blob(this.noteDictation.chunks, { type: this.noteDictation.mimeType || 'audio/webm' });
            const buffer = await blob.arrayBuffer();
            const audioBytes = Array.from(new Uint8Array(buffer));

            const res = await fetch('/dictation/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_bytes: audioBytes,
                    mime_type: blob.type || 'audio/webm'
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || 'Transcription failed');
            }

            const transcript = String(data.transcript || '').trim();
            if (!transcript) {
                this.clara.ui.showToast('No speech detected in recording.', true);
                return;
            }

            const finalized = this.postProcessSpokenText(transcript, true);
            const styled = this.applyDictationStyle(finalized, this.noteDictation.style);
            input.value = [this.noteDictation.baseText, styled].filter(Boolean).join('\n\n').trim();
            this.clara.ui.showToast('Dictation added to note');
        } catch (err) {
            console.error('[Dictation] Transcription failed:', err);
            this.clara.ui.showToast(`Dictation failed: ${err.message}`, true);
        } finally {
            this.clara.ui.hideInlineLoading();
        }
    }

    cleanCurrentNoteText() {
        const input = document.getElementById('note-content-input');
        if (!input) return;
        const text = (input.value || '').trim();
        if (!text) return;

        const cleaned = this.applyDictationStyle(
            this.postProcessSpokenText(text, true),
            this.noteDictation.style
        );

        input.value = cleaned;
        this.clara.ui.showToast('Cleaned spoken note');
    }

    postProcessSpokenText(text, finalize = true) {
        if (!text) return '';

        let out = String(text);

        // Convert spoken editing/punctuation commands while preserving wording.
        out = out
            .replace(/\b(new paragraph|next paragraph)\b/gi, '\n\n')
            .replace(/\b(new line|next line|newline)\b/gi, '\n')
            .replace(/\b(bullet point|bullet)\b/gi, '\n- ')
            .replace(/\b(full stop|period)\b/gi, '.')
            .replace(/\b(comma)\b/gi, ',')
            .replace(/\b(question mark)\b/gi, '?')
            .replace(/\b(exclamation mark)\b/gi, '!')
            .replace(/\b(colon)\b/gi, ':')
            .replace(/\b(semicolon)\b/gi, ';');

        out = out
            .replace(/\s+([,.;:!?])/g, '$1')
            .replace(/([,.;:!?])([^\s\n])/g, '$1 $2')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

        if (!finalize) return out;

        // Light final polish without changing user intent.
        out = out
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .replace(/(^\w|[.!?]\s+\w)/g, (m) => m.toUpperCase())
            .trim();

        return out;
    }

    applyDictationStyle(text, style) {
        const normalized = String(text || '').trim();
        if (!normalized) return '';

        if (style === 'verbatim') {
            return normalized;
        }

        const sentenceCandidates = normalized
            .replace(/\n+/g, ' ')
            .split(/(?<=[.!?])\s+/)
            .map(s => s.trim())
            .filter(Boolean);

        if (style === 'summary') {
            const top = sentenceCandidates.slice(0, 3);
            if (top.length === 0) return normalized;
            return top.join(' ');
        }

        // Default: Study Notes. Keep user wording, organize for recall.
        const lines = normalized
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .filter(l => !/^(um+|uh+|hmm+)$/i.test(l));

        const keyIdea = sentenceCandidates[0] || lines[0] || normalized;
        const detailItems = (sentenceCandidates.length > 1
            ? sentenceCandidates.slice(1)
            : lines.slice(1))
            .slice(0, 6);

        const out = [];
        out.push(`Key idea: ${keyIdea.replace(/[.!?]+$/, '')}.`);
        if (detailItems.length > 0) {
            out.push('');
            out.push('Details:');
            detailItems.forEach(item => {
                const clean = item.replace(/^[•\-]\s*/, '').trim();
                if (clean) out.push(`- ${clean}`);
            });
        }

        return out.join('\n').trim();
    }

    async save() {
        const content = document.getElementById('note-content-input').value.trim();
        if (!content) {
            this.clara.ui.showToast('Please enter note content', true);
            return;
        }

        const activeColor = document.querySelector('.color-dot.active');
        const color = activeColor ? activeColor.dataset.color : '#FFE066';

        if (this.state.currentNote) {
            try {
                const res = await fetch(`/notes/${this.state.currentNote.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, color })
                });

                const data = await res.json();
                if (data.error) {
                    this.clara.ui.showToast(data.error, true);
                    return;
                }

                const noteIndex = this.state.notes.findIndex(n => n.id === this.state.currentNote.id);
                if (noteIndex >= 0) {
                    this.state.notes[noteIndex].content = content;
                    this.state.notes[noteIndex].color = color;
                }

                this.renderList();
                this.renderMarkers();
                this.hideModal();
                this.clara.ui.showToast('Note updated');

            } catch (err) {
                this.clara.ui.showToast('Failed to update note: ' + err.message, true);
            }
        } else {
            try {
                const pending = this.pendingNewNoteDraft || {};
                const anchorData = {
                    anchor_type: pending.anchor_type || 'manual',
                    anchor_text: pending.anchor_text || null,
                    anchor_x: pending.anchor_x,
                    anchor_y: pending.anchor_y
                };
                const notePageNum = Number.isFinite(pending.page_num) ? pending.page_num : this.state.viewerCurrentPage;
                const res = await fetch(`/document/${this.state.viewerDocId}/notes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content,
                        page_num: notePageNum,
                        anchor_type: anchorData.anchor_type || 'manual',
                        anchor_text: anchorData.anchor_text,
                        anchor_x: anchorData.anchor_x,
                        anchor_y: anchorData.anchor_y,
                        color
                    })
                });

                const data = await res.json();
                if (data.error) {
                    this.clara.ui.showToast(data.error, true);
                    return;
                }

                this.state.notes.push(data);
                this.renderList();
                this.updateBadge();
                this.renderMarkers();
                this.hideModal();
                this.clara.ui.showToast('Note saved');
            } catch (err) {
                this.clara.ui.showToast('Failed to save note: ' + err.message, true);
            }
        }
    }

    async deleteCurrent() {
        if (!this.state.currentNote) return;

        if (!confirm('Delete this note?')) return;

        try {
            await fetch(`/notes/${this.state.currentNote.id}`, { method: 'DELETE' });

            this.state.notes = this.state.notes.filter(n => n.id !== this.state.currentNote.id);

            this.renderList();
            this.updateBadge();
            this.renderMarkers();
            this.hideModal();
            this.clara.ui.showToast('Note deleted');

        } catch (err) {
            this.clara.ui.showToast('Failed to delete note: ' + err.message, true);
        }
    }

    async focusNoteMarker(noteId) {
        for (let attempt = 0; attempt < 8; attempt++) {
            this.renderMarkers();
            const marker = document.querySelector(`.note-marker[data-note-id="${noteId}"]`);
            if (marker) {
                marker.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                marker.classList.add('focus-pulse');
                setTimeout(() => marker.classList.remove('focus-pulse'), 1200);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 120));
        }
        return false;
    }

    scrollToNoteAnchor(note) {
        const docDisplay = document.getElementById('document-display');
        const page = document.getElementById(`page-${note.page_num}`);
        if (!docDisplay || !page) return;

        const pageBody = page.querySelector('.page-image-wrapper') || page;
        const pageHeight = pageBody.clientHeight || page.clientHeight;
        const anchorY = Number.isFinite(note.anchor_y) ? note.anchor_y : 50;
        const offsetWithinPage = (anchorY / 100) * pageHeight;
        const targetTop = page.offsetTop + offsetWithinPage - (docDisplay.clientHeight * 0.35);
        docDisplay.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }

    async goToNotePage(note) {
        if (!note || note.page_num === null || note.page_num === undefined) return;

        const pageNum = note.page_num;
        this.clara.viewer.goToPage(pageNum);

        const found = await this.focusNoteMarker(note.id);
        if (!found) {
            this.scrollToNoteAnchor(note);
            await this.focusNoteMarker(note.id);
        }

        this.clara.ui.showToast(`Navigated to note on page ${pageNum + 1}`);
    }

    extractSentenceFromWordIndex(wordIndex) {
        if (!Array.isArray(this.state.words) || this.state.words.length === 0) return '';
        if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= this.state.words.length) return '';

        const words = this.state.words;
        const endsSentence = (token) => /[.!?]["')\]]*$/.test(String(token || ''));

        let start = wordIndex;
        while (start > 0) {
            const prev = words[start - 1]?.text || '';
            if (endsSentence(prev)) break;
            start -= 1;
        }

        let end = wordIndex;
        while (end < words.length - 1) {
            const cur = words[end]?.text || '';
            if (endsSentence(cur)) break;
            end += 1;
        }

        return words.slice(start, end + 1).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
    }

    extractParagraphFromWordIndex(wordIndex) {
        if (!Array.isArray(this.state.words) || this.state.words.length === 0) return '';
        if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= this.state.words.length) return '';

        const words = this.state.words;
        const currentLine = words[wordIndex]?.line;

        if (!Number.isFinite(currentLine)) {
            const sentence = this.extractSentenceFromWordIndex(wordIndex);
            return sentence;
        }

        const lineMeta = new Map();
        words.forEach((w) => {
            if (!Number.isFinite(w.line)) return;
            const existing = lineMeta.get(w.line) || {
                minY: Number.POSITIVE_INFINITY,
                maxH: 0,
                minX: Number.POSITIVE_INFINITY
            };
            existing.minY = Math.min(existing.minY, Number(w.y || 0));
            existing.maxH = Math.max(existing.maxH, Number(w.h || 0));
            existing.minX = Math.min(existing.minX, Number(w.x || 0));
            lineMeta.set(w.line, existing);
        });

        const isParagraphBreak = (lineA, lineB) => {
            if (!lineMeta.has(lineA) || !lineMeta.has(lineB)) return true;
            const a = lineMeta.get(lineA);
            const b = lineMeta.get(lineB);
            const gap = Math.abs(b.minY - a.minY);
            const baseH = Math.max(a.maxH, b.maxH, 0.8);
            return gap > (baseH * 1.9);
        };

        let startLine = currentLine;
        while (startLine > 0 && !isParagraphBreak(startLine - 1, startLine)) {
            startLine -= 1;
        }

        let endLine = currentLine;
        const maxLine = Math.max(...Array.from(lineMeta.keys()));
        while (endLine < maxLine && !isParagraphBreak(endLine, endLine + 1)) {
            endLine += 1;
        }

        return words
            .filter(w => Number.isFinite(w.line) && w.line >= startLine && w.line <= endLine)
            .map(w => w.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async createWithText(initialText, anchor = null) {
        const anchorData = anchor || this.getAnchorFromSelection(null, initialText);
        const initialContent = initialText ? `"${initialText}"\n\n` : '';

        this.openModal(null, {
            content: initialContent,
            color: '#FFE066',
            page_num: anchorData.page_num ?? this.state.viewerCurrentPage,
            anchor_type: anchorData.anchor_type || 'selection',
            anchor_text: anchorData.anchor_text || initialText || null,
            anchor_x: anchorData.anchor_x,
            anchor_y: anchorData.anchor_y
        });
    }

    addFromSelection(wordIndex, selectedText, anchorPoint = null, pageNum = this.state.viewerCurrentPage, options = {}) {
        let noteText = selectedText;
        const mode = options.mode || 'selection';

        if (!noteText && wordIndex !== null && this.state.words[wordIndex]) {
            noteText = this.state.words[wordIndex].text;
        }

        if (mode === 'sentence' && Number.isInteger(wordIndex) && pageNum === this.state.viewerCurrentPage) {
            noteText = this.extractSentenceFromWordIndex(wordIndex) || noteText;
        }
        if (mode === 'paragraph' && Number.isInteger(wordIndex) && pageNum === this.state.viewerCurrentPage) {
            noteText = this.extractParagraphFromWordIndex(wordIndex) || noteText;
        }

        const anchorData = this.getAnchorFromSelection(wordIndex, noteText, anchorPoint, pageNum);
        anchorData.page_num = pageNum;
        if (mode === 'sentence') anchorData.anchor_type = 'sentence';
        if (mode === 'paragraph') anchorData.anchor_type = 'paragraph';

        if (!noteText && anchorData.anchor_type !== 'figure') {
            this.clara.ui.showToast('No text selected for note', true);
            return;
        }

        this.showSidebar();
        this.createWithText(noteText, anchorData);
    }
}
