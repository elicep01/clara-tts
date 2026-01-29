import * as fs from 'fs';
import * as path from 'path';
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

export async function extractPDFInfo(filePath: string): Promise<PDFInfo> {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);

    return {
        pageCount: data.numpages,
        title: data.info?.Title,
        author: data.info?.Author
    };
}

export async function renderPDFPage(filePath: string, pageNum: number): Promise<Buffer> {
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
        const scale = 2.0;
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
        // Use Python script for CORRECT page-specific text extraction
        const { spawn } = require('child_process');
        const scriptPath = path.join(__dirname, '../../scripts/extract_pdf_text.py');

        return new Promise((resolve, reject) => {
            const python = spawn('python3', [scriptPath, filePath, pageNum.toString()]);

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            python.on('close', (code: number) => {
                if (code !== 0) {
                    console.error('[PDF] Python text extraction error:', stderr);
                    resolve(''); // Return empty string on error
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    if (result.error) {
                        console.error('[PDF] Text extraction error:', result.error);
                        resolve('');
                        return;
                    }
                    resolve(result.text || '');
                } catch (parseError) {
                    console.error('[PDF] Failed to parse text output:', parseError);
                    resolve('');
                }
            });
        });
    } catch (error) {
        console.error('[PDF] Error calling text extraction script:', error);
        return '';
    }
}

export async function extractPDFWords(filePath: string, pageNum: number): Promise<any[]> {
    try {
        // Call Python script for EXACT word positioning (same code as working Python version)
        const { spawn } = require('child_process');
        const scriptPath = path.join(__dirname, '../../scripts/extract_pdf_words.py');

        return new Promise((resolve, reject) => {
            const python = spawn('python3', [scriptPath, filePath, pageNum.toString()]);

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            python.on('close', (code: number) => {
                if (code !== 0) {
                    console.error('[PDF] Python script error:', stderr);
                    // Fallback to simple text extraction
                    extractPDFText(filePath, pageNum).then(text => {
                        const simpleWords = text.split(/\s+/).filter(w => w.length > 0);
                        resolve(simpleWords.map((word, idx) => ({
                            text: word,
                            x: undefined,
                            y: undefined,
                            w: undefined,
                            h: undefined
                        })));
                    }).catch(() => resolve([]));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);

                    if (result.error) {
                        console.error('[PDF] Python extraction error:', result.error);
                        resolve([]);
                        return;
                    }

                    const words = result.words || [];
                    console.log(`[PDF] Extracted ${words.length} words via Python`);
                    if (words.length > 0) {
                        console.log(`[PDF] First 5 words:`, words.slice(0, 5).map((w: any) =>
                            `"${w.text}" @ (${w.x.toFixed(2)}%, ${w.y.toFixed(2)}%) ${w.w.toFixed(2)}x${w.h.toFixed(2)}%`
                        ));
                    }

                    resolve(words);
                } catch (parseError) {
                    console.error('[PDF] Failed to parse Python output:', parseError);
                    console.error('[PDF] Output was:', stdout);
                    resolve([]);
                }
            });
        });

    } catch (error) {
        console.error('[PDF] Error calling Python script:', error);
        // Fallback to simple text extraction
        const text = await extractPDFText(filePath, pageNum);
        const simpleWords = text.split(/\s+/).filter(w => w.length > 0);
        return simpleWords.map((word, idx) => ({
            text: word,
            x: undefined,
            y: undefined,
            w: undefined,
            h: undefined
        }));
    }
}

export async function extractTableOfContents(filePath: string): Promise<any[]> {
    const pdfDoc = await PDFDocument.load(fs.readFileSync(filePath));
    const toc: any[] = [];

    // TODO: Extract actual TOC from PDF outline
    // This is a simplified placeholder

    return toc;
}
