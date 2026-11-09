@echo off
rem ---------------------------------------------------------------------------
rem ReliefGov — one-time Python ML environment setup (Windows).
rem Creates ml-service\.venv and installs scikit-learn + numpy.
rem ---------------------------------------------------------------------------
setlocal
set "VENV=%~dp0.venv"
if exist "%VENV%\Scripts\python.exe" (
  echo [ReliefGov] Virtual environment already exists: %VENV%
) else (
  echo [ReliefGov] Creating virtual environment...
  python -m venv "%VENV%" || py -3 -m venv "%VENV%"
  if errorlevel 1 (
    echo [ReliefGov] FAILED to create the virtual environment. Install Python 3.10+ first.
    exit /b 1
  )
)
echo [ReliefGov] Installing dependencies from requirements.txt ...
"%VENV%\Scripts\python.exe" -m pip install --quiet --upgrade pip
"%VENV%\Scripts\python.exe" -m pip install --quiet -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo [ReliefGov] FAILED to install Python dependencies.
  exit /b 1
)
echo [ReliefGov] Python ML environment ready: %VENV%
exit /b 0
