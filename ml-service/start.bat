@echo off
rem ---------------------------------------------------------------------------
rem ReliefGov — start the Python Random Forest scoring microservice.
rem Uses ml-service\.venv (created by setup.bat). If the venv is missing this
rem prints the fix and exits non-zero; the Express API will report the scoring
rem module as unavailable (HTTP 503) instead of fabricating any score.
rem ---------------------------------------------------------------------------
setlocal
set "VENV=%~dp0.venv"
if not exist "%VENV%\Scripts\python.exe" (
  echo [ReliefGov] Python ML virtual environment not found.
  echo [ReliefGov] Run ml-service\setup.bat once to create it, then start again.
  exit /b 1
)
"%VENV%\Scripts\python.exe" "%~dp0app.py"
