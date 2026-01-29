# Testing the Electron App

## Important: Window Visibility Issue

The Electron app processes are launching successfully, but you might not see the window appear. This could be due to:

1. **Window opening off-screen** - The window might be positioned outside your visible display area
2. **macOS permissions** - The app might need accessibility permissions
3. **Background launching** - The window might be opening behind other windows

## Testing Steps

### Step 1: Test Minimal Electron App

First, let's verify Electron itself works:

```bash
cd test-minimal
./launch-test.sh
```

**Expected result**: You should see a purple window with white text saying "✓ Electron is Working!"

**What to check:**
- Does a window appear on your screen?
- Can you see it in the macOS Dock?
- Can you see it in the Window menu (Cmd+Tab)?

### Step 2: Test Clara App

If the minimal app works, try the full Clara app:

```bash
cd /Users/elicepriyadarshini/Desktop/ClaraStuff/clara_2/electron
./launch-clara.sh
```

**Expected result**: You should see a Clara window with the library view.

## Troubleshooting

### No Window Appears

If you don't see any window:

1. **Check if the process is running:**
   ```bash
   ps aux | grep -i electron | grep -v grep
   ```

2. **Check macOS Dock:**
   - Look for an Electron icon in the Dock
   - Right-click it and see if there's a window listed

3. **Use Window List:**
   - Press Cmd+Tab to see all running applications
   - Look for "Electron" or "Clara"

4. **Check Console for Errors:**
   The launch scripts will show any errors in the terminal

### Window Opens But Is Blank

If the window opens but shows nothing:

1. Open DevTools (the app opens with DevTools in development mode)
2. Check the Console tab for JavaScript errors
3. Check the Network tab to see if files are loading

### Window Opens Off-Screen

If the app is running but window is invisible:

1. Click the Electron/Clara icon in the Dock
2. Go to **Window → Zoom** (or press Cmd+Option+=)
3. This should bring the window back to the main screen

## Direct Commands (No Scripts)

If the scripts don't work, try these direct commands:

**Minimal test:**
```bash
cd /Users/elicepriyadarshini/Desktop/ClaraStuff/clara_2/electron
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron ./test-minimal
```

**Clara app:**
```bash
cd /Users/elicepriyadarshini/Desktop/ClaraStuff/clara_2/electron
NODE_ENV=development env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

## What Should Happen

When the app launches successfully, you should see:

1. **Console output:**
   ```
   Initializing Clara...
   [Database] Initialized at: ...
   [OK] Database initialized
   [IPC] All handlers registered
   [OK] IPC handlers registered
   [OK] Window created

   Clara is ready!
   ```

2. **A window on your screen** with:
   - Clara interface loaded
   - Library view showing
   - Navigation bar at the top
   - Pomodoro timer in the top right

3. **macOS Dock icon** for the Electron app

If you see the console output but no window, the issue is with window visibility or rendering.
