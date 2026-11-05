const express = require("express");
const path = require("path");
const app = express();

const API_BASE = "https://apihub.agnes-ai.com";
const DEFAULT_KEY = process.env.AGNES_API_KEY || null;

app.use(express.json({ limit: "80mb" }));
app.use(express.static(path.join(__dirname, "Public")));

const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(async () => {
    try { await fetch(`${RENDER_URL}/api/health`, { method: "GET" }); } catch (e) {}
  }, 5 * 60 * 1000);
}

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

// SSE + Mémoire
const activeTasks = new Map();
const sseClients = new Set();

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

setInterval(() => {
  if (sseClients.size === 0) return;
  const tasks = {};
  for (const [id, data] of activeTasks.entries()) tasks[id] = data;
  const payload = `data: ${JSON.stringify(tasks)}\n\n: keep-alive\n\n`;
  sseClients.forEach(client => client.write(payload));
}, 2000);

// ROUTES
app.get("/api/health", (req, res) => res.json({ status: "awake" }));

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
    const systemPrompt = { role: "system", content: `Tu es une IA. Réponds en français. Formate en Markdown.` };
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
    const body = { model: "agnes-image-2.5-flash", prompt: cinematicPrompt, size: "1K", ratio: format || "1:1", extra_body: { response_format: "url" } };
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

    const r = await apiFetch(`${API_BASE}/v1/videos`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, 30000);

    if (r.status === 429) {
      const retryAfter = r.headers.get("retry-after") || "60";
      const waitMs = parseInt(retryAfter, 10) * 1000;
      return res.status(429).json({ error: "Limite atteinte", retryAfter: waitMs });
    }

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Erreur soumission");

    const videoId = data.video_id || data.id;
    activeTasks.set(taskId, { status: "processing", videoId, url: null });
    
    pollVideoStatus(req.apiKey, taskId, videoId);
    res.json({ id: videoId, taskId });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    } catch (e) {}
  }, 5000);
}

app.post("/api/studio/generate-storyboard", async (req, res) => {
  try {
    const { projectIdea, sceneCount, format, style, mood } = req.body;
    if (!projectIdea) return res.status(400).json({ error: "L'idée du projet est manquante." });

    const count = parseInt(sceneCount) || 5;
    const systemPrompt = {
      role: "system",
      content: `Tu es un superviseur de production audiovisuelle IA. Génère un storyboard complet en JSON.
RÈGLES :
1. Histoire fluide (début, milieu, fin).
2. Bible des personnages IMMUABLE (vêtements, visage).
3. ${count} scènes de 12s. Chaque scène a un prompt_video AUTONOME.
4. Réponds UNIQUEMENT avec le JSON valide.

Structure JSON :
{
  "titre": "...",
  "synopsis": "...",
  "personnages": [{"nom": "...", "description_physique": "...", "role": "..."}],
  "scenes": [{"numero": 1, "titre": "...", "description_action": "...", "personnages_presents": ["..."], "prompt_video": "..."}]
}`
    };

    const userContent = `IDÉE : ${projectIdea}\nSCÈNES : ${count} (Clips de 12s)\nFORMAT : ${format || "16:9"}\nSTYLE : ${style || "Cinématographique"}\nAMBIANCE : ${mood || "Dramatique"}`;

    const response = await apiFetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [systemPrompt, { role: "user", content: userContent }], temperature: 0.7, max_tokens: 4096 }),
    }, 120000);

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur de génération du storyboard.");

    const rawContent = data.choices[0].message.content;
    let parsedPlan;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      parsedPlan = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawContent);
    } catch (e) {
      throw new Error("L'IA n'a pas renvoyé un format JSON valide.");
    }
    res.json(parsedPlan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/download/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { url } = req.query;
    let fileUrl = url;

    if (!fileUrl && !id.startsWith("img_")) {
      const s = await apiFetch(`${API_BASE}/agnesapi?video_id=${encodeURIComponent(id)}&model_name=agnes-video-2.5-flash`, { headers: { "Authorization": `Bearer ${req.apiKey}` } });
      const d = await s.json();
      fileUrl = d.url || d.metadata?.url;
    }

    if (!fileUrl) return res.status(404).send("Fichier introuvable");
    const ext = id.startsWith("img_") ? "jpg" : "mp4";

    if (fileUrl.startsWith("data:")) {
      const buffer = Buffer.from(fileUrl.split(",")[1], "base64");
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
app.listen(PORT, () => console.log(`✅ Serveur prêt sur ${PORT}`));
