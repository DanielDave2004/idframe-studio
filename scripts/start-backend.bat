@echo off
cd /d "%~dp0..\backend"
if not exist .venv\Scripts\python.exe (
  echo Create the Python environment in backend first.
  echo py -3.13 -m venv .venv
  echo .venv\Scripts\python.exe -m pip install -r requirements.txt
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
