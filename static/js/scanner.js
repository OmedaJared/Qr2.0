const video = document.getElementById("video");
const statusEl = document.getElementById("scanner-status");
const startButton = document.getElementById("start-scanner");
const stopButton = document.getElementById("stop-scanner");
let canvas, ctx, stream;

function stopScanner() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
  startButton.hidden = false;
  stopButton.hidden = true;
}

function cameraErrorMessage(error) {
  if (!window.isSecureContext) {
    return "El navegador bloqueó la cámara porque la dirección no es segura. Abre la app con HTTPS. "
      + "En la misma computadora también funciona con localhost; una dirección local por HTTP "
      + "no funciona para acceder desde el celular.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Este navegador no ofrece acceso a la cámara. Actualízalo o prueba Chrome, Edge o Safari.";
  }
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Se bloqueó el permiso de cámara. Permítelo para este sitio en la configuración "
        + "del navegador y vuelve a intentarlo.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No se encontró una cámara disponible en este dispositivo.";
    case "NotReadableError":
    case "TrackStartError":
      return "La cámara está ocupada por otra aplicación o no se pudo iniciar. Ciérrala en "
        + "las otras aplicaciones y vuelve a intentarlo.";
    case "OverconstrainedError":
      return "No se encontró una cámara compatible. Revisa que el dispositivo tenga una cámara activa.";
    case "SecurityError":
      return "El navegador bloqueó el acceso por seguridad. Usa HTTPS y revisa los permisos del sitio.";
    default:
      return `No se pudo iniciar la cámara${error?.name ? ` (${error.name})` : ""}. `
        + "Revisa HTTPS y los permisos de cámara del sitio.";
  }
}

async function startScanner() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    statusEl.textContent = cameraErrorMessage();
    return;
  }

  startButton.disabled = true;
  statusEl.textContent = "Solicitando permiso para usar la cámara…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No se pudo preparar el lector de imagen.");
    startButton.hidden = true;
    stopButton.hidden = false;
    if (!window.jsQR) {
      statusEl.textContent = "La cámara está activa, pero el lector QR no cargó. "
        + "Conéctate a internet y recarga la página.";
      requestAnimationFrame(scan);
      return;
    }
    requestAnimationFrame(scan);
    statusEl.textContent = "Apunta la cámara al código QR.";
  } catch (error) {
    stopScanner();
    statusEl.textContent = error instanceof Error && error.name === "Error"
      && error.message.startsWith("No se pudo preparar")
      ? error.message
      : cameraErrorMessage(error);
  } finally {
    startButton.disabled = false;
  }
}

function scan() {
  if (!stream?.active) return;
  if (video.readyState >= 2 && video.videoWidth && ctx) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR ? jsQR(image.data, image.width, image.height) : null;
    if (code && code.data) {
      let target;
      try {
        target = new URL(code.data, window.location.origin);
      } catch {
        statusEl.textContent = "El QR no contiene un enlace válido.";
        requestAnimationFrame(scan);
        return;
      }
      const isStudentLink = target.origin === window.location.origin
        && /^\/s\/[^/]+\/?$/.test(target.pathname);
      if (isStudentLink) {
        stopScanner();
        window.location.href = target.href;
        return;
      }
      statusEl.textContent = "El QR no pertenece a esta aplicación.";
    }
  }
  requestAnimationFrame(scan);
}

startButton.addEventListener("click", startScanner);
stopButton.addEventListener("click", () => {
  stopScanner();
  statusEl.textContent = "Cámara detenida.";
});
window.addEventListener("pagehide", stopScanner);
