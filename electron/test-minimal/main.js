const { app, BrowserWindow } = require('electron');

function createWindow() {
    console.log('Creating window...');

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        x: 100,  // Position explicitly
        y: 100,
        show: true,  // Show immediately
        alwaysOnTop: true,  // Start always on top
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    console.log('Window object created');
    console.log('Window bounds:', win.getBounds());
    console.log('Window visible:', win.isVisible());

    win.webContents.on('did-finish-load', () => {
        console.log('Page finished loading!');

        // Restore if minimized
        if (win.isMinimized()) {
            console.log('Window was minimized, restoring...');
            win.restore();
        }

        // Ensure visible and focused
        win.show();
        win.moveTop();
        win.focus();

        // Remove always-on-top after 3 seconds
        setTimeout(() => {
            win.setAlwaysOnTop(false);
            console.log('Removed always-on-top flag');
        }, 3000);

        console.log('Window state:');
        console.log('  - Visible:', win.isVisible());
        console.log('  - Focused:', win.isFocused());
        console.log('  - Minimized:', win.isMinimized());
        console.log('  - Bounds:', win.getBounds());
        console.log('');
        console.log('====================================');
        console.log('YOU SHOULD NOW SEE A PURPLE WINDOW!');
        console.log('====================================');
    });

    win.loadFile('index.html');
    console.log('Loading index.html...');
}

app.whenReady().then(() => {
    console.log('======================================');
    console.log('Electron app is ready!');
    console.log('Platform:', process.platform);
    console.log('Electron version:', process.versions.electron);
    console.log('Creating window...');
    console.log('======================================');
    createWindow();
});

app.on('window-all-closed', () => {
    console.log('All windows closed');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    console.log('App activated (user clicked Dock icon or Cmd+Tabbed)');
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
        createWindow();
    } else {
        // Show all windows when activated
        windows.forEach(win => {
            console.log('Restoring and showing window...');
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        });
    }
});
