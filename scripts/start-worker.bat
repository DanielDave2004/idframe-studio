@echo off
cd /d "%~dp0..\cloudflare-worker"
if not exist .dev.vars (
  echo Copy .dev.vars.example to .dev.vars and set RATE_LIMIT_SALT first.
  pause
  exit /b 1
)
npx wrangler dev
