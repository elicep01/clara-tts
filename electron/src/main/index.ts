import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { initDatabase } from './database';
import { setupIPCHandlers } from './ipc';
import { Server } from 'socket.io';

let mainWindow: BrowserWindow | null = null;
let io: Server | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#FAFAFA',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload/index.js')
        },
        titleBarStyle: 'hiddenInset', // macOS style
        trafficLightPosition: { x: 15, y: 15 }
    });

    // Load the renderer
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

async function initializeApp() {
    try {
        console.log('Initializing Clara...');

        // Initialize database
        await initDatabase();
        console.log('[OK] Database initialized');

        // Setup IPC handlers
        setupIPCHandlers(ipcMain);
        console.log('[OK] IPC handlers registered');

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
    // Cleanup
    if (io) {
        io.close();
    }
});

export { mainWindow, io };
