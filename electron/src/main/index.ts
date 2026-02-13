import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initDatabase } from './database';
import { setupIPCHandlers } from './ipc';
import { renderPDFPage } from './pdf';
import { getDatabase } from './database';
import { initializeOllama, shutdownOllama } from './ollama-manager';

let mainWindow: BrowserWindow | null = null;
const imageRenderCache = new Map<string, Buffer>();
const MAX_CACHE_ITEMS = 160;

function getCachedImage(key: string): Buffer | null {
    const value = imageRenderCache.get(key);
    if (!value) return null;
    imageRenderCache.delete(key);
    imageRenderCache.set(key, value);
    return value;
}

function setCachedImage(key: string, value: Buffer) {
    imageRenderCache.set(key, value);
    if (imageRenderCache.size > MAX_CACHE_ITEMS) {
        const oldest = imageRenderCache.keys().next().value;
        if (oldest) imageRenderCache.delete(oldest);
    }
}

function getAppIconPath() {
    const icoPath = path.join(__dirname, '../../build/icons/icon.ico');
    const pngPath = path.join(__dirname, '../../build/icons/icon_512x512.png');

    if (process.platform === 'darwin') {
        return pngPath;
    }
    if (process.platform === 'win32') {
        return fs.existsSync(icoPath) ? icoPath : pngPath;
    }
    return pngPath;
}

function createWindow() {
    const iconPath = getAppIconPath();

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#FAFAF9',  // Match --color-bg-primary
        icon: iconPath,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload/index.js'),
            webSecurity: false  // Allow loading local resources
        },
        titleBarStyle: 'hiddenInset', // macOS style
        trafficLightPosition: { x: 15, y: 15 }
    });

    // Intercept requests to document pages
    mainWindow.webContents.session.protocol.handle('file', async (request) => {
        const url = request.url;
        console.log('[Protocol] Handling:', url);

        // Check if this is a document page/thumbnail request
        const match = url.match(/\/document\/([^\/]+)\/(page|thumbnail)\/(\d+)/);
        if (match) {
            const [, doc_id, kind, page_num] = match;
            console.log('[Protocol] Rendering PDF page:', doc_id, page_num, kind);

            try {
                const db = getDatabase();
                const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(doc_id) as any;

                if (doc) {
                    const pageIndex = parseInt(page_num, 10);
                    const cacheKey = `${doc_id}:${kind}:${pageIndex}`;
                    const cached = getCachedImage(cacheKey);
                    if (cached) {
                        return new Response(cached, {
                            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
                        });
                    }

                    const imageBuffer = await renderPDFPage(
                        doc.file_path,
                        pageIndex,
                        { scale: kind === 'thumbnail' ? 0.45 : 1.5 }
                    );
                    setCachedImage(cacheKey, imageBuffer);
                    return new Response(imageBuffer, {
                        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
                    });
                }
            } catch (error) {
                console.error('[Protocol] Error rendering page:', error);
                return new Response('Page render failed', { status: 500 });
            }
        }

        // For other file:// requests, use default handler
        const filePath = url.replace('file:///', '/');

        try {
            const fileBuffer = fs.readFileSync(filePath);

            // Determine MIME type based on file extension
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes: { [key: string]: string } = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.pdf': 'application/pdf',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.ttf': 'font/ttf',
                '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav'
            };

            const contentType = mimeTypes[ext] || 'application/octet-stream';

            return new Response(fileBuffer, {
                headers: { 'Content-Type': contentType }
            });
        } catch (error) {
            return new Response('File not found', { status: 404 });
        }
    });

    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media') {
            callback(true);
            return;
        }
        callback(false);
    });

    // Load the renderer
    mainWindow.loadFile(path.join(__dirname, '../../renderer/clara.html'));
    mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

async function initializeApp() {
    try {
        console.log('Initializing Clara...');
        app.setName('Clara');

        if (process.platform === 'win32') {
            app.setAppUserModelId('com.clara.reader');
        }

        if (process.platform === 'darwin') {
            const dockIcon = path.join(__dirname, '../../build/icons/icon_512x512.png');
            if (fs.existsSync(dockIcon) && app.dock) {
                app.dock.setIcon(dockIcon);
            }
        }

        // Initialize database
        await initDatabase();
        console.log('[OK] Database initialized');

        // Setup IPC handlers
        setupIPCHandlers(ipcMain);
        console.log('[OK] IPC handlers registered');

        // Initialize Ollama (auto-start and download default model)
        initializeOllama();
        console.log('[OK] Ollama initialization started');

        // Create window
        createWindow();
        console.log('[OK] Window created');

        console.log('\nClara is ready!');
    } catch (error) {
        console.error('Failed to initialize:', error);
        app.quit();
    }
}

// App lifecycle
app.whenReady().then(initializeApp);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Handle app quitting
app.on('before-quit', () => {
    shutdownOllama();
});

export { mainWindow };
