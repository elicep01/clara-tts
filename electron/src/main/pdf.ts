import * as fs from 'fs';
import { PDFDocument } from 'pdf-lib';
// @ts-ignore
import pdfParse from 'pdf-parse';
import { createCanvas } from 'canvas';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

export interface PDFInfo {
    pageCount: number;
    title?: string;
    author?: string;
}

export interface PDFWord {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface TOCItem {
    title: string;
    page?: number;
    level: number;
    y_position?: number;
}

interface RenderOptions {
    scale?: number;
}

interface TOCExtractOptions {
    includeFallback?: boolean;
    maxFallbackPages?: number;
}

interface PageLine {
    text: string;
    x: number;
    y: number;
    fs: number;
    bold: boolean;
}

const TOP_MARGIN = 0.04;
const BOTTOM_MARGIN = 0.94;
const LEFT_MARGIN = 0.05;
const RIGHT_MARGIN = 0.95;
const MIN_FONT_HEIGHT = 5.5;

export async function extractPDFInfo(filePath: string): Promise<PDFInfo> {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);

    return {
        pageCount: data.numpages,
        title: data.info?.Title,
        author: data.info?.Author
    };
}

export async function renderPDFPage(filePath: string, pageNum: number, options: RenderOptions = {}): Promise<Buffer> {
    try {
        // Read PDF file
        const data = new Uint8Array(fs.readFileSync(filePath));

        // Load PDF document with options to suppress font warnings
        const loadingTask = pdfjsLib.getDocument({
            data,
            verbosity: 0 // Suppress warnings (0 = errors only, 1 = warnings, 5 = all)
        });
        const pdfDocument = await loadingTask.promise;

        // Get the specific page (pdfjs pages are 1-indexed)
        const page = await pdfDocument.getPage(pageNum + 1);

        // Get viewport with scale for good quality
        const scale = options.scale ?? 2.0;
        const viewport = page.getViewport({ scale });

        // Create canvas
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        // Render page to canvas
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        // Convert canvas to PNG buffer
        return canvas.toBuffer('image/png');
    } catch (error) {
        console.error('[PDF] Error rendering page:', error);
        // Return a simple error image
        const canvas = createCanvas(800, 600);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, 800, 600);
        ctx.fillStyle = '#333';
        ctx.font = '20px Arial';
        ctx.fillText('Error rendering PDF page', 250, 300);
        return canvas.toBuffer('image/png');
    }
}

export async function extractPDFText(filePath: string, pageNum: number): Promise<string> {
    try {
        const data = new Uint8Array(fs.readFileSync(filePath));
        const loadingTask = pdfjsLib.getDocument({ data, verbosity: 0 });
        const pdfDocument = await loadingTask.promise;

        const safePageNum = Math.max(0, Math.min(pageNum, pdfDocument.numPages - 1));
        const page = await pdfDocument.getPage(safePageNum + 1);
        const textContent = await page.getTextContent();

        const text = textContent.items
            .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        await pdfDocument.destroy();
        return text;
    } catch (error) {
        console.error('[PDF] Error extracting text via pdfjs:', error);
        return '';
    }
}

