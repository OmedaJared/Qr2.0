if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js")
      .catch(error => console.error("No se pudo activar el modo sin conexión:", error));
  });
}
