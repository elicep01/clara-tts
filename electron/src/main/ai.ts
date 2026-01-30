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
    // CRITICAL: Check if we have actual page content - refuse to answer if not
    if (!pageText || pageText.trim().length < 50) {
        console.error('[Gemini] No page content available - refusing to hallucinate');
        return {
            answer: "I couldn't extract text from this page. Please make sure you have a document open and try again.",
            context_used: 0,
            error: 'no_content'
        };
    }

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

    const prompt = `${context}\n\nUser's question: ${question}\n\nIMPORTANT: Answer ONLY based on the document content above. Do NOT make up or guess information. If the answer is not in the text, say "I don't see that information on this page."`;

    try {
        const response = await callGeminiAPI(prompt);
        return {
            answer: response,
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

        // Try to parse JSON from response
        try {
            // Remove markdown code fences if present
            let cleanResponse = response.trim();
            if (cleanResponse.startsWith('```')) {
                cleanResponse = cleanResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            }

            const jsonData = JSON.parse(cleanResponse);
            return jsonData;
        } catch (parseError) {
            // If JSON parsing fails, return a simple structure
            return {
                word: word,
                meanings: [{
                    partOfSpeech: "unknown",
                    definitions: [{
                        definition: response.trim()
                    }]
                }]
            };
        }
    } catch (error) {
        console.error('[Gemini] Error:', error);
        throw new Error(`Definition request failed: ${error}`);
    }
}

function callGeminiAPI(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

        const data = JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.7
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