export async function extractPDFWords(filePath: string, pageNum: number): Promise<any[]> {
    try {
        const data = new Uint8Array(fs.readFileSync(filePath));
        const loadingTask = pdfjsLib.getDocument({ data, verbosity: 0 });
        const pdfDocument = await loadingTask.promise;

        const safePageNum = Math.max(0, Math.min(pageNum, pdfDocument.numPages - 1));
        const page = await pdfDocument.getPage(safePageNum + 1);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();

        const words: any[] = [];
        for (const item of textContent.items as any[]) {
            const raw = typeof item?.str === 'string' ? item.str : '';
            if (!raw || !raw.trim()) continue;

            const transformed = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const itemX = transformed[4];
            const baselineY = transformed[5];
            const fontHeight = Math.max(Math.abs(item.height || 0), Math.hypot(transformed[2], transformed[3]));
            const itemWidth = Math.max(0, item.width || 0);
            const topY = baselineY - fontHeight;

            const chars = raw.length || 1;
            const charWidth = itemWidth > 0 ? itemWidth / chars : 0;
            let cursorX = itemX;

            const segments = raw.match(/\S+|\s+/g) || [];
            for (const segment of segments) {
                const segWidth = charWidth * segment.length;
                if (/^\s+$/.test(segment)) {
                    cursorX += segWidth;
                    continue;
                }

                const relX = cursorX / viewport.width;
                const relXEnd = (cursorX + segWidth) / viewport.width;
                const relY = topY / viewport.height;

                if (relY < TOP_MARGIN || relY > BOTTOM_MARGIN) {
                    cursorX += segWidth;
                    continue;
                }
                if (relX < LEFT_MARGIN || relXEnd > RIGHT_MARGIN) {
                    cursorX += segWidth;
                    continue;
                }
                if (fontHeight < MIN_FONT_HEIGHT) {
                    cursorX += segWidth;
                    continue;
                }

                const wPct = (segWidth / viewport.width) * 100;
                const hPct = (fontHeight / viewport.height) * 100;
                const xPct = Math.max(0, Math.min(100 - wPct, (cursorX / viewport.width) * 100));
                const yPct = Math.max(0, Math.min(100 - hPct, (topY / viewport.height) * 100));

                words.push({
                    text: segment,
                    x: xPct,
                    y: yPct,
                    w: wPct,
                    h: hPct
                });

                cursorX += segWidth;
            }
        }

        words.sort((a, b) => {
            const tolerance = Math.max(a.h, b.h) * 0.35;
            if (Math.abs(a.y - b.y) <= tolerance) return a.x - b.x;
            return a.y - b.y;
        });

        let currentLine = -1;
        let lineY = -1;
        let lineH = 0;
        let wordInLine = 0;
        for (const word of words) {
            const sameLine = currentLine >= 0 && Math.abs(word.y - lineY) <= Math.max(lineH, word.h) * 0.6;
            if (!sameLine) {
                currentLine += 1;
                lineY = word.y;
                lineH = word.h;
                wordInLine = 0;
            } else {
                lineH = Math.max(lineH, word.h);
            }
            word.block = 0;
            word.line = currentLine;
            word.word = wordInLine++;
            word.line_id = `0:${currentLine}`;
        }

        const joinedWords: any[] = [];
        for (let i = 0; i < words.length; i += 1) {
            const word = words[i];
            const nextWord = words[i + 1];
            const hyphenLineBreak = /[-\u2010\u2011\u00AD]$/;
            const nextStartsWithWord = /^[A-Za-z0-9]/.test(nextWord?.text || '');
            const movedToNextLine = !!nextWord && (nextWord.line > word.line || nextWord.y > (word.y + (word.h * 0.35)));
            const wrappedLineContinuation = !!nextWord && nextWord.x < word.x;
            const shouldJoinHyphen =
                hyphenLineBreak.test(word?.text || '') &&
                nextWord &&
                nextStartsWithWord &&
                (movedToNextLine || wrappedLineContinuation);

            if (shouldJoinHyphen) {
                joinedWords.push({
                    ...word,
                    text: `${String(word.text).replace(hyphenLineBreak, '')}${nextWord.text}`,
                    w: Math.max(word.w, (nextWord.x + nextWord.w) - word.x),
                    h: Math.max(word.h, (nextWord.y + nextWord.h) - word.y)
                });
                i += 1;
                continue;
            }
            joinedWords.push(word);
        }

        await pdfDocument.destroy();

        console.log(`[PDF] Extracted ${joinedWords.length} words via pdfjs`);
        if (joinedWords.length > 0) {
            console.log(`[PDF] First 5 words:`, joinedWords.slice(0, 5).map((w: any) =>
                `"${w.text}" @ (${w.x.toFixed(2)}%, ${w.y.toFixed(2)}%) ${w.w.toFixed(2)}x${w.h.toFixed(2)}%`
            ));
        }

        return joinedWords;

    } catch (error) {
        console.error('[PDF] Error extracting words via pdfjs:', error);
        // Fallback to simple text extraction
        const text = await extractPDFText(filePath, pageNum);
        const simpleWords = text.split(/\s+/).filter(w => w.length > 0);
        return simpleWords.map(word => ({
            text: word,
            x: undefined,
            y: undefined,
            w: undefined,
            h: undefined
        }));
    }
}

