@echo off
REM ============================================================
REM  4EVERTOOLS - conversor de YouTube en casa
REM  Convierte en este PC los links de YouTube de la web publicada.
REM  Deja esta ventana abierta. Para apagar: Ctrl+C o cierrala.
REM ============================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 4EVER - conversor de YouTube en casa
set "PYTHONIOENCODING=utf-8"

set "PY=python"
python --version >nul 2>&1 || set "PY=py"
if not exist "backend\.venv\Scripts\python.exe" (
  %PY% --version >nul 2>&1
  if errorlevel 1 (
    echo   [X] No encuentro Python. Instalalo con:  winget install Python.Python.3.12
    goto :fail
  )
  echo   Creando entorno Python ^(solo la primera vez^)...
  %PY% -m venv "backend\.venv"
  if errorlevel 1 goto :fail
)
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo   [X] No encuentro FFmpeg. Instalalo con:  winget install Gyan.FFmpeg
  goto :fail
)

echo   Revisando dependencias y actualizando yt-dlp...
"backend\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "backend\requirements.txt"
"backend\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -U "yt-dlp[default]"

:loop
"backend\.venv\Scripts\python.exe" "backend\scripts\home_converter.py"
if errorlevel 3 goto :fail
if errorlevel 1 (
  echo.
  echo   El conversor se detuvo. Reinicio en 15 segundos... ^(Ctrl+C para salir^)
  timeout /t 15 >nul
  goto :loop
)
goto :end

:fail
echo.
pause
:end
endlocal
