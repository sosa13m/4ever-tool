@echo off
REM 4EVERTOOLS - verificacion completa
REM Doble clic para correr. Todo queda en verificacion-log.txt
setlocal
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
set "LOG=%~dp0verificacion-log.txt"

echo ============================================================
echo  4EVERTOOLS - verificando... puede tardar varios minutos.
echo  No cierres esta ventana. Resultado: verificacion-log.txt
echo ============================================================

echo 4EVERTOOLS verificacion %date% %time%> "%LOG%"

echo.>> "%LOG%"
echo ===== 1. HERRAMIENTAS =====>> "%LOG%"
echo [node]>> "%LOG%"
node -v>> "%LOG%" 2>&1
echo [npm]>> "%LOG%"
call npm -v>> "%LOG%" 2>&1
set "PY=python"
python --version >nul 2>&1 || set "PY=py"
echo [python: %PY%]>> "%LOG%"
%PY% --version>> "%LOG%" 2>&1
echo [ffmpeg]>> "%LOG%"
ffmpeg -hide_banner -version 2>&1 | findstr /b "ffmpeg">> "%LOG%" || echo FFMPEG NO ENCONTRADO>> "%LOG%"
echo [deno]>> "%LOG%"
deno --version>> "%LOG%" 2>&1 || echo DENO NO ENCONTRADO>> "%LOG%"

echo.>> "%LOG%"
echo ===== 2. FRONTEND: npm install =====>> "%LOG%"
echo [1/5] npm install...
call npm install --no-fund --no-audit>> "%LOG%" 2>&1
>> "%LOG%" echo npm install exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3. FRONTEND: npm run build =====>> "%LOG%"
echo [2/5] npm run build...
call npm run build>> "%LOG%" 2>&1
>> "%LOG%" echo npm run build exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3b. FRONTEND: autoprueba BPM =====>> "%LOG%"
echo [2b] autoprueba del detector de BPM...
call npm run test:bpm>> "%LOG%" 2>&1
>> "%LOG%" echo test:bpm exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3c. FRONTEND: autoprueba RADIO =====>> "%LOG%"
echo [2c] autoprueba del motor de la radio...
call npm run test:radio>> "%LOG%" 2>&1
>> "%LOG%" echo test:radio exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3d. FRONTEND: autoprueba TONALIDAD =====>> "%LOG%"
echo [2d] autoprueba del detector de tonalidad...
call npm run test:key>> "%LOG%" 2>&1
>> "%LOG%" echo test:key exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3e. FRONTEND: autoprueba CONVERSOR =====>> "%LOG%"
echo [2e] autoprueba del conversor (historial y detalles)...
call npm run test:converter>> "%LOG%" 2>&1
>> "%LOG%" echo test:converter exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3f. FRONTEND: autoprueba COLECTIVO =====>> "%LOG%"
echo [2f] autoprueba del colectivo (perfiles, links, senales)...
call npm run test:collective>> "%LOG%" 2>&1
>> "%LOG%" echo test:collective exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3g. FRONTEND: autoprueba 4EVER LAB =====>> "%LOG%"
echo [2g] autoprueba de 4EVER LAB (recortar, invertir, velocidad, tono)...
call npm run test:lab>> "%LOG%" 2>&1
>> "%LOG%" echo test:lab exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3h. FRONTEND: autoprueba SONIDOS =====>> "%LOG%"
echo [2h] autoprueba de los sonidos (10 packs x 15 sonidos)...
call npm run test:sfx>> "%LOG%" 2>&1
>> "%LOG%" echo test:sfx exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 3i. FRONTEND: autoprueba DATOS UNDERGROUND =====>> "%LOG%"
echo [2i] autoprueba de los datos underground (textos, fuentes, rotacion)...
call npm run test:lore>> "%LOG%" 2>&1
>> "%LOG%" echo test:lore exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 4. BACKEND: entorno Python =====>> "%LOG%"
echo [3/5] instalando dependencias Python...
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv>> "%LOG%" 2>&1
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt>> "%LOG%" 2>&1
>> "%LOG%" echo pip install exit=%errorlevel%
".venv\Scripts\python.exe" -m pip show yt-dlp fastapi 2>&1 | findstr /b "Name Version">> "%LOG%"

echo.>> "%LOG%"
echo ===== 5. BACKEND: tests unitarios =====>> "%LOG%"
echo [4/5] tests unitarios...
".venv\Scripts\python.exe" -m unittest discover -s tests -v>> "%LOG%" 2>&1
>> "%LOG%" echo unittest exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 5b. PRODUCCION: revision del .env (solo importa al publicar) =====>> "%LOG%"
if not exist "%~dp0.env" goto nopreflight
".venv\Scripts\python.exe" scripts\preflight.py "%~dp0.env">> "%LOG%" 2>&1
>> "%LOG%" echo preflight exit=%errorlevel%
goto afterpreflight
:nopreflight
>> "%LOG%" echo Sin .env de produccion todavia: se omite. Ver DEPLOY-VPS.md
:afterpreflight

echo.>> "%LOG%"
echo ===== 6. BACKEND: prueba real (API + YouTube) =====>> "%LOG%"
echo [5/5] prueba real con YouTube...
".venv\Scripts\python.exe" scripts\e2e_check.py>> "%LOG%" 2>&1
>> "%LOG%" echo e2e exit=%errorlevel%

echo.>> "%LOG%"
echo ===== 7. LOG DEL SERVIDOR (ultimas lineas) =====>> "%LOG%"
if exist e2e-server.log powershell -NoProfile -Command "Get-Content -Tail 60 'e2e-server.log'">> "%LOG%" 2>&1

echo.>> "%LOG%"
echo FIN %date% %time%>> "%LOG%"
echo.
echo ============================================================
echo  LISTO. Avisale a Claude para que lea verificacion-log.txt
echo ============================================================
pause
