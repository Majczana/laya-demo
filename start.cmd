@echo off
rem Starts the whole demo: backend (FastAPI + LAYA, Jev via .env) and frontend
rem (Vite) in their own windows, then opens the browser. Double-click to run.
rem First run installs the dependencies; servers already running are reused.
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [setup] Creating .venv and installing backend dependencies...
  py -m venv .venv || goto :fail
  ".venv\Scripts\python.exe" -m pip install -r backend\requirements.lock || goto :fail
  ".venv\Scripts\python.exe" -m pip install --no-deps -e backend || goto :fail
)

if not exist "frontend\node_modules" (
  echo [setup] Installing frontend dependencies...
  pushd frontend
  call npm install
  if errorlevel 1 (
    popd
    goto :fail
  )
  popd
)

findstr /b /c:"OPENROUTER_API_KEY=" .env >nul 2>&1 || echo [info] No OPENROUTER_API_KEY in .env - the Jev button will be disabled.

call :listening 8000
if errorlevel 1 (
  echo [backend] Starting on http://localhost:8000 - LAYA loads on the first prediction.
  start "LAYA backend" cmd /k .venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --port 8000 --reload
) else (
  echo [backend] Already running on port 8000.
)

call :listening 5173
if errorlevel 1 (
  echo [frontend] Starting on http://localhost:5173
  start "LAYA frontend" /d frontend cmd /k npm run dev
) else (
  echo [frontend] Already running on port 5173.
)

echo Waiting for the frontend...
for /l %%i in (1,1,60) do (
  call :listening 5173 && goto :open
  ping -n 2 127.0.0.1 >nul
)
echo [error] The frontend did not start. Check the "LAYA frontend" window.
goto :fail

:open
start "" http://localhost:5173
echo Done. Close the "LAYA backend" and "LAYA frontend" windows to stop the demo.
exit /b 0

:listening
netstat -ano | findstr /r /c:":%1 .*LISTENING" >nul
exit /b %errorlevel%

:fail
echo Startup failed.
pause
exit /b 1
