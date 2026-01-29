import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getAudioCacheFolder } from './database';

const execAsync = promisify(exec);

export interface WordTiming {
    text: string;
    offset: number;
    duration: number;
}

export interface Voice {
    ShortName: string;
    Gender: string;
    Locale: string;
    SuggestedCodec: string;
    FriendlyName: string;
    Status: string;
}

const TTS_VOICES = {
    female: 'en-US-JennyNeural',
    male: 'en-US-GuyNeural'
};

// Cache for available voices
let cachedVoices: Voice[] | null = null;

/**
 * Get all available Edge TTS voices from pre-generated JSON file
 */
export async function getAvailableVoices(): Promise<Voice[]> {
    // Return cached voices if available
    if (cachedVoices) {
        console.log(`[TTS] Returning ${cachedVoices.length} cached voices`);
        return cachedVoices;
    }

    try {
        // Load voices from pre-generated JSON file
        const voicesPath = path.join(__dirname, 'voices.json');
        console.log(`[TTS] Loading voices from: ${voicesPath}`);

        const voicesData = fs.readFileSync(voicesPath, 'utf-8');
        const voices: Voice[] = JSON.parse(voicesData);

        // Cache the voices
        cachedVoices = voices;

        console.log(`[TTS] Loaded ${voices.length} available voices`);
        return voices;
    } catch (error) {
        console.error('[TTS] Failed to load voices from JSON:', error);
        // Return default voices if loading fails
        return [
            {
                ShortName: 'en-US-JennyNeural',
                Gender: 'Female',
                Locale: 'en-US',
                SuggestedCodec: 'audio-24khz-48kbitrate-mono-mp3',
                FriendlyName: 'Microsoft Jenny Online (Natural) - English (United States)',
                Status: 'GA'
            },
            {
                ShortName: 'en-US-GuyNeural',
                Gender: 'Male',
                Locale: 'en-US',
                SuggestedCodec: 'audio-24khz-48kbitrate-mono-mp3',
                FriendlyName: 'Microsoft Guy Online (Natural) - English (United States)',
                Status: 'GA'
            }
        ];
    }
}

export async function generateAudioWithTimings(
    text: string,
    voice: string = 'en-US-JennyNeural'
): Promise<{ audioPath: string; timings: WordTiming[] }> {
    // Support both shorthand ('male'/'female') and full voice IDs
    let voiceName = voice;
    if (voice === 'male' || voice === 'female') {
        voiceName = TTS_VOICES[voice as keyof typeof TTS_VOICES];
    }

    // Create cache key
    const cacheKey = crypto.createHash('md5').update(`${text}:${voiceName}`).digest('hex');
    const cacheFile = path.join(getAudioCacheFolder(), `${cacheKey}.mp3`);
    const timingsFile = path.join(getAudioCacheFolder(), `${cacheKey}_timings.json`);

    // Check cache
    if (fs.existsSync(cacheFile) && fs.existsSync(timingsFile)) {
        console.log(`[TTS] Cache hit: ${cacheKey.substring(0, 8)}...`);
        const timings = JSON.parse(fs.readFileSync(timingsFile, 'utf-8'));
        return { audioPath: cacheFile, timings };
    }

    console.log(`[TTS] Generating audio for ${text.split(' ').length} words...`);

    // Check if edge-tts is available
    try {
        await execAsync('edge-tts --version');
    } catch (error) {
        console.error('[TTS] edge-tts not found, using fallback');
        return generateFallbackAudio(text, cacheFile);
    }

    try {
        // Generate audio with edge-tts CLI
        const tempFile = path.join(getAudioCacheFolder(), `${cacheKey}_temp.mp3`);
        const tempTimingsFile = path.join(getAudioCacheFolder(), `${cacheKey}_temp_timings.json`);

        // Use edge-tts to generate audio and word boundaries
        const command = `edge-tts --voice "${voiceName}" --text "${text.replace(/"/g, '\\"')}" --write-media "${tempFile}" --write-subtitles "${tempTimingsFile}"`;

        await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });

        // Parse timings from subtitle file (WebVTT format)
        const timings = parseEdgeTTSTimings(tempTimingsFile);

        // Move files to cache
        fs.renameSync(tempFile, cacheFile);
        fs.writeFileSync(timingsFile, JSON.stringify(timings));

        // Cleanup temp files
        if (fs.existsSync(tempTimingsFile)) {
            fs.unlinkSync(tempTimingsFile);
        }

        console.log(`[TTS] Generated audio with ${timings.length} word timings`);

        return { audioPath: cacheFile, timings };
    } catch (error) {
        console.error('[TTS] Generation failed:', error);
        return generateFallbackAudio(text, cacheFile);
    }
}

