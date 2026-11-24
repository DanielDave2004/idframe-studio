@echo off
cd /d "%~dp0..\frontend"
if not exist node_modules (
  echo Dependencies are missing. Run npm install from frontend first.
  pause
  exit /b 1
)
npm run dev
