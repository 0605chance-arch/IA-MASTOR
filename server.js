const express = require("express");
const path = require("path");
const app = express();

const API_BASE = "https://apihub.agnes-ai.com";
const DEFAULT_KEY = process.env.AGNES_API_KEY || null;

app.use(express.json({ limit: "80mb" }));
app.use(express.static(path.join(__dirname, "Public")));

// KEEP-ALIVE INTERNE
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(async () => { try { await fetch(`${RENDER_URL}/api/health`, { method: "GET" }); } catch (e) {} }, 5 * 60 * 1000);
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
  try { return await fetch(url, { ...options, signal: controller.signal, keepalive: true }); } finally { clearTimeout(timer); }
}

app.use("/api", (req, res, next) => {
  if (req.path === "/health" && req.method === "GET") return next();
  const key = getApiKey(req);
  if (!key) return res.status(401).json({ error: "Clé API manquante." });
  req.apiKey = key;
  next();
});

// FILE D'ATTENTE VIDÉO
const SUBMIT_INTERVAL_MS = 12500;
const queues = new Map();
const activeTasks = new Map();

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
        method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(job.body),
      }, 30000);
      if (r.status === 429 || r.status === 503) { await new Promise(r => setTimeout(r, 15000)); continue; }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || "Erreur");
      q.lastSubmit = Date.now();
      q.jobs.shift();
      const videoId = data.video_id || data.id;
      activeTasks.set(job.taskId, { status: "processing", videoId, url: null });
      pollVideoStatus(apiKey, job.taskId, videoId);
      job.resolve({ id: videoId });
    } catch (err) {
      q.jobs.shift(); job.reject(err); activeTasks.set(job.taskId, { status: "failed", videoId: null, url: null });
    }
  }
  q.processing = false;
}

function enqueueVideoJob(apiKey, body, taskId) {
  return new Promise((resolve, reject) => {
    const q = getOrCreateQueue(apiKey);
    q.jobs.push({ body, taskId, resolve, reject });
    processQueue(apiKey).catch(console.error);
  });
}

