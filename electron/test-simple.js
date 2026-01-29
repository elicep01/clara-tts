const { app, BrowserWindow } = require('electron');

console.log('Script started');

app.whenReady().then(() => {
    console.log('App ready, creating window...');

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        show: true,
        alwaysOnTop: true,
        backgroundColor: '#667eea',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    console.log('Window created!');
    console.log('Visible:', win.isVisible());
    console.log('Focused:', win.isFocused());

    // Load simple HTML inline instead of from file
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                }
                h1 { font-size: 48px; text-align: center; }
            </style>
        </head>
        <body>
            <h1>✓ Electron Works!</h1>
        </body>
        </html>
    `));

    win.webContents.on('did-finish-load', () => {
        console.log('Content loaded successfully!');
        console.log('');
        console.log('========================================');
        console.log('  WINDOW SHOULD BE VISIBLE NOW!');
        console.log('  Look for a purple/gradient window');
        console.log('========================================');

        setTimeout(() => {
            win.setAlwaysOnTop(false);
            console.log('Removed always-on-top');
        }, 3000);
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });
});

app.on('window-all-closed', () => {
    console.log('All windows closed, quitting...');
    app.quit();
});

app.on('activate', () => {
    console.log('Activated - showing windows');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
        win.show();
        win.focus();
    });
});
