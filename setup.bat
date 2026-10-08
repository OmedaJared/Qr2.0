@echo off
setlocal
cd /d "%~dp0"

where uv >nul 2>nul
if errorlevel 1 (
    echo ERROR: No se encontro uv en el PATH.
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

uv sync --locked
if errorlevel 1 (
    echo.
    echo ERROR: No se pudo preparar el proyecto.
    pause
    exit /b 1
)

echo.
echo Proyecto preparado correctamente.
echo Ejecuta run.bat para iniciar la aplicacion.
pause