async function extractPDFOutline(filePath: string): Promise<TOCItem[]> {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjsLib.getDocument({ data, verbosity: 0 });
    const pdfDocument = await loadingTask.promise;

    const toc: TOCItem[] = [];
    const pageHeightCache = new Map<number, number>();

    const getPageHeight = async (pageIndex: number): Promise<number> => {
        if (pageHeightCache.has(pageIndex)) {
            return pageHeightCache.get(pageIndex)!;
        }
        const page = await pdfDocument.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        pageHeightCache.set(pageIndex, viewport.height || 1);
        return viewport.height || 1;
    };

    const resolveDestination = async (dest: any): Promise<any[] | null> => {
        if (!dest) return null;
        if (Array.isArray(dest)) return dest;
        if (typeof dest === 'string') {
            try {
                const resolved = await pdfDocument.getDestination(dest);
                return Array.isArray(resolved) ? resolved : null;
            } catch {
                return null;
            }
        }
        return null;
    };

    const extractPageAndY = async (dest: any): Promise<{ page?: number; y_position?: number }> => {
        const destination = await resolveDestination(dest);
        if (!destination || destination.length === 0) {
            return {};
        }

        let pageIndex: number | undefined;
        try {
            pageIndex = await pdfDocument.getPageIndex(destination[0]);
        } catch {
            pageIndex = undefined;
        }

        if (pageIndex === undefined || pageIndex < 0) {
            return {};
        }

        let yPosition = 0;
        const pageHeight = await getPageHeight(pageIndex);
        const destType = destination[1]?.name;
        let top: number | null = null;
        if (destType === 'XYZ') {
            top = destination[3];
        } else if (destType === 'FitH' || destType === 'FitBH') {
            top = destination[2];
        } else if (typeof destination[3] === 'number') {
            top = destination[3];
        }
        if (typeof top === 'number' && Number.isFinite(top)) {
            // PDF "top" is measured from bottom; UI uses 0=top, 1=bottom.
            yPosition = Math.max(0, Math.min(1, (pageHeight - top) / pageHeight));
        }

        return { page: pageIndex, y_position: yPosition };
    };

    const walkOutline = async (items: any[], level = 1): Promise<void> => {
        for (const item of items || []) {
            const title = String(item?.title || '').replace(/\s+/g, ' ').trim();
            if (!title) {
                if (item?.items?.length) {
                    await walkOutline(item.items, level + 1);
                }
                continue;
            }

            const target = await extractPageAndY(item?.dest);
            toc.push({
                title,
                page: target.page,
                level,
                y_position: target.y_position ?? 0
            });

            if (item?.items?.length) {
                await walkOutline(item.items, level + 1);
            }
        }
    };

    try {
        const outline = await pdfDocument.getOutline();
        if (outline && outline.length > 0) {
            await walkOutline(outline, 1);
        }
    } finally {
        await pdfDocument.destroy();
    }

    return toc;
}

