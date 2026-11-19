@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Instale o Node.js para abrir a cerimonia.
  pause
  exit /b 1
)
node server.js
if errorlevel 1 pause
