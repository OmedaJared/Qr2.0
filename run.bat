@echo off
setlocal
cd /d "%~dp0"

where uv >nul 2>nul
if errorlevel 1 (
    echo ERROR: No se encontro uv en el PATH.
    echo Instala uv y vuelve a intentarlo.
    pause
    exit /b 1
)

uv run --no-sync python -c "import sys" >nul 2>nul
if errorlevel 1 (
    echo El entorno anterior no es compatible; creando uno nuevo...
    uv venv --clear --python 3.13
    if errorlevel 1 (
        echo.
        echo ERROR: No se pudo crear un entorno virtual con Python 3.13.
        pause
        exit /b 1
    )
)

echo Sincronizando dependencias...
uv sync --locked
if errorlevel 1 (
    echo.
    echo ERROR: uv sync fallo.
    pause
    exit /b 1
)

echo.
echo Iniciando QR Profesores...
echo Abre http://127.0.0.1:5000 en tu navegador.
echo.
uv run python app.py

echo.
echo El servidor se detuvo.
pause