async function extractHeuristicTOC(filePath: string, maxFallbackPages: number): Promise<TOCItem[]> {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjsLib.getDocument({ data, verbosity: 0 });
    const pdfDocument = await loadingTask.promise;

    const toc: TOCItem[] = [];
    const limit = Math.max(1, Math.min(pdfDocument.numPages, maxFallbackPages));

    const normalizeTitle = (text: string): string =>
        String(text || '')
            .replace(/\s+/g, ' ')
            .replace(/[•·]/g, ' ')
            .replace(/\.+\s*$/, '')
            .trim();

    const normalizeForMatch = (text: string): string =>
        normalizeTitle(text)
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

    const significantTokens = (text: string): string[] =>
        normalizeForMatch(text)
            .split(' ')
            .filter(t => t.length >= 4);

    const inferLevelFromTitle = (title: string): number => {
        const t = normalizeTitle(title).toLowerCase();
        if (/^(part|unit)\b/.test(t)) return 1;
        if (/^(chapter|appendix|prologue|epilogue)\b/.test(t)) return 2;
        if (/^\d+\.\d+/.test(t) || /^(section|lesson)\b/.test(t)) return 3;
        if (/^(abstract|introduction|conclusion|references|bibliography)\b/.test(t)) return 2;
        return 2;
    };

    const getPageLines = async (pageIndex: number): Promise<{ lines: PageLine[]; height: number; topText: string }> => {
        const page = await pdfDocument.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();

        const rows: PageLine[] = [];
        for (const item of textContent.items as any[]) {
            const text = normalizeTitle(String(item?.str || ''));
            if (!text) continue;

            const transformed = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fs = Math.max(Math.abs(item.height || 0), Math.hypot(transformed[2], transformed[3]));
            const y = transformed[5] - fs;
            const x = transformed[4];
            const fontName = String(item?.fontName || '').toLowerCase();
            const bold = /bold|black|heavy|semibold|demi/.test(fontName);

            rows.push({ text, x, y, fs, bold });
        }

        rows.sort((a, b) => a.y - b.y || a.x - b.x);
        const lines: PageLine[] = [];
        for (const row of rows) {
            let line = lines.find(l => Math.abs(l.y - row.y) <= Math.max(2, l.fs * 0.55, row.fs * 0.55));
            if (!line) {
                line = { text: '', x: row.x, y: row.y, fs: row.fs, bold: row.bold };
                lines.push(line);
            }
            line.fs = Math.max(line.fs, row.fs);
            line.bold = line.bold || row.bold;
            line.x = Math.min(line.x, row.x);
            line.text = `${line.text} ${row.text}`.trim();
        }

        lines.forEach(l => {
            l.text = normalizeTitle(l.text);
        });
        lines.sort((a, b) => a.y - b.y || a.x - b.x);

        const topText = lines
            .filter(l => l.y <= viewport.height * 0.45)
            .slice(0, 8)
            .map(l => l.text)
            .join(' ');

        return { lines, height: viewport.height || 1, topText: normalizeForMatch(topText) };
    };

    const pageCache = new Map<number, { lines: PageLine[]; height: number; topText: string }>();
    const getCachedPage = async (pageIndex: number) => {
        if (!pageCache.has(pageIndex)) {
            pageCache.set(pageIndex, await getPageLines(pageIndex));
        }
        return pageCache.get(pageIndex)!;
    };

    try {
        // Novel mode: if we can confidently detect chapter-start headings,
        // prefer a strict TOC of Chapter/Appendix entries only.
        const novelCandidates: TOCItem[] = [];
        for (let pageIndex = 0; pageIndex < limit; pageIndex += 1) {
            const { lines, height } = await getCachedPage(pageIndex);
            if (lines.length === 0) continue;

            const sortedSizes = lines.map(l => l.fs).sort((a, b) => a - b);
            const median = sortedSizes[Math.floor(sortedSizes.length / 2)] || 10;
            const strongHeadingSize = Math.max(11.2, median * 1.15);

            const topLines = lines.filter(l => l.y >= height * 0.05 && l.y <= height * 0.32);
            for (const line of topLines) {
                const title = normalizeTitle(line.text);
                if (!title || title.length > 60) continue;

                const isChapter = /^chapter\s+([0-9]+|[ivxlcdm]+)\b(?:\s*[:.\-]\s*.*)?$/i.test(title);
                const isAppendix = /^appendix\b/i.test(title);
                if (!isChapter && !isAppendix) continue;

                // Ensure this is a heading style, not inline body text.
                if (!(line.fs >= strongHeadingSize || (line.bold && line.fs >= median * 1.05))) continue;

                novelCandidates.push({
                    title,
                    page: pageIndex,
                    level: isAppendix ? 1 : 2,
                    y_position: Math.max(0, Math.min(1, line.y / height))
                });
                break; // one structural heading per page is enough
            }
        }

        const chapterCount = novelCandidates.filter(i => /^chapter\b/i.test(i.title)).length;
        if (chapterCount >= 8) {
            return novelCandidates;
        }

        const headingCandidates: TOCItem[] = [];
        const repetitionCount = new Map<string, number>();

        // Pass 1: collect heading candidates based on typography + patterns.
        for (let pageIndex = 0; pageIndex < limit; pageIndex += 1) {
            const { lines, height } = await getCachedPage(pageIndex);
            if (lines.length === 0) continue;

            const sortedSizes = lines.map(l => l.fs).sort((a, b) => a - b);
            const median = sortedSizes[Math.floor(sortedSizes.length / 2)] || 10;
            const headingThreshold = Math.max(10.5, median * 1.18);

            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i];
                if (!line.text || line.text.length < 3 || line.text.length > 140) continue;
                if (line.y < height * 0.03 || line.y > height * 0.93) continue; // avoid headers/footers

                const text = line.text;
                const isHeadingPattern =
                    /^(chapter|part|section|unit|lesson|appendix|prologue|epilogue|abstract|introduction|conclusion|references|bibliography)\b/i.test(text) ||
                    /^\d+(\.\d+){0,3}\s+\S+/.test(text) ||
                    /^[IVXLCDM]+\.\s+\S+/i.test(text) ||
                    (/^[A-Z][A-Za-z0-9'":,;()\- ]+$/.test(text) && text.split(/\s+/).length >= 2 && text.split(/\s+/).length <= 12);

                const typographyStrong = line.fs >= headingThreshold || (line.bold && line.fs >= median * 1.05);
                if (!isHeadingPattern && !typographyStrong) continue;
                if (/(copyright|all rights reserved|isbn|www\.|page \d+)/i.test(text)) continue;

                let title = text;
                // Merge common multiline heading blocks.
                if (/^(part|chapter|section|appendix)\b/i.test(title)) {
                    const next = lines[i + 1];
                    if (next && next.y <= line.y + Math.max(26, line.fs * 2.3) && next.text.length >= 4 && next.text.length <= 100) {
                        if (!/^\d+$/.test(next.text) && !/^(copyright|preface|contents)$/i.test(next.text)) {
                            title = `${title} — ${next.text}`;
                        }
                    }
                }

                const normalized = normalizeForMatch(title);
                if (!normalized) continue;
                repetitionCount.set(normalized, (repetitionCount.get(normalized) || 0) + 1);

                headingCandidates.push({
                    title: normalizeTitle(title),
                    page: pageIndex,
                    level: inferLevelFromTitle(title),
                    y_position: Math.max(0, Math.min(1, line.y / height))
                });
            }
        }

        // Remove repeated running headers that appear too frequently.
        const repetitionLimit = Math.max(4, Math.floor(limit * 0.08));
        const filteredHeadings = headingCandidates.filter(item => {
            const norm = normalizeForMatch(item.title);
            return (repetitionCount.get(norm) || 0) <= repetitionLimit;
        });

        // Pass 2: detect explicit "Contents" pages and parse entries with page numbers.
        const contentsEntries: TOCItem[] = [];
        const contentsScanLimit = Math.min(limit, 30);
        for (let pageIndex = 0; pageIndex < contentsScanLimit; pageIndex += 1) {
            const { lines } = await getCachedPage(pageIndex);
            const joined = lines.map(l => l.text).join(' ');
            if (!/(table of contents|contents)\b/i.test(joined)) continue;

            for (const line of lines) {
                const text = normalizeTitle(line.text);
                if (!text || text.length < 4) continue;
                const m = text.match(/^(.+?)\s*(?:\.{2,}|\s)\s*(\d{1,4})$/);
                if (!m) continue;

                const title = normalizeTitle(m[1]);
                const printedPage = Number.parseInt(m[2], 10);
                if (!title || !Number.isFinite(printedPage) || printedPage <= 0) continue;

                // Resolve page using local search around guessed page.
                const guess = Math.max(0, Math.min(limit - 1, printedPage - 1));
                let bestPage = guess;
                let bestScore = -1;
                const tokens = significantTokens(title);
                const windowStart = Math.max(0, guess - 30);
                const windowEnd = Math.min(limit - 1, guess + 30);

                for (let p = windowStart; p <= windowEnd; p += 1) {
                    const pageData = await getCachedPage(p);
                    if (!pageData.topText) continue;
                    let score = 0;
                    for (const token of tokens) {
                        if (pageData.topText.includes(token)) score += 1;
                    }
                    if (score > bestScore) {
                        bestScore = score;
                        bestPage = p;
                    }
                }

                const matchedHeading = filteredHeadings.find(h =>
                    h.page === bestPage &&
                    normalizeForMatch(h.title).includes(normalizeForMatch(title).slice(0, 24))
                );

                contentsEntries.push({
                    title,
                    page: bestPage,
                    level: inferLevelFromTitle(title),
                    y_position: matchedHeading?.y_position ?? 0
                });
            }
        }

        // Prefer parsed contents entries when present; otherwise use heading candidates.
        if (contentsEntries.length >= 4) {
            toc.push(...contentsEntries);
        } else {
            toc.push(...filteredHeadings);
        }
    } finally {
        await pdfDocument.destroy();
    }

    return toc;
}

