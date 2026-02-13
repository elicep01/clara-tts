import * as https from 'https';

// Gemini API configuration
function getGeminiKey(): string {
    // Check environment variable first
    if (process.env.GEMINI_API_KEY) {
        return process.env.GEMINI_API_KEY;
    }

    // Obfuscated built-in key
    const parts = ['QUl6YVN5QV9wVW9s', 'V2hCUDNIUFByU3Vu', 'YVpDYk1MaDhYLTU2', 'Um9F'];
    return Buffer.from(parts.join(''), 'base64').toString('utf-8');
}

const GEMINI_API_KEY = getGeminiKey();
const GEMINI_MODEL = 'gemini-2.5-flash';

export async function askGemini(question: string, pageText: string, pageNum?: number, docId?: string, docTitle?: string, firstPageText?: string): Promise<any> {
    const sparseContext = !pageText || pageText.trim().length < 120;

    console.log(`[Gemini] Got ${pageText.length} chars of page text, doc: "${docTitle}", page: ${pageNum}`);

    // Build context with ACTUAL page content
    let context = '';

    // Add document info
    if (docTitle) {
        context += `Document: "${docTitle}"\n`;
    }
    if (pageNum) {
        context += `Page: ${pageNum}\n`;
    }
    context += '\n';

    // Detect if this is a book-level question that needs first page
    const questionLower = question.toLowerCase();
    const isBookQuestion = ['this book', 'the book', 'document about', 'what is it about',
        'what is this about', 'summarize the book', 'summarize this book', 'book about']
        .some(phrase => questionLower.includes(phrase));

    // For book-level questions, include first page for better context
    if (isBookQuestion && firstPageText && firstPageText.trim().length > 50) {
        context += `Opening content (Page 1):\n${firstPageText.substring(0, 3000)}\n\n`;
    }

    // ALWAYS include current page content
    context += `Current page content:\n${pageText.substring(0, 4000)}`;

    const instruction = sparseContext
        ? 'The extracted text is sparse. Give a helpful best-effort answer using the document title and available snippets. Clearly mark uncertainty and avoid confident fabrication.'
        : 'Answer ONLY based on the document content above. Do NOT make up or guess information. If the answer is not in the text, say "I don\'t see that information on this page."';

    const prompt = `${context}\n\nUser's question: ${question}\n\nIMPORTANT: ${instruction}`;

    try {
        const response = await callGeminiAPI(prompt);
        const finalResponse = sparseContext
            ? `Note: Text extraction was limited, so this is a best-effort answer.\n\n${response}`
            : response;
        return {
            answer: finalResponse,
            context_used: context ? 1 : 0
        };
    } catch (error) {
        console.error('[Gemini] Error:', error);
        throw new Error(`AI request failed: ${error}`);
    }
}

