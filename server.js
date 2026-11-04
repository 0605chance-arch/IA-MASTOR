const express = require("express");
const path = require("path");
const app = express();

const API_BASE = "https://apihub.agnes-ai.com";
const DEFAULT_KEY = process.env.AGNES_API_KEY || null;

app.use(express.json({ limit: "80mb" }));
app.use(express.static(path.join(__dirname, "Public")));

// ==========================================
// KEEP-ALIVE INTERNE (Toutes les 10 minutes)
// ==========================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(async () => {
    try { await fetch(`${RENDER_URL}/api/health`, { method: "GET" }); } catch (e) {}
  }, 10 * 60 * 1000);
}

// ==========================================
// HELPERS
// ==========================================
function getApiKey(req) {
  const h = req.headers["x-api-key"];
  if (typeof h === "string" && h.trim()) return h.trim();
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return DEFAULT_KEY;
}

async function apiFetch(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, keepalive: true });
  } finally {
    clearTimeout(timer);
  }
}

app.use("/api", (req, res, next) => {
  if (req.path === "/health" && req.method === "GET") return next();
  const key = getApiKey(req);
  if (!key) return res.status(401).json({ error: "Clé API manquante." });
  req.apiKey = key;
  next();
});

// ==========================================
// FILE D'ATTENTE VIDÉO (5 RPM) + MÉMOIRE
// ==========================================
const SUBMIT_INTERVAL_MS = 12500; // 5 requêtes / minute
const queues = new Map(); // Une file par clé API
const activeTasks = new Map(); // Stocke l'état de toutes les tâches

function queueKey(apiKey) {
  let h = 0;
  for (let i = 0; i < apiKey.length; i++) { h = (h << 5) - h + apiKey.charCodeAt(i); h |= 0; }
  return "q_" + Math.abs(h);
}

function getOrCreateQueue(apiKey) {
  const k = queueKey(apiKey);
  if (!queues.has(k)) queues.set(k, { jobs: [], processing: false, lastSubmit: 0 });
  return queues.get(k);
}

async function processQueue(apiKey) {
  const q = getOrCreateQueue(apiKey);
  if (q.processing || q.jobs.length === 0) return;
  q.processing = true;

  while (q.jobs.length > 0) {
    const job = q.jobs[0];
    const elapsed = Date.now() - q.lastSubmit;
    if (elapsed < SUBMIT_INTERVAL_MS) await new Promise(r => setTimeout(r, SUBMIT_INTERVAL_MS - elapsed));

    try {
      const r = await apiFetch(`${API_BASE}/v1/videos`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(job.body),
      }, 30000);

      if (r.status === 429 || r.status === 503) {
        await new Promise(r => setTimeout(r, 15000)); // Backoff
        continue;
      }

      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || "Erreur soumission");

      q.lastSubmit = Date.now();
      q.jobs.shift();
      
      // Enregistrement dans la mémoire serveur
      const videoId = data.video_id || data.id;
      activeTasks.set(job.taskId, { status: "processing", videoId, url: null });
      
      // Démarrer la surveillance de cette vidéo
      pollVideoStatus(apiKey, job.taskId, videoId);
      job.resolve({ id: videoId });

    } catch (err) {
      q.jobs.shift();
      job.reject(err);
    }
  }
  q.processing = false;
}

// Surveillance automatique côté serveur
async function pollVideoStatus(apiKey, taskId, videoId) {
  const interval = setInterval(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/agnesapi?video_id=${videoId}&model_name=agnes-video-2.5-flash`, {
        headers: { "Authorization": `Bearer ${apiKey}` }
      }, 20000);
      
      const data = await r.json();
      if (data.status === "completed" && (data.url || data.metadata?.url)) {
        clearInterval(interval);
        activeTasks.set(taskId, { status: "completed", videoId, url: data.url || data.metadata?.url });
      } else if (data.status === "failed") {
        clearInterval(interval);
        activeTasks.set(taskId, { status: "failed", videoId, url: null });
      }
    } catch (e) {
      // Erreur réseau transitoire, on continue de surveiller
    }
  }, 5000); // Vérification toutes les 5s
}

function enqueueVideoJob(apiKey, body, taskId) {
  return new Promise((resolve, reject) => {
    const q = getOrCreateQueue(apiKey);
    q.jobs.push({ body, taskId, resolve, reject });
    processQueue(apiKey).catch(console.error);
  });
}

// ==========================================
// SERVER-SENT EVENTS (SSE) POUR LE TEMPS RÉEL
// ==========================================
const sseClients = new Set();

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// Diffuser l'état des tâches toutes les 2 secondes
setInterval(() => {
  if (sseClients.size === 0) return;
  const tasks = {};
  for (const [id, data] of activeTasks.entries()) {
    tasks[id] = data;
  }
  const payload = `data: ${JSON.stringify(tasks)}\n\n`;
  sseClients.forEach(client => client.write(payload));
}, 2000);

// ==========================================
// ROUTES
// ==========================================

app.get("/api/health", (req, res) => res.json({ status: "awake" }));

app.post("/api/generate-video", async (req, res) => {
  try {
    const { prompt, format, duration, images, taskId } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    let seconds = String(parseInt(duration) || 4);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";

    const body = {
      model: "agnes-video-2.5-flash",
      prompt: `${prompt}, cinematic camera movement, smooth tracking shot, filmic color grading, atmospheric lighting, high detail`,
      seconds,
      size: "720P",
      aspect_ratio: format || "16:9",
      seed: Math.floor(Math.random() * 1000000),
    };

    if (images && Array.isArray(images) && images.length > 0) {
      body.mode = "reference";
      body.images = images.slice(0, 5).map(b => `data:image/jpeg;base64,${b}`);
    } else {
      body.mode = "text";
    }

    // On initialise la tâche dans la mémoire
    activeTasks.set(taskId, { status: "queued", videoId: null, url: null });

    const result = await enqueueVideoJob(req.apiKey, body, taskId);
    res.json({ id: result.id, taskId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ... (Garder les routes /api/health POST, /api/chat, /api/generate-image, /api/studio/generate-storyboard, /api/download/:id inchangées)
