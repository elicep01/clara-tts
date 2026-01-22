@echo off
REM Clara Installation Script for Windows
REM Run with: install.bat

echo ==================================================
echo Clara Installation Script for Windows
echo ==================================================
echo.

REM Check Python
echo Checking Python version...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found!
    echo Please install Python 3.8 or higher from https://www.python.org/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

python --version
echo.

REM Check pip
echo Checking pip...
pip --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: pip not found!
    echo Please reinstall Python with pip included.
    pause
    exit /b 1
)
echo pip is available
echo.

REM Install Python dependencies
echo ==================================================
echo Installing Python dependencies...
echo This may take a few minutes...
echo ==================================================
echo.

pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to install Python dependencies!
    echo Please check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo Python dependencies installed successfully!
echo.

REM Check for poppler
echo ==================================================
echo Checking for Poppler...
echo ==================================================
echo.

pdftoppm -v >nul 2>&1
if %errorlevel% equ 0 (
    echo Poppler is installed!
    pdftoppm -v
) else (
    echo.
    echo WARNING: Poppler NOT found!
    echo.
    echo Poppler is REQUIRED for PDF image rendering.
    echo Without it, PDFs will only display as text.
    echo.
    echo ==================================================
    echo POPPLER INSTALLATION INSTRUCTIONS FOR WINDOWS
    echo ==================================================
    echo.
    echo 1. Download poppler from:
    echo    https://github.com/oschwartz10612/poppler-windows/releases/
    echo.
    echo 2. Extract the ZIP file to:
    echo    C:\Program Files\poppler
    echo.
    echo 3. Add to PATH environment variable:
    echo    - Press Win + X, select System
    echo    - Click "Advanced system settings"
    echo    - Click "Environment Variables"
    echo    - Under System variables, find and select "Path"
    echo    - Click "Edit"
    echo    - Click "New"
    echo    - Add: C:\Program Files\poppler\Library\bin
    echo    - Click OK on all dialogs
    echo.
    echo 4. RESTART your computer (required for PATH changes)
    echo.
    echo 5. Run this install script again to verify
    echo.
    echo ==================================================
    echo.

    set /p OPEN_BROWSER="Would you like to open the download page now? (y/n): "
    if /i "%OPEN_BROWSER%"=="y" (
        start https://github.com/oschwartz10612/poppler-windows/releases/
    )
)

echo.
echo ==================================================
echo Installation Complete!
echo ==================================================
echo.

REM Final summary
echo NEXT STEPS:
echo.

pdftoppm -v >nul 2>&1
if %errorlevel% neq 0 (
    echo 1. Install Poppler ^(see instructions above^)
    echo 2. Restart your computer
    echo 3. Run: python app.py
) else (
    echo Run Clara with:
    echo    python app.py
    echo.
    echo For detailed setup instructions, see README.md
)

echo.
echo ==================================================
pause
