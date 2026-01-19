@echo off
REM Clara Desktop App - Windows Build Script
REM Creates a distributable .exe file for Windows

echo ================================
echo Clara - Windows Build Script
echo ================================
echo.

REM Get script directory
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

REM Check Python
echo Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://python.org
    pause
    exit /b 1
)
python --version

REM Create virtual environment if not exists
echo.
echo Setting up virtual environment...
if not exist "venv" (
    python -m venv venv
)
call venv\Scripts\activate.bat

REM Install dependencies
echo.
echo Installing dependencies...
pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

REM Clean previous builds
echo.
echo Cleaning previous builds...
if exist "build" rmdir /s /q build
if exist "dist" rmdir /s /q dist

REM Build the app
echo.
echo Building Clara.exe...
echo This may take several minutes...
echo.

pyinstaller clara.spec --clean --noconfirm

REM Check if build was successful
if exist "dist\Clara.exe" (
    echo.
    echo ================================
    echo Build successful!
    echo ================================
    echo.
    echo Your app is ready at:
    echo   %SCRIPT_DIR%dist\Clara.exe
    echo.
    echo To share with friends:
    echo   1. Copy Clara.exe to a zip file
    echo   2. Share the zip file
    echo.
    echo Note: Windows Defender may flag the app as unknown.
    echo This is normal for unsigned applications.
    echo Click "More info" and "Run anyway" to proceed.
    echo.

    REM Open the dist folder
    explorer dist
) else (
    echo.
    echo Build failed!
    echo Check the output above for errors.
    pause
    exit /b 1
)

pause
