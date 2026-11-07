@echo off
rem Start FPS-kill web UI (dev server, http://localhost:5173)
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pnpm not found. Install Node.js 22+ and pnpm first.
  pause
  exit /b 1
)
echo Starting FPS-kill web UI ...
echo Browser will open http://localhost:5173 in a few seconds.
echo Stop the server with Ctrl+C in this window.
start "" /b cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:5173"
call pnpm web:dev
pause
