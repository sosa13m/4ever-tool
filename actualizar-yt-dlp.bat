@echo off
REM 4EVERTOOLS - actualiza yt-dlp (usalo si YouTube deja de convertir)
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo Primero abre iniciar.bat una vez para crear el entorno.
  pause
  exit /b 1
)
echo Actualizando yt-dlp...
"backend\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -U "yt-dlp[default]"
echo.
"backend\.venv\Scripts\python.exe" -c "import yt_dlp.version as v; print('yt-dlp version:', v.__version__)"
echo.
echo Listo. Si la API estaba abierta, se recarga sola o reiniciala con iniciar.bat
pause