export async function defineWord(word: string, contextSentence: string, fullContext?: string): Promise<any> {
    const contextToUse = contextSentence || fullContext || 'general usage';

    const prompt = `Define the word "${word}" as used in this context: "${contextToUse}"

Return ONLY a JSON object in this exact format (no markdown, no code fences):
{"word":"${word}","meanings":[{"partOfSpeech":"noun/verb/adjective/etc","definitions":[{"definition":"Clear 1-2 sentence definition"}]}]}

Rules:
- If it's an acronym, expand it first
- If it's technical jargon, explain simply
- Keep definition concise (under 2 sentences)
- Return ONLY the JSON, nothing else`;

    try {
        const response = await callGeminiAPI(prompt);
        console.log('[Gemini] Raw definition response:', response.substring(0, 200));

        // Robust JSON extraction
        const jsonData = extractJSON(response, word);
        if (jsonData) {
            return jsonData;
        }

        // If all parsing fails, create a clean definition from the response
        // Strip any JSON-like content and extract just the definition text
        let cleanDef = response.trim();

        // Try to extract definition from malformed JSON
        const defMatch = cleanDef.match(/"definition"\s*:\s*"([^"]+)"/);
        if (defMatch) {
            cleanDef = defMatch[1];
        } else {
            // Remove any JSON artifacts
            cleanDef = cleanDef
                .replace(/^\{.*?"definition"\s*:\s*"?/s, '')
                .replace(/"?\s*\}.*$/s, '')
                .replace(/^["'\[\{]+/, '')
                .replace(/["'\]\}]+$/, '')
                .trim();
        }

        // Don't show raw JSON as definition
        if (cleanDef.includes('{') || cleanDef.includes('"partOfSpeech"')) {
            cleanDef = `A term related to ${word}. Please try looking up a simpler form of this word.`;
        }

        return {
            word: word,
            meanings: [{
                partOfSpeech: "noun",
                definitions: [{
                    definition: cleanDef
                }]
            }]
        };
    } catch (error) {
        console.error('[Gemini] Error:', error);
        throw new Error(`Definition request failed: ${error}`);
    }
}

export async function transcribeAudioWithGemini(audioBuffer: Buffer, mimeType: string = 'audio/webm'): Promise<string> {
    if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('No audio data provided');
    }

    const base64Audio = audioBuffer.toString('base64');
    const prompt = 'Transcribe this spoken note exactly. Keep punctuation natural and do not add extra commentary.';

    const response = await callGeminiAPIWithParts([
        { text: prompt },
        {
            inlineData: {
                mimeType,
                data: base64Audio
            }
        }
    ], {
        maxOutputTokens: 900,
        temperature: 0.1
    });

    return String(response || '').trim();
}

function extractJSON(response: string, word: string): any | null {
    // Try multiple extraction methods
    let cleanResponse = response.trim();

    // Method 1: Remove markdown code fences
    if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .trim();
    }

    // Method 2: Extract JSON object directly
    const jsonMatch = cleanResponse.match(/\{[\s\S]*"meanings"[\s\S]*\}/);
    if (jsonMatch) {
        cleanResponse = jsonMatch[0];
    }

    // Method 3: Try parsing
    try {
        const parsed = JSON.parse(cleanResponse);

        // Validate structure
        if (parsed.meanings && Array.isArray(parsed.meanings)) {
            // Ensure partOfSpeech is never "unknown" from API
            for (const meaning of parsed.meanings) {
                if (!meaning.partOfSpeech || meaning.partOfSpeech === 'unknown') {
                    meaning.partOfSpeech = 'noun';
                }
            }
            return parsed;
        }
    } catch (e) {
        console.log('[Gemini] JSON parse attempt failed:', e);
    }

    // Method 4: Try fixing common JSON issues
    try {
        // Fix unescaped quotes in definitions
        const fixed = cleanResponse
            .replace(/:\s*"([^"]*)"([^,}\]]*)"([^"]*)"/, ': "$1\'$2\'$3"')
            .replace(/\n/g, ' ')
            .replace(/\r/g, '');

        const parsed = JSON.parse(fixed);
        if (parsed.meanings && Array.isArray(parsed.meanings)) {
            return parsed;
        }
    } catch (e) {
        // Silent fail
    }

    return null;
}

function callGeminiAPI(prompt: string): Promise<string> {
    return callGeminiAPIWithParts(
        [{ text: prompt }],
        {
            maxOutputTokens: 500,
            temperature: 0.7
        }
    );
}

function callGeminiAPIWithParts(parts: any[], generationConfig: { maxOutputTokens?: number; temperature?: number } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

        const data = JSON.stringify({
            contents: [{
                parts
            }],
            generationConfig: {
                maxOutputTokens: generationConfig.maxOutputTokens ?? 500,
                temperature: generationConfig.temperature ?? 0.7
            }
        });

        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';

            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(body);

                    if (result.error) {
                        reject(new Error(result.error.message || 'API error'));
                        return;
                    }

                    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        resolve(text);
                    } else {
                        reject(new Error('No response from API'));
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${error}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

export async function generateSmartTOC(text: string): Promise<any[]> {
    const prompt = `Analyze this document text and extract chapter/section titles. Return as JSON array with format: [{"title": "Chapter 1", "page": 1}]. Text:\n\n${text.substring(0, 5000)}`;

    try {
        const response = await callGeminiAPI(prompt);
        // Try to parse JSON from response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return [];
    } catch (error) {
        console.error('[Gemini] TOC generation failed:', error);
        return [];
    }
}