export async function extractTableOfContents(filePath: string, options: TOCExtractOptions = {}): Promise<any[]> {
    const includeFallback = options.includeFallback ?? true;
    const maxFallbackPages = options.maxFallbackPages ?? 220;

    let toc = await extractPDFOutline(filePath);
    if (toc.length === 0 && includeFallback) {
        toc = await extractHeuristicTOC(filePath, maxFallbackPages);
    }

    const deduped = toc.filter((item, idx, arr) => {
        return arr.findIndex(other =>
            other.title.toLowerCase() === item.title.toLowerCase() &&
            other.page === item.page
        ) === idx;
    });

    const normalizeTitle = (text: string): string =>
        String(text || '').replace(/\s+/g, ' ').trim();

    const isStructural = (title: string): boolean => {
        const t = normalizeTitle(title).toLowerCase();
        return /^(part\s+(one|two|three|four|five|[0-9ivxlcdm]+)|book\s+([0-9ivxlcdm]+)|chapter\s+([0-9ivxlcdm]+)|act\s+([0-9ivxlcdm]+)|section\s+([0-9ivxlcdm]+)|appendix\b|prologue\b|epilogue\b)/i.test(t) ||
            /^(chapter|part|book)\s+([0-9ivxlcdm]+)/i.test(t);
    };

    // If the document clearly has chapter-like structure (e.g., novels),
    // keep only structural entries to avoid noisy body-line "TOC" items.
    const structuralCount = deduped.filter(item => isStructural(item.title)).length;
    let cleaned = deduped;
    if (structuralCount >= 3) {
        cleaned = deduped.filter(item => isStructural(item.title));
    }

    // Remove overlong sentence-like items unless they are explicit structural headings.
    cleaned = cleaned.filter(item => {
        const title = normalizeTitle(item.title);
        const words = title.split(/\s+/).length;
        if (isStructural(title)) return true;
        if (words > 10) return false;
        if (/[.!?]$/.test(title)) return false;
        return true;
    });

    // Keep stable reading order and deterministic display.
    cleaned.sort((a, b) => {
        const pageA = Number.isFinite(a.page) ? Number(a.page) : Number.MAX_SAFE_INTEGER;
        const pageB = Number.isFinite(b.page) ? Number(b.page) : Number.MAX_SAFE_INTEGER;
        if (pageA !== pageB) return pageA - pageB;
        const yA = Number.isFinite(a.y_position) ? Number(a.y_position) : 0;
        const yB = Number.isFinite(b.y_position) ? Number(b.y_position) : 0;
        return yA - yB;
    });

    return cleaned;
}
