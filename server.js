const express = require("express");
const path = require("path");
const app = express();

const API_BASE = "https://apihub.agnes-ai.com";
const DEFAULT_KEY = process.env.AGNES_API_KEY || null;

// Limite haute : les personnages de référence en base64 pèsent lourd
app.use(express.json({ limit: "60mb" }));
app.use(express.static(path.join(__dirname, "Public")));

// ==========================================
// HELPERS
// ==========================================

/** Récupère la clé API depuis le header X-API-Key, Authorization: Bearer, ou env */
function getApiKey(req) {
  const h = req.headers["x-api-key"];
  if (typeof h === "string" && h.trim()) return h.trim();

  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();

  return DEFAULT_KEY;
}

/** Fetch avec timeout + keep-alive (undici gère le pool natif) */
async function apiFetch(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, keepalive: true });
  } finally {
    clearTimeout(timer);
  }
}

/** Middleware d'authentification uniforme sur /api/* */
app.use("/api", (req, res, next) => {
  const key = getApiKey(req);
  if (!key) {
    return res.status(401).json({
      error: "Clé API manquante. Renseignez votre token Agnes dans l'interface.",
    });
  }
  req.apiKey = key;
  next();
});

// ==========================================
// 0. HEALTH — Validation de la clé Agnes
// ==========================================
app.post("/api/health", async (req, res) => {
  try {
    const r = await apiFetch(
      `${API_BASE}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${req.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "agnes-3.0-flash",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      },
      15000
    );
    if (r.ok) return res.json({ valid: true });
    const data = await r.json().catch(() => ({}));
    return res
      .status(401)
      .json({ valid: false, error: data.error?.message || "Clé invalide" });
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// ==========================================
// 1. CHAT (avec support image)
// ==========================================
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, imageBase64 } = req.body;
    if (!messages) return res.status(400).json({ error: "Messages manquants" });

    const systemPrompt = {
      role: "system",
      content: `Tu es une IA de haut niveau. Réponds toujours en français. Formate TOUJOURS en Markdown (gras, titres, listes). Si on te demande un tableau, crée un tableau Markdown. Sois clair, précis et structuré.`,
    };

    let finalMessages = messages.map((m) => ({ ...m }));
    if (imageBase64) {
      const last = finalMessages[finalMessages.length - 1];
      last.content = [
        { type: "text", text: last.content },
        {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
        },
      ];
    }

    const response = await apiFetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${req.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "agnes-3.0-flash",
        messages: [systemPrompt, ...finalMessages],
        temperature: 0.6,
        max_tokens: 4096,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API");

    res.json({ content: data.choices[0].message.content });
  } catch (err) {
    console.error("Erreur Chat:", err);
    res.status(500).json({ error: err.message || "Erreur serveur chat" });
  }
});

// ==========================================
// 2. IMAGE
// ==========================================
app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, format, imageBase64 } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    const cinematicPrompt = `${prompt}, cinematic photography, shot on ARRI Alexa, 35mm lens, dramatic volumetric lighting, shallow depth of field, film grain, hyper-realistic, 8k resolution, highly detailed, color graded like a movie scene`;

    const body = {
      model: "agnes-image-2.5-flash",
      prompt: cinematicPrompt,
      size: "4K",
      ratio: format || "1:1",
      extra_body: { response_format: "url" },
    };

    if (imageBase64) {
      body.extra_body.image = [`data:image/jpeg;base64,${imageBase64}`];
      body.prompt = `Transform the reference image with this style: ${cinematicPrompt}`;
    }

    const response = await apiFetch(`${API_BASE}/v1/images/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${req.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Image");

    let finalUrl = null;
    if (data.data && data.data[0]) finalUrl = data.data[0].url || data.data[0].b64_json;
    else if (data.url) finalUrl = data.url;

    if (!finalUrl) throw new Error("Aucune image renvoyée par l'API.");
    if (!finalUrl.startsWith("http") && !finalUrl.startsWith("data:"))
      finalUrl = "data:image/jpeg;base64," + finalUrl;

    res.json({ id: "img_" + Date.now(), url: finalUrl });
  } catch (err) {
    console.error("Erreur Image:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. VIDÉO (accepte 1 OU N images de référence)
// ==========================================
app.post("/api/generate-video", async (req, res) => {
  try {
    const { prompt, format, duration, imageBase64, images, seed } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    let seconds = String(parseInt(duration) || 8);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";

    const videoPrompt = `${prompt}, cinematic camera movement, smooth tracking shot, natural motion, filmic color grading, atmospheric lighting, high detail`;

    const body = {
      model: "agnes-video-2.5-flash",
      prompt: videoPrompt,
      seconds,
      size: "720P",
      aspect_ratio: format || "16:9",
      seed: typeof seed === "number" ? seed : Math.floor(Math.random() * 1000000),
    };

    // Refs : tableau prioritaire (mode histoire), sinon image unique (mode vidéo simple)
    let refs = [];
    if (Array.isArray(images) && images.length > 0) refs = images.filter(Boolean);
    else if (imageBase64) refs = [imageBase64];

    if (refs.length > 0) {
      body.mode = "reference";
      body.images = refs.map((b) => `data:image/jpeg;base64,${b}`);
    } else {
      body.mode = "text";
    }

    const response = await apiFetch(`${API_BASE}/v1/videos`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${req.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Vidéo");

    res.json({ id: data.video_id || data.id, seed: body.seed });
  } catch (err) {
    console.error("Erreur Vidéo:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. HISTOIRE — Synopsis + persos → 10 prompts JSON
// ==========================================
app.post("/api/story/generate-prompts", async (req, res) => {
  try {
    const { synopsis, characters = [] } = req.body;
    if (!synopsis || !synopsis.trim())
      return res.status(400).json({ error: "Synopsis manquant" });

    const charList = characters
      .filter((c) => c && (c.name || c.description || c.imageBase64))
      .slice(0, 5);

    const charText = charList
      .map((c, i) => {
        const parts = [`Personnage ${i + 1}`];
        if (c.name) parts.push(`Nom: "${c.name}"`);
        if (c.description) parts.push(`Description: ${c.description}`);
        if (c.imageBase64) parts.push(`(image de référence fournie)`);
        return "- " + parts.join(" — ");
      })
      .join("\n");

    const systemPrompt = {
      role: "system",
      content: `Tu es un storyboarder professionnel et réalisateur de cinéma de niveau hollywoodien. À partir du synopsis et des personnages fournis, tu crées EXACTEMENT 10 prompts vidéo cohérents qui racontent l'histoire scène par scène.

RÈGLES STRICTES:
- Chaque prompt = UNE scène distincte, cohérente, de 4 à 12 secondes de vidéo
- Décris OBLIGATOIREMENT : les personnages présents (nommés par leur nom), l'action précise, le décor, l'éclairage, l'ambiance, l'angle/mouvement de caméra
- Garde une cohérence visuelle ABSOLUE entre les scènes (même style, même époque, même palette)
- Le style doit être cinématique (film-like, cinematic, atmospheric)
- Les personnages doivent être nommés EXPLICITEMENT dans chaque prompt où ils apparaissent (pour déclencher les références visuelles)
- Chaque prompt fait 80 à 150 mots
- Les 10 scènes doivent couvrir le début, le développement et la fin de l'histoire

Réponds UNIQUEMENT avec ce JSON valide, rien d'autre:
{"prompts": ["prompt scène 1...", "prompt scène 2...", "... (exactement 10)"]}`,
    };

    const userContent = [
      {
        type: "text",
        text:
          `SYNOPSIS:\n${synopsis}\n\n` +
          `PERSONNAGES (${charList.length}/5):\n${charText || "(aucun personnage spécifié)"}\n\n` +
          `Génère exactement 10 prompts vidéo racontant cette histoire scène par scène.`,
      },
    ];

    // Envoie les images au modèle vision pour qu'il les "voie"
    charList.forEach((c) => {
      if (c.imageBase64) {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${c.imageBase64}` },
        });
      }
    });

    const response = await apiFetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${req.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "agnes-3.0-flash",
        messages: [systemPrompt, { role: "user", content: userContent }],
        temperature: 0.75,
        max_tokens: 4096,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API Story");

    const raw = data.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { prompts: [] };
    }

    const prompts = (parsed.prompts || []).filter(Boolean).slice(0, 10);
    if (prompts.length === 0) throw new Error("L'IA n'a renvoyé aucun prompt.");

    res.json({ prompts });
  } catch (err) {
    console.error("Erreur Story:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. STATUT & TÉLÉCHARGEMENT
// ==========================================
app.get("/api/status/:id", async (req, res) => {
  try {
    const r = await apiFetch(
      `${API_BASE}/agnesapi?video_id=${encodeURIComponent(req.params.id)}&model_name=agnes-video-2.5-flash`,
      { headers: { "Authorization": `Bearer ${req.apiKey}` } },
      20000
    );
    const data = await r.json();
    res.json({
      status: data.status || "processing",
      url: data.url || data.metadata?.url,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur statut" });
  }
});

app.get("/api/download/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { url } = req.query;
    let fileUrl = url;

    // Si pas d'URL fournie et ce n'est pas une image → on interroge l'API vidéo
    if (!fileUrl && !id.startsWith("img_")) {
      const key = getApiKey(req);
      if (!key) return res.status(401).send("Clé API manquante");
      const s = await apiFetch(
        `${API_BASE}/agnesapi?video_id=${encodeURIComponent(id)}&model_name=agnes-video-2.5-flash`,
        { headers: { "Authorization": `Bearer ${key}` } }
      );
      const d = await s.json();
      fileUrl = d.url || d.metadata?.url;
    }

    if (!fileUrl) return res.status(404).send("Fichier introuvable");

    const ext = id.startsWith("img_") ? "jpg" : "mp4";

    // Cas base64
    if (fileUrl.startsWith("data:")) {
      const base64Data = fileUrl.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");
      res.setHeader("Content-Disposition", `attachment; filename="videoai-${id}.${ext}"`);
      return res.send(buffer);
    }

    // Cas URL http(s)
    const fileRes = await fetch(fileUrl);
    const buffer = await fileRes.arrayBuffer();
    res.setHeader("Content-Disposition", `attachment; filename="videoai-${id}.${ext}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Erreur download:", err);
    res.status(500).send("Erreur download");
  }
});

// ==========================================
// FALLBACK SPA
// ==========================================
app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "Public", "index.html"))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ VideoAI Pro démarré sur http://localhost:${PORT}`)
);
