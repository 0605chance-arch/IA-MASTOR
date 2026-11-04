const express = require("express");
const path = require("path");
const app = express();

const API_BASE = "https://apihub.agnes-ai.com";
const DEFAULT_KEY = process.env.AGNES_API_KEY || null;

app.use(express.json({ limit: "60mb" }));
app.use(express.static(path.join(__dirname, "Public")));

// ==========================================
// KEEP-ALIVE (Anti-endormissement Render)
// ==========================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL; // Render fournit cette variable automatiquement
if (RENDER_URL) {
  const pingInterval = 10 * 60 * 1000; // 10 minutes
  setInterval(async () => {
    try {
      await fetch(`${RENDER_URL}/api/health`, { method: "GET" });
      console.log("💓 Keep-Alive ping envoyé.");
    } catch (e) {
      console.log("⚠️ Keep-Alive échoué.");
    }
  }, pingInterval);
  console.log(`Keep-Alive activé pour ${RENDER_URL}`);
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

async function apiFetch(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, keepalive: true });
  } finally {
    clearTimeout(timer);
  }
}

app.use("/api", (req, res, next) => {
  // Exception pour le keep-alive qui n'a pas besoin de clé API
  if (req.path === "/health" && req.method === "GET") return next();
  
  const key = getApiKey(req);
  if (!key) return res.status(401).json({ error: "Clé API manquante." });
  req.apiKey = key;
  next();
});

// ==========================================
// FILE D'ATTENTE VIDÉO (5 RPM)
// ==========================================
const SUBMIT_INTERVAL_MS = 12500; // 5 requêtes / minute
const videoQueues = new Map();

function queueKey(apiKey) {
  let h = 0;
  for (let i = 0; i < apiKey.length; i++) {
    h = (h << 5) - h + apiKey.charCodeAt(i);
    h |= 0;
  }
  return "q_" + Math.abs(h);
}

function getOrCreateQueue(apiKey) {
  const k = queueKey(apiKey);
  if (!videoQueues.has(k)) {
    videoQueues.set(k, { jobs: [], processing: false, lastSubmit: 0 });
  }
  return videoQueues.get(k);
}

async function processQueue(apiKey) {
  const q = getOrCreateQueue(apiKey);
  if (q.processing || q.jobs.length === 0) return;
  q.processing = true;

  while (q.jobs.length > 0) {
    const job = q.jobs[0];
    const now = Date.now();
    const elapsed = now - q.lastSubmit;

    if (elapsed < SUBMIT_INTERVAL_MS) {
      const wait = SUBMIT_INTERVAL_MS - elapsed;
      await new Promise((r) => setTimeout(r, wait));
    }

    try {
      const r = await apiFetch(`${API_BASE}/v1/videos`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(job.body),
      }, 30000);

      if (r.status === 429) {
        const retryAfter = 15000 + Math.random() * 5000;
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }

      // Sécurité : vérifier que la réponse est du JSON
      const contentType = r.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
         throw new Error(`Serveur Agnes indisponible (Erreur ${r.status}).`);
      }

      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || "Erreur soumission vidéo");

      q.lastSubmit = Date.now();
      q.jobs.shift();
      job.resolve({ id: data.video_id || data.id });

    } catch (err) {
      q.jobs.shift();
      job.reject(err);
    }
  }
  q.processing = false;
}

function enqueueVideoJob(apiKey, body) {
  return new Promise((resolve, reject) => {
    const q = getOrCreateQueue(apiKey);
    q.jobs.push({ body, resolve, reject });
    processQueue(apiKey).catch((err) => console.error("Queue error:", err));
  });
}

// ==========================================
// ROUTES
// ==========================================

// Route GET pour le Keep-Alive
app.get("/api/health", (req, res) => res.json({ status: "awake" }));

