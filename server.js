require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';
const AGNES_POLL_BASE = 'https://apihub.agnes-ai.com/agnesapi';

// ✅ La clé est envoyée par le client (BYOK)
function getApiKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('MISSING_API_KEY');
  return auth.replace('Bearer ', '').trim();
}

// ✅ Fonction de retry de ton ancienne app
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && response.status >= 500) throw new Error("Erreur serveur");
      return response;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

async function agnesFetch(endpoint, apiKey, options = {}) {
  const url = `${AGNES_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    let errJson; try { errJson = JSON.parse(errText); } catch { errJson = { raw: errText }; }
    throw new Error(errJson.error?.message || errJson.message || `Agnes error ${res.status}`);
  }
  return res.json();
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/validate-key', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    await agnesFetch('/chat/completions', apiKey, {
      method: 'POST', body: JSON.stringify({ model: 'agnes-3.0-flash', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 })
    });
    res.json({ valid: true });
  } catch (err) { res.status(401).json({ valid: false, error: 'Clé invalide' }); }
});

// ✅ CHAT (Ton ancien code)
app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, imageBase64 } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Format des messages invalide" });

    const systemPrompt = { role: "system", content: `Tu es une IA de très haut niveau. Réponds TOUJOURS en français. Formate TOUJOURS ta réponse en Markdown valide.` };

    let finalMessages = [...messages];
    if (imageBase64) {
      const lastMsg = finalMessages[finalMessages.length - 1];
      lastMsg.content = [
        { type: "text", text: lastMsg.content },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      ];
    }
    
    const response = await fetchWithRetry(`${AGNES_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [systemPrompt, ...finalMessages], temperature: 0.65, max_tokens: 4096 }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API Chat");
    res.json({ content: data.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: "Chat indisponible." }); }
});

// ✅ IMAGE (Ton ancien code : 4K)
app.post('/api/generate-image', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, imageBase64 } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    const cinematicPrompt = `${prompt}, cinematic photography, shot on ARRI Alexa, 35mm lens, dramatic volumetric lighting, hyper-realistic, 8k resolution`;
    const body = { model: "agnes-image-2.5-flash", prompt: cinematicPrompt, size: "4K", ratio: format, extra_body: { response_format: "url" } };

    if (imageBase64) {
      body.extra_body.image = [`data:image/jpeg;base64,${imageBase64}`];
      body.prompt = `Transform the reference image with this style: ${cinematicPrompt}`;
    }

    const response = await fetchWithRetry(`${AGNES_BASE}/images/generations`, {
      method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Image");

    let finalUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json || data.url;
    if (!finalUrl) throw new Error("Aucune image.");
    if (!finalUrl.startsWith("http") && !finalUrl.startsWith("data:")) finalUrl = "data:image/jpeg;base64," + finalUrl;

    res.json({ id: "img_" + Date.now(), url: finalUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ VIDÉO (LA LOGIQUE EXACTE DE TON ANCIENNE APP)
app.post('/api/generate-video', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, duration, imageBase64, storyCharacters } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    let seconds = String(duration);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";

    const videoPrompt = `${prompt}, cinematic camera movement, smooth tracking shot, natural motion, high detail, masterpiece`;
    
    const body = {
      model: "agnes-video-2.5-flash",
      prompt: videoPrompt,
      seconds: seconds,
      size: "1080P", // ✅ Ton ancien code utilisait 1080P
      aspect_ratio: format, 
      seed: Math.floor(Math.random() * 1000000),
      mode: "text"
    };

    if (storyCharacters && storyCharacters.length > 0) {
      body.mode = "reference";
      let validImages = [];
      storyCharacters.forEach(char => {
        if (char.name && prompt.toLowerCase().includes(char.name.toLowerCase())) {
          validImages.push(`data:image/jpeg;base64,${char.base64}`);
        }
      });
      if (imageBase64) validImages.push(`data:image/jpeg;base64,${imageBase64}`);
      body.images = validImages.slice(0, 5);
      if (body.images.length === 0 && imageBase64) body.images = [`data:image/jpeg;base64,${imageBase64}`];
    } else if (imageBase64) {
      body.mode = "reference"; 
      body.images = [`data:image/jpeg;base64,${imageBase64}`]; // ✅ Base64 complet
    }

    const response = await fetchWithRetry(`${AGNES_BASE}/videos`, {
      method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Création Vidéo");

    const videoId = data.video_id || data.id;
    if (!videoId) throw new Error("L'API n'a pas renvoyé de video_id.");

    res.json({ id: videoId }); 
  } catch (err) { console.error("Erreur Vidéo:", err.message); res.status(500).json({ error: err.message }); }
});

// ✅ STATUT (Ton ancien code)
app.get('/api/status/:id', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const response = await fetchWithRetry(
      `${AGNES_POLL_BASE}?video_id=${req.params.id}&model_name=agnes-video-2.5-flash`,
      { headers: { "Authorization": `Bearer ${apiKey}` } }
    );
    const data = await response.json();
    res.json({ status: data.status || "processing", url: data.url || data.metadata?.url });
  } catch (err) { res.status(500).json({ error: "Erreur statut" }); }
});

// ✅ TÉLÉCHARGEMENT (Ton ancien code)
app.get('/api/download/:id', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { id } = req.params;
    const { url } = req.query;
    let fileUrl = url;

    if (!fileUrl && !id.startsWith("img_")) {
      const s = await fetch(`${AGNES_POLL_BASE}?video_id=${id}&model_name=agnes-video-2.5-flash`, { headers: { "Authorization": `Bearer ${apiKey}` } });
      const d = await s.json();
      fileUrl = d.url || d.metadata?.url;
    }

    if (!fileUrl) return res.status(404).send("Introuvable");

    if (fileUrl.startsWith("data:")) {
        const base64Data = fileUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        res.setHeader("Content-Disposition", `attachment; filename="ia-mastor-${id}.jpg"`);
        return res.send(buffer);
    }

    const fileRes = await fetch(fileUrl);
    const buffer = await fileRes.arrayBuffer();
    res.setHeader("Content-Disposition", `attachment; filename="ia-mastor-${id}.mp4"`);
    res.send(Buffer.from(buffer));
  } catch (err) { res.status(500).send("Erreur download"); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 IA MASTOR (Backend réinjecté) sur le port ${PORT}`));
