@echo off
REM 4EVERTOOLS - arma 4evertools-release.zip para subir al servidor.
REM Deja fuera node_modules, dist, entornos de Python, archivos temporales y tu .env.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "STAGE=%TEMP%\4evertools-release"
set "ZIP=%~dp04evertools-release.zip"

echo Preparando archivos...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
robocopy "%~dp0." "%STAGE%" /E /NFL /NDL /NJH /NJS /NP ^
  /XD node_modules dist .venv storage __pycache__ .git ^
  /XF .env verificacion-log.txt e2e-server.log e2e-youtube.mp3 bpm-benchmark.csv 4evertools-release.zip >nul
if %errorlevel% GEQ 8 (
  echo ERROR copiando archivos.
  pause
  exit /b 1
)

echo Comprimiendo...
if exist "%ZIP%" del "%ZIP%"
REM tar (incluido en Windows 10/11) arma un zip que Linux abre sin problemas.
tar -a -c -f "%ZIP%" -C "%STAGE%" . 2>nul || powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%ZIP%' -Force"
rmdir /s /q "%STAGE%"

echo.
echo ============================================================
echo  LISTO: 4evertools-release.zip
echo  Siguiente paso: DEPLOY-VPS.md, seccion "Subir el proyecto".
echo ============================================================
pause