function parseEdgeTTSTimings(subtitleFile: string): WordTiming[] {
    if (!fs.existsSync(subtitleFile)) {
        return [];
    }

    const content = fs.readFileSync(subtitleFile, 'utf-8');
    const timings: WordTiming[] = [];

    // Parse WebVTT format
    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();

        // Look for timestamp lines (00:00:00.000 --> 00:00:01.000)
        if (line.includes('-->')) {
            const [startStr, endStr] = line.split('-->').map(s => s.trim());
            const startSec = parseTimestamp(startStr);
            const endSec = parseTimestamp(endStr);

            // Next line should be the text
            i++;
            if (i < lines.length) {
                const text = lines[i].trim();
                if (text) {
                    // Split phrase into individual words and distribute timing
                    const words = text.split(/\s+/).filter(w => w.length > 0);
                    const totalDuration = endSec - startSec;

                    if (words.length === 1) {
                        // Single word
                        timings.push({
                            text: text,
                            offset: startSec,
                            duration: totalDuration
                        });
                    } else {
                        // Multiple words - distribute timing proportionally
                        // Weight by word length for more accurate timing
                        const wordLengths = words.map(w => w.length);
                        const totalLength = wordLengths.reduce((sum, len) => sum + len, 0);

                        let currentOffset = startSec;
                        words.forEach((word, idx) => {
                            const wordWeight = wordLengths[idx] / totalLength;
                            const wordDuration = totalDuration * wordWeight;

                            timings.push({
                                text: word,
                                offset: currentOffset,
                                duration: wordDuration
                            });

                            currentOffset += wordDuration;
                        });
                    }
                }
            }
        }
        i++;
    }

    console.log(`[TTS] Parsed ${timings.length} word-level timings from edge-tts`);
    if (timings.length > 0) {
        console.log(`[TTS] First 3 timings:`, timings.slice(0, 3).map(t =>
            `"${t.text}" @ ${t.offset.toFixed(2)}s (${t.duration.toFixed(2)}s)`
        ));
    }

    return timings;
}

function parseTimestamp(timestamp: string): number {
    // Parse timestamp like "00:00:01.234" to seconds
    const parts = timestamp.split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const secondsParts = parts[2].split('.');
    const seconds = parseInt(secondsParts[0]);
    const milliseconds = parseInt(secondsParts[1] || '0');

    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

async function generateFallbackAudio(text: string, outputPath: string): Promise<{ audioPath: string; timings: WordTiming[] }> {
    // Fallback to macOS 'say' command
    console.log('[TTS] Using macOS fallback');

    try {
        const aiffPath = outputPath.replace('.mp3', '.aiff');
        await execAsync(`say -o "${aiffPath}" "${text.replace(/"/g, '\\"')}"`);

        // Convert AIFF to MP3 if ffmpeg is available
        try {
            await execAsync(`ffmpeg -i "${aiffPath}" -acodec libmp3lame "${outputPath}"`);
            fs.unlinkSync(aiffPath);
        } catch {
            // If ffmpeg not available, just use AIFF
            fs.renameSync(aiffPath, outputPath);
        }

        // Estimate timings (no precise word boundaries with 'say')
        const words = text.split(/\s+/);
        const estimatedDuration = words.length * 0.5; // ~0.5s per word
        const timings: WordTiming[] = words.map((word, i) => ({
            text: word,
            offset: i * 0.5,
            duration: 0.5
        }));

        return { audioPath: outputPath, timings };
    } catch (error) {
        throw new Error(`Fallback TTS failed: ${error}`);
    }
}

export async function getWordTimings(text: string, voice: string): Promise<WordTiming[]> {
    const { timings } = await generateAudioWithTimings(text, voice);
    return timings;
}

/**
 * Generate preview audio for a voice
 * Returns audio buffer for immediate playback
 */
export async function generatePreviewAudio(
    voiceId: string,
    text: string = 'Hello, this is a preview of my voice.'
): Promise<Buffer> {
    try {
        // Generate audio with timings
        const { audioPath } = await generateAudioWithTimings(text, voiceId);

        // Read and return the audio file
        const audioBuffer = fs.readFileSync(audioPath);
        return audioBuffer;
    } catch (error) {
        console.error('[TTS] Preview generation failed:', error);
        throw new Error('Failed to generate preview audio');
    }
}
