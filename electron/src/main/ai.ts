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
    // Detect if question is page-specific or book-level
    const questionLower = question.toLowerCase();
    const isPageSpecific = ['this page', 'current page', 'this chapter', 'current chapter',
        'summarize this', 'summarize the page', 'what is on this page',
        'what does this page say', 'explain this page', 'what is this page about']
        .some(phrase => questionLower.includes(phrase));

    const isBookQuestion = ['this book', 'the book', 'document about', 'what is it about',
        'what is this about', 'summarize the book', 'summarize this book']
        .some(phrase => questionLower.includes(phrase));

    // Build context
    let context = '';

    // Add document title if available
    if (docTitle) {
        context += `Document: "${docTitle}"\n\n`;
    }

    // For book-level questions, include first page for better context
    if (isBookQuestion && firstPageText) {
        context += `Opening content (Page 1):\n${firstPageText.substring(0, 3000)}\n\n`;
        if (pageText && pageNum && pageNum > 1) {
            context += `Current page (${pageNum}) content:\n${pageText.substring(0, 1500)}`;
        }
    } else if (pageText) {
        context += isPageSpecific
            ? `Current page content:\n${pageText.substring(0, 4000)}`
            : `Document content:\n${pageText.substring(0, 4000)}`;
    }

    const prompt = context
        ? `${context}\n\nQuestion: ${question}\n\nProvide a concise, helpful answer based on the document context above. If the context doesn't contain enough information to fully answer, say so and provide what you can infer.`
        : question;

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
