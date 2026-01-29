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

export async function askGemini(question: string, context: string): Promise<string> {
    const prompt = context
        ? `Context: ${context}\n\nQuestion: ${question}\n\nProvide a concise answer based on the context.`
        : question;

    try {
        const response = await callGeminiAPI(prompt);
        return response;
    } catch (error) {
        console.error('[Gemini] Error:', error);
        throw new Error(`AI request failed: ${error}`);
    }
}

export async function defineWord(word: string, context: string): Promise<string> {
    const prompt = `Define the word "${word}" as used in this context: "${context}". Give a concise definition relevant to how it's used here.`;

    try {
        const response = await callGeminiAPI(prompt);
        return response;
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
