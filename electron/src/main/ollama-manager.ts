import { spawn, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let ollamaProcess: ChildProcess | null = null;
let isOllamaRunning = false;
let defaultModelDownloaded = false;

const DEFAULT_MODEL = 'llama3.2:1b';

/**
 * Check if Ollama is installed on the system
 */
async function isOllamaInstalled(): Promise<boolean> {
    try {
        await execAsync('which ollama');
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if Ollama service is already running
 */
async function checkOllamaRunning(): Promise<boolean> {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Start Ollama server
 */
async function startOllama(): Promise<boolean> {
    console.log('[Ollama] Starting Ollama server...');

    const installed = await isOllamaInstalled();
    if (!installed) {
        console.log('[Ollama] Ollama not installed on system');
        return false;
    }

    // Check if already running
    const alreadyRunning = await checkOllamaRunning();
    if (alreadyRunning) {
        console.log('[Ollama] Ollama already running');
        isOllamaRunning = true;
        return true;
    }

    return new Promise((resolve) => {
        try {
            // Start Ollama serve in background
            ollamaProcess = spawn('ollama', ['serve'], {
                detached: true,
                stdio: 'ignore'
            });

            ollamaProcess.unref();

            // Wait a bit for Ollama to start
            setTimeout(async () => {
                const running = await checkOllamaRunning();
                isOllamaRunning = running;
                if (running) {
                    console.log('[Ollama] Started successfully');
                } else {
                    console.log('[Ollama] Failed to start');
                }
                resolve(running);
            }, 3000);
        } catch (error) {
            console.error('[Ollama] Error starting:', error);
            resolve(false);
        }
    });
}

/**
 * Check if default model is downloaded
 */
async function checkDefaultModel(): Promise<boolean> {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (!response.ok) return false;

        const data = await response.json() as { models?: Array<{ name: string }> };
        const models = data.models || [];
        return models.some((m) => m.name === DEFAULT_MODEL);
    } catch {
        return false;
    }
}

/**
 * Download default model in the background
 */
async function downloadDefaultModel(): Promise<void> {
    if (defaultModelDownloaded) return;

    console.log(`[Ollama] Checking for default model: ${DEFAULT_MODEL}`);

    const hasModel = await checkDefaultModel();
    if (hasModel) {
        console.log('[Ollama] Default model already downloaded');
        defaultModelDownloaded = true;
        return;
    }

    console.log(`[Ollama] Downloading default model: ${DEFAULT_MODEL}`);

    try {
        // Start download in background
        exec(`ollama pull ${DEFAULT_MODEL}`, (error) => {
            if (error) {
                console.error('[Ollama] Error downloading default model:', error);
            } else {
                console.log('[Ollama] Default model downloaded successfully');
                defaultModelDownloaded = true;
            }
        });
    } catch (error) {
        console.error('[Ollama] Error starting download:', error);
    }
}

/**
 * Initialize Ollama - auto-start and download default model
 */
export async function initializeOllama(): Promise<void> {
    console.log('[Ollama] Initializing...');

    // Start Ollama if not running
    const started = await startOllama();

    if (started) {
        // Download default model in background
        setTimeout(() => {
            downloadDefaultModel();
        }, 2000);
    }
}

/**
 * Cleanup on app exit
 */
export function shutdownOllama(): void {
    if (ollamaProcess) {
        console.log('[Ollama] Shutting down...');
        ollamaProcess.kill();
        ollamaProcess = null;
    }
}

/**
 * Get Ollama status
 */
export function getOllamaStatus(): { running: boolean; defaultModelReady: boolean } {
    return {
        running: isOllamaRunning,
        defaultModelReady: defaultModelDownloaded
    };
}
