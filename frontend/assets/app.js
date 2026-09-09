// Dynamic Backend URL: Port 8000 on the same host/IP as the frontend
function getApiBase() {
  const hostname = window.location.hostname;
  // If running on a network IP or host other than empty/localhost override, use the current host's IP with port 8000
  if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
    const protocol = window.location.protocol.startsWith("http") ? window.location.protocol : "http:";
    return `${protocol}//${hostname}:8000`;
  }
  const custom = localStorage.getItem("lm_custom_api_base");
  if (custom) return custom;
  const protocol = window.location.protocol.startsWith("http") ? window.location.protocol : "http:";
  return `${protocol}//${hostname || "localhost"}:8000`;
}

let API_BASE = getApiBase();

// Parse Query Parameters (for Phone handoff: capture.html?session=sess_xxx&mode=mobile)
const urlParams = new URLSearchParams(window.location.search);
const sessionFromUrl = urlParams.get("session");
const isMobileMode = urlParams.get("mode") === "mobile";

if (sessionFromUrl) {
  localStorage.setItem("lm_current_session_id", sessionFromUrl);
}

let currentSessionId = sessionFromUrl || localStorage.getItem("lm_current_session_id") || null;
let mediaStream = null;
let pollingIntervalId = null;

// Initialize Camera (WebRTC for Desktop/Localhost only)
async function initCamera(videoElementId) {
  if (isMobileMode) return; // Do not call getUserMedia in mobile HTTP mode
  const video = document.getElementById(videoElementId);
  if (!video) return;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = mediaStream;
    video.play();
  } catch (err) {
    console.warn("Camera access failed or not permitted (HTTP/LAN context):", err);
  }
}

// Capture Video Frame to Blob (Desktop)
async function captureVideoFrame(videoElementId) {
  const video = document.getElementById(videoElementId);
  if (!video || !video.videoWidth) return null;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95);
  });
}

// Create New Session via POST /session
async function createSession(category = "PACKAGED_FOOD", inspectorId = "INSP-402", location = "Pune Inspection Facility", productIdentifier = "Package-Batch-101") {
  try {
    const targetUrl = `${API_BASE}/session`;
    console.log("[SESSION] Creating session at:", targetUrl);
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspector_id: inspectorId,
        location: location,
        category: category,
        product_identifier: productIdentifier
      }),
    });
    if (!res.ok) throw new Error("Failed to initialize session");
    const data = await res.json();
    currentSessionId = data.session_id;
    localStorage.setItem("lm_current_session_id", currentSessionId);
    return data;
  } catch (err) {
    console.error("Session creation error:", err);
    alert("Could not create session: " + err.message);
  }
}

// Upload Panel Image via POST /session/{id}/photo
async function uploadPanel(fileBlob, viewType = "FRONT", onStatusUpdate = null) {
  if (!currentSessionId) {
    await createSession();
  }

  const uploadUrl = `${API_BASE}/session/${currentSessionId}/photo`;

  console.log("[MOBILE] uploadPanel invoked");
  console.log("[MOBILE] API_BASE:", API_BASE);
  console.log("[MOBILE] target upload URL:", uploadUrl);
  console.log("[MOBILE] session ID:", currentSessionId);
  console.log("[MOBILE] captured file:", fileBlob);
  console.log("[MOBILE] file type:", fileBlob?.type);
  console.log("[MOBILE] file size (bytes):", fileBlob?.size);

  if (onStatusUpdate) onStatusUpdate("Uploading photo to inspection workstation...");

  const formData = new FormData();
  formData.append("file", fileBlob, `capture_${viewType.toLowerCase()}_${Date.now()}.jpg`);
  formData.append("view_type", viewType.toUpperCase());

  try {
    console.log("[MOBILE] Executing fetch POST to:", uploadUrl);
    const res = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });

    console.log("[MOBILE] fetch response status:", res.status, res.statusText);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("[MOBILE] upload failed error data:", errData);
      throw new Error(errData.detail || `Upload failed with status ${res.status}`);
    }

    if (onStatusUpdate) onStatusUpdate("Checking image quality & running OCR...");
    const data = await res.json();
    console.log("[MOBILE] upload success data:", data);

    if (onStatusUpdate) onStatusUpdate("Processing completed");
    return data;
  } catch (err) {
    console.error("[MOBILE] upload fetch error:", err);
    if (onStatusUpdate) onStatusUpdate("Upload error: " + err.message);
    throw err;
  }
}

// Evaluate Current Session via POST /session/{id}/evaluate
async function evaluateSession() {
  if (!currentSessionId) return null;

  try {
    const res = await fetch(`${API_BASE}/session/${currentSessionId}/evaluate`, {
      method: "POST",
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Evaluation failed");
    }
    return await res.json();
  } catch (err) {
    console.error("Evaluation error:", err);
    throw err;
  }
}

// Fetch Single Session Details via GET /session/{id}
async function fetchSession(sessionId) {
  try {
    const res = await fetch(`${API_BASE}/session/${sessionId}`);
    if (!res.ok) throw new Error("Session fetch failed");
    return await res.json();
  } catch (err) {
    console.error("Fetch session error:", err);
    return null;
  }
}

// Fetch All Sessions via GET /sessions
async function fetchAllSessions() {
  try {
    const res = await fetch(`${API_BASE}/sessions`);
    if (!res.ok) throw new Error("Failed to fetch sessions list");
    return await res.json();
  } catch (err) {
    console.error("Fetch sessions error:", err);
    return [];
  }
}

// Laptop Periodic Polling Loop to detect Field Evidence from Phone
function startLaptopPolling(onNewEvidenceCallback) {
  if (isMobileMode) return; // Laptop polling runs on desktop view only
  if (pollingIntervalId) clearInterval(pollingIntervalId);

  let lastKnownImageCount = -1;
  let lastKnownVerdict = null;

  pollingIntervalId = setInterval(async () => {
    if (!currentSessionId) return;
    const sess = await fetchSession(currentSessionId);
    if (!sess) return;

    const currentImageCount = Object.keys(sess.images || {}).length;
    const currentVerdict = sess.last_evaluation ? sess.last_evaluation.verdict : null;

    if (lastKnownImageCount !== -1 && (currentImageCount > lastKnownImageCount || currentVerdict !== lastKnownVerdict)) {
      if (onNewEvidenceCallback) {
        onNewEvidenceCallback(sess, currentImageCount > lastKnownImageCount);
      }
    }

    lastKnownImageCount = currentImageCount;
    lastKnownVerdict = currentVerdict;
  }, 2000);
}

// Zero-Dependency Light QR Code Image URL Generator
function generateQRCodeURL(text, size = 200) {
  const encodedText = encodeURIComponent(text);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodedText}`;
}

// Construct Mobile Handoff URL (includes mode=mobile)
function getMobileHandoffURL() {
  const port = window.location.port ? `:${window.location.port}` : '';
  const hostname = window.location.hostname || 'localhost';
  const protocol = window.location.protocol.startsWith('http') ? window.location.protocol : 'http:';
  return `${protocol}//${hostname}${port}/capture.html?session=${currentSessionId}&mode=mobile`;
}