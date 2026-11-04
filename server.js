const express = require("express");
const path = require("path");
const app = express();

const API_BASE = "https://apihub.agnes-ai.com";
const DEFAULT_KEY = process.env.AGNES_API_KEY || null;

app.use(express.json({ limit: "80mb" }));
app.use(express.static(path.join(__dirname, "Public")));

// ==========================================
// KEEP-ALIVE INTERNE (Toutes les 5 minutes)
// ==========================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(async () => {
    try { await fetch(`${RENDER_URL}/api/health`, { method: "GET" }); } catch (e) {}
  }, 5 * 60 * 1000);
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
// MÉMOIRE DES TÂCHES + SSE
// ==========================================
const activeTasks = new Map(); // Stocke l'état de toutes les tâches

const sseClients = new Set();
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// Envoi d'un heartbeat toutes les 2s (pour iOS) et d'un signal de vie toutes les 5 min
setInterval(() => {
  if (sseClients.size === 0) return;
  const tasks = {};
  for (const [id, data] of activeTasks.entries()) {
    tasks[id] = data;
  }
  const payload = `data: ${JSON.stringify(tasks)}\n\n: keep-alive\n\n`;
  sseClients.forEach(client => client.write(payload));
}, 2000);

// ==========================================
// ROUTE DE GÉNÉRATION VIDÉO (Contrôle Client + Gestion 429)
// ==========================================
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

    // Envoi direct à Agnes
    const r = await apiFetch(`${API_BASE}/v1/videos`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, 30000);

    // GESTION DES LIMITES DE DÉBIT (429)
    if (r.status === 429) {
      const retryAfter = r.headers.get("retry-after") || "60";
      const waitMs = parseInt(retryAfter, 10) * 1000;
      
      // On informe le client du temps d'attente exact
      return res.status(429).json({ 
        error: "Limite de requêtes atteinte (5 par minute).",
        retryAfter: waitMs 
      });
    }

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Erreur soumission");

    const videoId = data.video_id || data.id;
    activeTasks.set(taskId, { status: "processing", videoId, url: null });
    
    // Lancement de la surveillance
    pollVideoStatus(req.apiKey, taskId, videoId);
    
    res.json({ id: videoId, taskId });

  } catch (err) {
    console.error("Erreur Vidéo:", err);
    res.status(500).json({ error: err.message });
  }
});

// Surveillance (le serveur garde la tâche en vie)
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
      // Erreur réseau transitoire, on réessaiera
    }
  }, 5000);
}

// ==========================================
// AUTRES ROUTES (Chat, Image, Studio, Download)
// ==========================================

app.get("/api/health", (req, res) => res.json({ status: "awake" }));

// ... (Garder les routes /api/health POST, /api/chat, /api/generate-image, /api/studio/generate-storyboard identiques) ...

app.get("/api/download/:id", async (req, res) => {
  // ... (Garder la logique de téléchargement existante) ...
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "Public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Moteur de contrôle client et SSE prêt sur le port ${PORT}`));