// Route POST pour la validation de la clé par l'interface
app.post("/api/health", async (req, res) => {
  try {
    const r = await apiFetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    }, 15000);
    if (r.ok) return res.json({ valid: true });
    return res.status(401).json({ valid: false, error: "Clé invalide" });
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, imageBase64 } = req.body;
    const systemPrompt = { role: "system", content: `Tu es une IA de haut niveau. Réponds toujours en français. Formate TOUJOURS en Markdown.` };
    let finalMessages = messages.map((m) => ({ ...m }));
    if (imageBase64) {
      const last = finalMessages[finalMessages.length - 1];
      last.content = [
        { type: "text", text: last.content },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      ];
    }
    const response = await apiFetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [systemPrompt, ...finalMessages], temperature: 0.6, max_tokens: 4096 }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API");
    res.json({ content: data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, format, imageBase64 } = req.body;
    const cinematicPrompt = `${prompt}, cinematic photography, shot on ARRI Alexa, 35mm lens, dramatic volumetric lighting, shallow depth of field, film grain, hyper-realistic, 8k resolution, color graded like a movie scene`;
    const body = { model: "agnes-image-2.5-flash", prompt: cinematicPrompt, size: "4K", ratio: format || "1:1", extra_body: { response_format: "url" } };
    if (imageBase64) {
      body.extra_body.image = [`data:image/jpeg;base64,${imageBase64}`];
      body.prompt = `Transform the reference image with this style: ${cinematicPrompt}`;
    }
    const response = await apiFetch(`${API_BASE}/v1/images/generations`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Image");
    let finalUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json || data.url;
    if (!finalUrl) throw new Error("Aucune image renvoyée.");
    if (!finalUrl.startsWith("http") && !finalUrl.startsWith("data:")) finalUrl = "data:image/jpeg;base64," + finalUrl;
    res.json({ id: "img_" + Date.now(), url: finalUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/generate-video", async (req, res) => {
  try {
    const { prompt, format, duration, imageBase64, images } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    let seconds = String(parseInt(duration) || 4);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";

    const body = {
      model: "agnes-video-2.5-flash",
      prompt: `${prompt}, cinematic camera movement, smooth tracking shot, natural motion, filmic color grading, atmospheric lighting, high detail`,
      seconds,
      size: "720P",
      aspect_ratio: format || "16:9",
      seed: Math.floor(Math.random() * 1000000),
    };

    let refs = [];
    if (Array.isArray(images) && images.length > 0) refs = images.filter(Boolean).slice(0, 5);
    else if (imageBase64) refs = [imageBase64];

    if (refs.length > 0) {
      body.mode = "reference";
      body.images = refs.map((b) => `data:image/jpeg;base64,${b}`);
    } else {
      body.mode = "text";
    }

    const result = await enqueueVideoJob(req.apiKey, body);
    res.json({ id: result.id });
  } catch (err) {
    console.error("Erreur Vidéo:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/status/:id", async (req, res) => {
  try {
    const r = await apiFetch(
      `${API_BASE}/agnesapi?video_id=${encodeURIComponent(req.params.id)}&model_name=agnes-video-2.5-flash`,
      { headers: { "Authorization": `Bearer ${req.apiKey}` } },
      20000
    );
    
    // Sécurité : vérifier que la réponse est du JSON
    const contentType = r.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        return res.status(502).json({ error: "Réponse invalide du serveur Agnes." });
    }

    const data = await r.json();
    res.json({ status: data.status || "processing", url: data.url || data.metadata?.url });
  } catch (err) {
    res.status(500).json({ error: "Erreur statut" });
  }
});

app.get("/api/download/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { url } = req.query;
    let fileUrl = url;

    if (!fileUrl && !id.startsWith("img_")) {
      const s = await apiFetch(
        `${API_BASE}/agnesapi?video_id=${encodeURIComponent(id)}&model_name=agnes-video-2.5-flash`,
        { headers: { "Authorization": `Bearer ${req.apiKey}` } }
      );
      const d = await s.json();
      fileUrl = d.url || d.metadata?.url;
    }

    if (!fileUrl) return res.status(404).send("Fichier introuvable");
    const ext = id.startsWith("img_") ? "jpg" : "mp4";

    if (fileUrl.startsWith("data:")) {
      const base64Data = fileUrl.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");
      res.setHeader("Content-Disposition", `attachment; filename="videoai-${id}.${ext}"`);
      return res.send(buffer);
    }

    const fileRes = await fetch(fileUrl);
    const buffer = await fileRes.arrayBuffer();
    res.setHeader("Content-Disposition", `attachment; filename="videoai-${id}.${ext}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send("Erreur download");
  }
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "Public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur prêt sur le port ${PORT}`));