async function pollVideoStatus(apiKey, taskId, videoId) {
  const interval = setInterval(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/agnesapi?video_id=${videoId}&model_name=agnes-video-2.5-flash`, { headers: { "Authorization": `Bearer ${apiKey}` } }, 20000);
      const data = await r.json();
      if (data.status === "completed" && (data.url || data.metadata?.url)) {
        clearInterval(interval); activeTasks.set(taskId, { status: "completed", videoId, url: data.url || data.metadata?.url });
      } else if (data.status === "failed") {
        clearInterval(interval); activeTasks.set(taskId, { status: "failed", videoId, url: null });
      }
    } catch (e) {}
  }, 5000);
}

app.get("/api/health", (req, res) => res.json({ status: "awake" }));
app.post("/api/health", async (req, res) => {
  try {
    const r = await apiFetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST", headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    }, 15000);
    if (r.ok) return res.json({ valid: true });
    return res.status(401).json({ valid: false, error: "Clé invalide" });
  } catch (err) { res.status(500).json({ valid: false, error: err.message }); }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, imageBase64 } = req.body;
    const systemPrompt = { role: "system", content: `Tu es une IA. Réponds en français. Formate en Markdown.` };
    let finalMessages = messages.map((m) => ({ ...m }));
    if (imageBase64) {
      const last = finalMessages[finalMessages.length - 1];
      last.content = [{ type: "text", text: last.content }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }];
    }
    const response = await apiFetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST", headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [systemPrompt, ...finalMessages], temperature: 0.6, max_tokens: 4096 }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API");
    res.json({ content: data.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, format, imageBase64, images } = req.body;
    const cinematicPrompt = `${prompt}, cinematic photography, shot on ARRI Alexa, 35mm lens, dramatic volumetric lighting, shallow depth of field, film grain, hyper-realistic, 8k resolution, color graded like a movie scene`;
    
    const body = { model: "agnes-image-2.5-flash", prompt: cinematicPrompt, size: "1K", ratio: format || "1:1", extra_body: { response_format: "url" } };
    
    let refs = [];
    if (images && Array.isArray(images) && images.length > 0) refs = images.filter(Boolean).slice(0, 5);
    else if (imageBase64) refs = [imageBase64];

    if (refs.length > 0) {
      body.extra_body.image = refs.map(b => b.startsWith("data:image") ? b : `data:image/jpeg;base64,${b}`);
      const pictureRefs = refs.map((_, i) => `<Picture ${i + 1}>`).join(", ");
      
      // Le CRITICAL LOCK est placé AU TOUT DÉBUT pour avoir le maximum de poids face au texte
      body.prompt = `CRITICAL CHARACTER IDENTITY LOCK: The characters in this scene MUST be exact visual replicas of the provided reference images (${pictureRefs}). Do NOT invent new faces. Do NOT change their hair, skin tone, or clothes. Match the reference images perfectly. Scene description: ${cinematicPrompt}`;
      
      body.negative_prompt = "different face, new character design, inconsistent appearance, different hair, different eyes, different age, mismatched identity, morphing, changing character shape, different clothes, altered logo";
    }

    const response = await apiFetch(`${API_BASE}/v1/images/generations`, {
      method: "POST", headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Image");
    let finalUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json || data.url;
    if (!finalUrl) throw new Error("Aucune image renvoyée.");
    if (!finalUrl.startsWith("http") && !finalUrl.startsWith("data:")) finalUrl = "data:image/jpeg;base64," + finalUrl;
    res.json({ id: "img_" + Date.now(), url: finalUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/generate-video", async (req, res) => {
  try {
    const { prompt, format, duration, images, taskId } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });
    let seconds = String(parseInt(duration) || 4);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";
    const body = {
      model: "agnes-video-2.5-flash", prompt: `${prompt}, cinematic camera movement, smooth tracking shot, filmic color grading, atmospheric lighting, high detail`,
      seconds, size: "720P", aspect_ratio: format || "16:9", seed: Math.floor(Math.random() * 1000000),
    };
    if (images && Array.isArray(images) && images.length > 0) {
      body.mode = "reference"; body.images = images.slice(0, 5).map(b => `data:image/jpeg;base64,${b}`);
    } else { body.mode = "text"; }
    activeTasks.set(taskId, { status: "queued", videoId: null, url: null });
    enqueueVideoJob(req.apiKey, body, taskId);
    res.json({ success: true, taskId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/task-status/:taskId", (req, res) => {
  if (activeTasks.has(req.params.taskId)) res.json(activeTasks.get(req.params.taskId));
  else res.status(404).json({ error: "Tâche introuvable" });
});

app.get("/api/download/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { url } = req.query;
    let fileUrl = url;
    if (!fileUrl && !id.startsWith("img_")) {
      const s = await apiFetch(`${API_BASE}/agnesapi?video_id=${encodeURIComponent(id)}&model_name=agnes-video-2.5-flash`, { headers: { "Authorization": `Bearer ${req.apiKey}` } });
      const d = await s.json(); fileUrl = d.url || d.metadata?.url;
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
  } catch (err) { res.status(500).send("Erreur download"); }
});

// ==========================================
// MÉTA-PROMPT STUDIO (INTÉGRATION DU TEXTE)
// ==========================================
app.post("/api/studio/generate-storyboard", async (req, res) => {
  try {
    const { projectIdea, sceneCount, format, style, mood, refCharacters } = req.body;
    if (!projectIdea) return res.status(400).json({ error: "L'idée est manquante." });
    const count = parseInt(sceneCount) || 5;

    let charText = "";
    if (refCharacters && refCharacters.length > 0) {
      charText = "\nPERSONNAGES DE RÉFÉRENCE (Utilise-les absolument, respecte leur physique) :\n" + 
        refCharacters.map(c => `- ${c.name} : ${c.description}`).join("\n");
    }
    
    // MÉTA-PROMPT (CORRIGÉ POUR INTERDIRE LES INVENTIONS PHYSIQUES)
    const systemPrompt = {
      role: "system",
      content: `RÔLE DE L’IA : Tu es un réalisateur de cinéma, scénariste professionnel, directeur artistique, directeur de photographie et expert en génération de vidéos par intelligence artificielle.
Ta mission est de transformer une simple idée utilisateur en une véritable production audiovisuelle cohérente, cinématographique et prête à être générée par une IA vidéo.

1. RESPECT ABSOLU DES PERSONNAGES DE RÉFÉRENCE
- Analyse précisément chaque description fournie.
- Ne jamais modifier son espèce, son âge apparent, sa morphologie, ses couleurs, ses vêtements ou ses accessoires.
- Ne jamais inventer une nouvelle apparence.
- Chaque personnage doit conserver exactement la même identité visuelle du premier au dernier clip.
- Créer une fiche d’identité visuelle précise pour chaque personnage.

2. COHÉRENCE VISUELLE ENTRE TOUS LES CLIPS
- Maintenir la même direction artistique, le même style de rendu, les mêmes textures, la même palette de couleurs et la même qualité de lumière.
- Ne pas passer arbitrairement d’un rendu à un autre.
- Ne pas modifier la décoration sans justification narrative.

3. CONTINUITÉ NARRATIVE OBLIGATOIRE
- L'histoire doit avoir un début, un développement et une fin.
- La fin d’un clip doit correspondre au début du clip suivant.
- Les déplacements, objets et actions doivent respecter la logique.

4. PROMPTS VIDÉO ULTRA-DÉTAILLÉS ET AUTONOMES
- Chaque prompt doit être compréhensible sans connaître les scènes précédentes.
- Ne jamais écrire "comme dans la scène précédente".
- Chaque prompt doit décrire le décor, l'action exacte, le type de caméra, l'éclairage et l'ambiance.
- INTERDICTION ABSOLUE : Ne JAMAIS inventer une description physique (visage, cheveux, vêtements) si elle n'est pas dans les "PERSONNAGES DE RÉFÉRENCE". Tu DOIS utiliser EXACTEMENT les descriptions fournies par l'utilisateur pour chaque personnage.
- Ajouter les instructions de durée : chaque clip dure exactement 12 secondes.

5. FORMAT DE SORTIE OBLIGATOIRE
Tu dois OBLIGATOIREMENT répondre avec un JSON parfait, sans texte avant ou après, sans balise markdown, respectant cette structure exacte :
{
  "titre": "Titre de l'histoire",
  "synopsis": "Synopsis général court",
  "direction_artistique": {
    "palette": "Couleurs exactes",
    "lumiere": "Style de lumière",
    "ambiance": "Ambiance générale"
  },
  "personnages": [{"nom": "Nom", "description_physique": "Description ultra-détaillée", "role": "Rôle"}],
  "scenes": [
    {
      "numero": 1, 
      "titre": "Titre scene", 
      "duree": 12, 
      "description_action": "Description narrative de l'action", 
      "personnages_presents": ["Nom"],
      "prompt_video": "Prompt ultra-détaillé de 12 secondes (autonome, décrivant physique, vêtements, décor, action, caméra, lumière)."
    }
  ]
}`
    };

    const userContent = `IDÉE DE L'UTILISATEUR : ${projectIdea}\nNOMBRE DE SCÈNES EXACT : ${count} (12 secondes par scène)\nFORMAT : ${format || "16:9"}\nSTYLE VISUEL : ${style || "Cinématographique"}\nAMBIANCE : ${mood || "Dramatique"}${charText}`;

    const response = await apiFetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST", headers: { "Authorization": `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [systemPrompt, { role: "user", content: userContent }], temperature: 0.7, max_tokens: 4096 }),
    }, 120000);

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API");

    let rawContent = data.choices[0].message.content.replace(/```json/g, "").replace(/```/g, "").trim();
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("L'IA n'a pas renvoyé de format JSON valide.");
    
    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "Public", "index.html")));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur prêt sur ${PORT}`));
