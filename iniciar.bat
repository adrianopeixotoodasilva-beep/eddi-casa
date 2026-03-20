@echo off
chcp 65001 >nul
title EDDI Casa — Servidor

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║        EDDI Casa — Iniciando...          ║
echo  ╚══════════════════════════════════════════╝
echo.

:: ── Verificar Node.js ──────────────────────────────────────────────────────
echo  [1/3] Verificando Node.js...
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERRO: Node.js nao encontrado!
    echo  Instale em: https://nodejs.org/  (versao LTS recomendada)
    echo.
    pause
    exit /b 1
)
FOR /F "tokens=*" %%i IN ('node --version') DO SET NODE_VER=%%i
echo  Node.js OK — %NODE_VER%

:: ── Verificar Python ───────────────────────────────────────────────────────
echo  [2/3] Verificando Python...
python --version >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    FOR /F "tokens=*" %%i IN ('python --version') DO SET PY_VER=%%i
    echo  Python OK — %PY_VER%
    GOTO :PYTHON_OK
)

python3 --version >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    FOR /F "tokens=*" %%i IN ('python3 --version') DO SET PY_VER=%%i
    echo  Python OK — %PY_VER%
    GOTO :PYTHON_OK
)

py --version >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    FOR /F "tokens=*" %%i IN ('py --version') DO SET PY_VER=%%i
    echo  Python OK — %PY_VER%
    GOTO :PYTHON_OK
)

echo.
echo  ERRO: Python nao encontrado!
echo  Instale em: https://www.python.org/downloads/
echo  IMPORTANTE: marque "Add Python to PATH" durante a instalacao!
echo.
pause
exit /b 1

:PYTHON_OK

:: ── Iniciar servidor ───────────────────────────────────────────────────────
echo  [3/3] Iniciando servidor...
echo.

node server.js

:: Se o servidor parar, manter a janela aberta
echo.
echo  Servidor encerrado.
pause
