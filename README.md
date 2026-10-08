# QR Profesores

Sistema web adaptable para profesores: materias, alumnos, códigos QR y tareas. Puede
instalarse como PWA en teléfonos y computadoras, y consultar una copia cifrada de
materias/alumnos sin conexión.

## Ejecutar en Windows

1. Instala Python 3.11, 3.12 o 3.13 y [uv](https://docs.astral.sh/uv/getting-started/installation/).
2. Abre PowerShell en la carpeta del proyecto.
3. Ejecuta `setup.bat` (reconstruye automáticamente un entorno virtual que no sirva).
4. Ejecuta `uv run python app.py` o abre `run.bat`.
5. Visita <http://127.0.0.1:5000>.

`uv.lock` fija las versiones para que el proyecto instale el mismo conjunto de
dependencias en equipos compatibles. No copies `.venv` entre computadoras; `setup.bat`
lo reconstruye si detecta que el entorno apunta a un Python que no existe.

Para ejecutar las pruebas automatizadas:

```powershell
uv run python -m unittest discover -s tests
```

## Publicar en internet

El proyecto incluye un `Dockerfile` para desplegarlo en un servicio compatible con
contenedores. La plataforma debe proporcionar una base de datos PostgreSQL persistente
y estas variables de entorno:

- `APP_ENV=production`
- `SECRET_KEY`: clave aleatoria larga y privada, generada en el hosting
- `DATABASE_URL`: URL de conexión de PostgreSQL

La aplicación no arranca en modo producción si faltan `SECRET_KEY` o `DATABASE_URL`;
así evita iniciar con una clave insegura o una base efímera/local. El hosting debe
conservar su base PostgreSQL entre reinicios. Para generar una clave localmente:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

Después del despliegue, abre la dirección HTTPS en cada dispositivo e instala QR
Profesores desde el menú del navegador (“Instalar aplicación” o “Añadir a pantalla
de inicio”). La cámara y la instalación PWA requieren HTTPS fuera de localhost.
El permiso de cámara se solicita al pulsar **Activar cámara**; si se niega, permite
la cámara para el sitio desde la configuración del navegador y vuelve a intentarlo.

## Uso sin conexión

1. Inicia sesión y abre **Modo sin conexión** con internet.
2. Pulsa **Actualizar copia offline** e introduce la contraseña de la cuenta. Los
   datos se cifran en ese navegador; la contraseña no se guarda.
3. Cuando no haya internet, abre el icono instalado o visita **Modo sin conexión**.
   Introduce la misma contraseña para consultar las materias/alumnos guardados y
   escanear sus QR. Si la pantalla sigue abierta cuando vuelve internet, se te pedirá
   la contraseña para actualizar la copia; también puedes usar **Actualizar copia
   offline** en cualquier momento.

El modo offline es de consulta: no permite crear ni editar registros sin conexión.
La copia es específica de ese navegador/dispositivo, así que hay que sincronizarla
por separado en cada equipo. Usa dispositivos de confianza y cierra la sesión al
terminar. El lector QR utiliza jsQR desde jsDelivr; su primera carga requiere internet.

## Datos existentes

En modo desarrollo se conserva la base SQLite en `instance/qr_profesores.db`. La
base PostgreSQL de producción empieza vacía; exportar los datos locales existentes
a esa base es un paso separado que debe hacerse antes de publicar si se necesitan.
