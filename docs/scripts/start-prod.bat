@echo off
setlocal

set SCRIPT_DIR=%~dp0
for %%I in ("%SCRIPT_DIR%..\..") do set REPO_ROOT=%%~fI
set APP_DIR=%REPO_ROOT%\applications\ulda-crud

cd /d "%APP_DIR%"

if not exist node_modules (
  echo Installing application dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

if not exist .env (
  echo Creating .env from .env.example
  copy /Y .env.example .env >nul
)

echo Starting ulda-crud in production-like mode...
node src\server.js
