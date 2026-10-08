const form = document.getElementById("offline-form");
const passwordInput = document.getElementById("offline-password");
const statusElement = document.getElementById("offline-status");
const listElement = document.getElementById("offline-list");
const updatedElement = document.getElementById("offline-updated");
const video = document.getElementById("offline-video");
const scanButton = document.getElementById("start-offline-scan");
const scanStatus = document.getElementById("offline-scan-status");
const resultElement = document.getElementById("offline-scan-result");
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let scannerStream;
let cameraCanvas;
let cameraContext;
let unlockedData;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("qr-profesores-offline", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getSnapshot() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("snapshots").objectStore("snapshots").get("latest");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function saveSnapshot(snapshot) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("snapshots", "readwrite");
    transaction.objectStore("snapshots").put(snapshot, "latest");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptSnapshot(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(JSON.stringify(data))
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    savedAt: new Date().toISOString()
  };
}

async function decryptSnapshot(snapshot, password) {
  const key = await deriveKey(password, base64ToBytes(snapshot.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(snapshot.iv) },
    key,
    base64ToBytes(snapshot.ciphertext)
  );
  return JSON.parse(textDecoder.decode(plaintext));
}

function renderSnapshot(data, savedAt = new Date().toISOString()) {
  unlockedData = data;
  listElement.replaceChildren();
  for (const subject of data.subjects) {
    const section = document.createElement("section");
    section.className = "card offline-subject";
    const title = document.createElement("h2");
    title.textContent = subject.name;
    const details = document.createElement("p");
    details.textContent = `${subject.specialty} · Grupo ${subject.group_name}`;
    section.append(title, details);

    for (const student of subject.students) {
      const item = document.createElement("article");
      item.className = "offline-student";
      const name = document.createElement("strong");
      name.textContent = student.full_name;
      item.append(name);
      if (student.student_number) {
        const number = document.createElement("p");
        number.textContent = `Matrícula: ${student.student_number}`;
        item.append(number);
      }
      section.append(item);
    }
    listElement.append(section);
  }
  updatedElement.textContent = `Copia guardada: ${new Date(savedAt).toLocaleString()}`;
}

async function syncSnapshot(password) {
  const response = await fetch("/api/offline-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    cache: "no-store"
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Inicia sesión con internet antes de sincronizar la copia.");
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "No se pudo actualizar la copia.");
  }
  const encrypted = await encryptSnapshot(data, password);
  await saveSnapshot(encrypted);
  renderSnapshot(data, encrypted.savedAt);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const password = passwordInput.value;
  const action = event.submitter?.value;
  statusElement.textContent = "Procesando…";
  try {
    if (action === "sync") {
      if (!navigator.onLine) throw new Error("Conéctate a internet para sincronizar.");
      await syncSnapshot(password);
      statusElement.textContent = "Copia cifrada actualizada.";
    } else {
      const snapshot = await getSnapshot();
      if (!snapshot) throw new Error("Todavía no hay una copia offline en este dispositivo.");
      const data = await decryptSnapshot(snapshot, password);
      renderSnapshot(data, snapshot.savedAt);
      statusElement.textContent = "Copia offline desbloqueada.";
    }
  } catch (error) {
    statusElement.textContent = error.message === "OperationError"
      ? "La contraseña no coincide o la copia está dañada."
      : error.message;
    unlockedData = null;
    listElement.replaceChildren();
  } finally {
    passwordInput.value = "";
  }
});

window.addEventListener("online", async () => {
  if (!unlockedData) return;
  const password = window.prompt(
    "Se restableció la conexión. Introduce la contraseña para actualizar la copia offline."
  );
  if (!password) {
    statusElement.textContent = "Conexión restablecida; la copia no se actualizó.";
    return;
  }
  statusElement.textContent = "Actualizando la copia offline…";
  try {
    await syncSnapshot(password);
    statusElement.textContent = "Copia cifrada sincronizada.";
  } catch (error) {
    statusElement.textContent = error.message;
  }
});

async function studentForQr(value) {
  if (unlockedData) {
    return findStudent(unlockedData, value);
  }
  const snapshot = await getSnapshot();
  if (!snapshot) return null;
  const password = window.prompt("Introduce la contraseña para consultar la copia offline.");
  if (password === null) return null;
  const data = await decryptSnapshot(snapshot, password);
  return findStudent(data, value);
}

function findStudent(data, value) {
  let token;
  try {
    const url = new URL(value, location.origin);
    const match = url.pathname.match(/^\/s\/([^/]+)\/?$/);
    token = match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
  if (!token) return null;
  for (const subject of data.subjects) {
    const student = subject.students.find(item => item.qr_token === token);
    if (student) return { student, subject };
  }
  return null;
}

function showScannedStudent(match) {
  resultElement.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = match.student.full_name;
  const subject = document.createElement("p");
  subject.textContent = `${match.subject.name} · Grupo ${match.subject.group_name}`;
  resultElement.append(title, subject);
  if (match.student.student_number) {
    const number = document.createElement("p");
    number.textContent = `Matrícula: ${match.student.student_number}`;
    resultElement.append(number);
  }
}

async function scanFrame() {
  if (!scannerStream?.active) return;
  if (video.readyState >= 2 && video.videoWidth && window.jsQR) {
    cameraCanvas.width = video.videoWidth;
    cameraCanvas.height = video.videoHeight;
    cameraContext.drawImage(video, 0, 0, cameraCanvas.width, cameraCanvas.height);
    const image = cameraContext.getImageData(0, 0, cameraCanvas.width, cameraCanvas.height);
    const code = window.jsQR(image.data, image.width, image.height);
    if (code?.data) {
      scannerStream.getTracks().forEach(track => track.stop());
      try {
        const match = await studentForQr(code.data);
        if (match) {
          showScannedStudent(match);
          scanStatus.textContent = "Alumno encontrado en la copia offline.";
        } else {
          scanStatus.textContent = "El QR no corresponde a un alumno guardado en esta copia.";
        }
      } catch {
        scanStatus.textContent = "No se pudo desbloquear la copia para buscar este QR.";
      }
      return;
    }
  }
  requestAnimationFrame(scanFrame);
}

scanButton.addEventListener("click", async () => {
  if (!window.jsQR) {
    scanStatus.textContent = "El lector QR requiere una primera carga con internet.";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    scanStatus.textContent = "Este navegador no permite usar la cámara. Comprueba HTTPS.";
    return;
  }
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    video.srcObject = scannerStream;
    video.hidden = false;
    cameraCanvas = document.createElement("canvas");
    cameraContext = cameraCanvas.getContext("2d", { willReadFrequently: true });
    scanStatus.textContent = "Apunta la cámara al QR del alumno.";
    requestAnimationFrame(scanFrame);
  } catch {
    scanStatus.textContent = "No se pudo acceder a la cámara. Revisa los permisos.";
  }
});

window.addEventListener("pagehide", () => {
  scannerStream?.getTracks().forEach(track => track.stop());
});

getSnapshot().then(snapshot => {
  if (snapshot) {
    updatedElement.textContent = `Copia guardada: ${new Date(snapshot.savedAt).toLocaleString()}`;
    statusElement.textContent = "Copia cifrada disponible. Desbloquéala con tu contraseña.";
  }
}).catch(error => {
  statusElement.textContent = `No se pudo abrir el almacenamiento offline: ${error.message}`;
});
