@echo off
REM ============================================================
REM  4EVERTOOLS - iniciar todo con doble clic
REM  Abre 2 ventanas (API y WEB) y luego el navegador.
REM  Para apagar: cierra esas 2 ventanas.
REM ============================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 4EVERTOOLS - lanzador

echo.
echo   #4EVER TOOLS - iniciando...
echo.

REM ---------- 1. Revisar herramientas ----------
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] No encuentro Node.js. Instalalo con:  winget install OpenJS.NodeJS.LTS
  goto :fail
)
set "PY=python"
python --version >nul 2>&1 || set "PY=py"
%PY% --version >nul 2>&1
if errorlevel 1 (
  echo   [X] No encuentro Python. Instalalo con:  winget install Python.Python.3.12
  goto :fail
)
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo   [!] No encuentro FFmpeg: la web abre, pero el conversor no va a funcionar.
  echo       Instalalo con:  winget install Gyan.FFmpeg   ^(y vuelve a abrir este archivo^)
  echo.
)

REM ---------- 2. Dependencias de la web (solo la primera vez) ----------
if not exist "node_modules\" (
  echo   [1/2] Instalando dependencias de la web ^(solo la primera vez, ~1 min^)...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo   [X] Fallo npm install. Revisa tu conexion a internet.
    goto :fail
  )
)

REM ---------- 3. Entorno Python del backend (solo la primera vez) ----------
if not exist "backend\.venv\Scripts\python.exe" (
  echo   [2/2] Creando entorno Python del backend ^(solo la primera vez^)...
  %PY% -m venv "backend\.venv"
  if errorlevel 1 (
    echo   [X] No pude crear el entorno Python.
    goto :fail
  )
)
"backend\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "backend\requirements.txt"
if errorlevel 1 (
  echo   [X] Fallo la instalacion de dependencias Python.
  goto :fail
)

REM ---------- 4. Arrancar API y WEB en ventanas propias ----------
echo   Arrancando API  ^(http://localhost:8000^)...
start "4EVER API - cierra esta ventana para apagar" /d "%~dp0backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

echo   Arrancando WEB  ^(http://localhost:4173^)...
start "4EVER WEB - cierra esta ventana para apagar" /d "%~dp0." cmd /k "npm run dev"

REM ---------- 5. Esperar a que la web responda y abrir el navegador ----------
echo   Esperando a que la web este lista...
powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:4173 -TimeoutSec 2 | Out-Null; exit 0}catch{Start-Sleep -Milliseconds 700}}; exit 1"
if errorlevel 1 (
  echo   [!] La web tarda en responder. Revisa la ventana "4EVER WEB".
  echo       Cuando diga "ready", abre http://localhost:4173
  goto :end
)
start "" "http://localhost:4173"

echo.
echo   ============================================================
echo    LISTO. La web esta abierta en http://localhost:4173
echo    Para apagar: cierra las ventanas "4EVER API" y "4EVER WEB".
echo   ============================================================
echo.
echo   Esta ventana se cierra sola en 10 segundos...
timeout /t 10 >nul
goto :end

:fail
echo.
echo   No se pudo iniciar. Corrige lo de arriba y vuelve a abrir iniciar.bat
pause
:end
endlocal
