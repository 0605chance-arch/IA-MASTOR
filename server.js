require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting basique pour éviter les abus sur le proxy BYOK
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Trop de requêtes. Patiente une minute.' }
});
app.use('/api/', limiter);

// ============================================================
// CONFIGURATION AGNES
// ============================================================
const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';
const AGNES_POLL_BASE = 'https://apihub.agnes-ai.com/agnesapi';

// Modèles autorisés (Starter Plan = Flash uniquement pour vidéo 720P)
const MODELS = {
  chat: 'agnes-2.5-flash',
  image: 'agnes-image-2.5-flash',
  videoFlash: 'agnes-video-2.5-flash',   // 720P only, gratuit (promo)
  videoPro: 'agnes-video-2.5'            // 720P/1080P/2K, payant
};

// Quotas indicatifs Starter (informatif, pas de blocage strict côté serveur car BYOK)
// Vidéo: 500s/jour, Image: 4000/jour, Chat: 1500 req / 5h

// ============================================================
// HELPERS
// ============================================================

/**
 * Extrait la clé API du header Authorization
 * BYOK : le client envoie sa propre clé à chaque requête
 */
function getApiKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new Error('MISSING_API_KEY');
  }
  return auth.replace('Bearer ', '').trim();
}

/**
 * Appel générique vers Agnes API
 */
async function agnesFetch(endpoint, apiKey, options = {}) {
  const url = `${AGNES_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    let errJson;
    try { errJson = JSON.parse(errText); } catch { errJson = { raw: errText }; }
    const error = new Error(errJson.error?.message || errJson.message || `Agnes API error ${res.status}`);
    error.status = res.status;
    error.details = errJson;
    throw error;
  }

  return res.json();
}

/**
 * Polling vidéo avec video_id (OBLIGATOIRE selon doc Agnes)
 * Ne jamais utiliser task_id pour le polling [citation:15]
 */
async function pollVideoStatus(videoId, apiKey, modelName, maxAttempts = 60, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));

    const url = `${AGNES_POLL_BASE}?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(modelName)}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!res.ok) {
      // Si le polling échoue temporairement, on continue
      if (res.status >= 500) continue;
      const err = await res.text().catch(() => '');
      throw new Error(`Polling error ${res.status}: ${err}`);
    }

    const data = await res.json();

    if (data.status === 'completed') {
      return data; // contient url ou video_url
    }
    if (data.status === 'failed') {
      throw new Error(data.error || 'Video generation failed');
    }
    // status: queued, processing, etc. → continuer
    // progress disponible dans data.progress si présent
  }

  throw new Error('VIDEO_TIMEOUT: La génération a dépassé le temps imparti. Réessaie avec une durée plus courte.');
}

// ============================================================
// ROUTES API
// ============================================================

// ---------- HEALTH ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'IA MASTOR', timestamp: Date.now() });
});

// ---------- VALIDATION CLÉ (BYOK) ----------
app.post('/api/validate-key', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    // Test léger : une requête chat minimale
    await agnesFetch('/chat/completions', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model: MODELS.chat,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        stream: false
      })
    });
    res.json({ valid: true, message: 'Clé Agnes valide. Bienvenue sur IA MASTOR 🚀' });
  } catch (err) {
    const status = err.status || 401;
    res.status(status).json({
      valid: false,
      error: err.message === 'MISSING_API_KEY' ? 'Clé API manquante.' : 'Clé invalide ou expirée.',
      details: err.details || null
    });
  }
});

// ============================================================
// CHAT
// ============================================================
app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, stream = true } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages requis (array)' });
    }

    const body = {
      model: MODELS.chat,
      messages: messages.slice(-20), // garde-fou contexte
      stream: stream,
      temperature: 0.8,
      max_tokens: 4096
    };

    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    if (!stream) {
      const data = await response.json();
      return res.json(data);
    }

    // Streaming SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    response.body.on('data', (chunk) => {
      res.write(chunk);
    });
    response.body.on('end', () => res.end());
    response.body.on('error', (e) => {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
});

// ============================================================
// IMAGE GENERATION
// ============================================================
app.post('/api/image', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const {
      prompt,
      size = '2K',
      ratio = '16:9',
      n = 1,
      referenceImages = [],   // array de URLs ou Data URIs
      mode = 'text2img'       // text2img | img2img | compose
    } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'prompt requis' });
    }

    // Validation taille (Agnes 2.5 Flash supporte 1K/2K/3K/4K)
    const validSizes = ['1K', '2K', '3K', '4K'];
    const finalSize = validSizes.includes(size) ? size : '2K';

    const body = {
      model: MODELS.image,
      prompt: prompt.trim(),
      n: Math.min(n, 4),
      size: finalSize,
      extra_body: {
        response_format: 'url'
      }
    };

    // Ratio
    if (ratio) body.extra_body.ratio = ratio;

    // Image editing / composition
    if (mode !== 'text2img' && referenceImages.length > 0) {
      body.extra_body.image = referenceImages.slice(0, 4);
    }

    const data = await agnesFetch('/images/generations', apiKey, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    // Normalisation réponse
    const images = (data.data || []).map(item => ({
      url: item.url || null,
      b64: item.b64_json || null,
      revised_prompt: item.revised_prompt || prompt
    })).filter(i => i.url || i.b64);

    res.json({
      success: true,
      images,
      size: finalSize,
      ratio,
      prompt
    });

  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      details: err.details || null
    });
  }
});

// ============================================================
// VIDEO GENERATION (Asynchrone + Polling)
// ============================================================
app.post('/api/video', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const {
      prompt,
      seconds = '5',
      size = '720P',           // 720P (Flash) ou 1080P (Pro)
      aspect_ratio = '16:9',
      mode = 'text',           // text | img2video | keyframe | reference
      first_frame = null,
      last_frame = null,
      images = [],
      audios = []
    } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'prompt requis' });
    }

    // Contrainte Starter Flash : 720P uniquement
    const isPro = size === '1080P' || size === '2K';
    const model = isPro ? MODELS.videoPro : MODELS.videoFlash;

    // Validation durée (4–12 secondes)
    const secNum = parseInt(seconds, 10);
    const finalSeconds = String(Math.min(12, Math.max(4, isNaN(secNum) ? 5 : secNum)));

    const body = {
      model,
      prompt: prompt.trim(),
      mode: mode === 'text' ? 'text' : mode,
      seconds: finalSeconds,
      size: isPro ? (size === '1080P' ? '1080P' : '2K') : '720P',
      aspect_ratio: aspect_ratio || '16:9'
    };

    // Modes avancés
    if (mode === 'keyframe') {
      if (!first_frame) return res.status(400).json({ error: 'first_frame requis pour keyframe' });
      body.first_frame = first_frame;
      if (last_frame) body.last_frame = last_frame;
    }

    if (mode === 'img2video') {
      if (!first_frame) return res.status(400).json({ error: 'first_frame requis pour img2video' });
      body.first_frame = first_frame;
    }

    if (mode === 'reference') {
      if (images.length > 0) body.images = images.slice(0, isPro ? 8 : 5);
      if (audios.length > 0) body.audios = audios.slice(0, 3);
    }

    // Création de la tâche vidéo
    const createData = await agnesFetch('/videos', apiKey, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    // Récupération du video_id (priorité à video_id, fallback id/task_id)
    const videoId = createData.video_id || createData.id || createData.task_id;

    if (!videoId) {
      return res.status(500).json({
        error: 'Agnes n\'a pas renvoyé de video_id',
        raw: createData
      });
    }

    // Réponse immédiate avec l'ID pour polling côté client (ou on peut poller ici)
    // Ici on renvoie l'ID et le client fera le polling via /api/video/status
    res.json({
      success: true,
      video_id: videoId,
      model,
      status: 'queued',
      message: 'Vidéo en cours de génération. Utilise /api/video/status pour suivre.',
      polling_endpoint: `/api/video/status?video_id=${videoId}&model=${model}`
    });

  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      details: err.details || null
    });
  }
});

// ---------- POLLING VIDÉO ----------
app.get('/api/video/status', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { video_id, model = MODELS.videoFlash } = req.query;

    if (!video_id) {
      return res.status(400).json({ error: 'video_id requis' });
    }

    const url = `${AGNES_POLL_BASE}?video_id=${encodeURIComponent(video_id)}&model_name=${encodeURIComponent(model)}`;
    const pollRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!pollRes.ok) {
      const err = await pollRes.text().catch(() => '');
      return res.status(pollRes.status).json({ error: `Polling error: ${err}` });
    }

    const data = await pollRes.json();

    // Normalisation
    const status = data.status || 'unknown';
    const videoUrl = data.url || data.video_url || data.output?.url || null;
    const progress = data.progress || null;
    const error = data.error || null;

    res.json({
      success: true,
      status,
      video_url: videoUrl,
      progress,
      error,
      raw: status === 'failed' ? data : undefined
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- GÉNÉRATION VIDÉO BLOQUANTE (optionnel, pour clients simples) ----------
app.post('/api/video/generate-sync', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const {
      prompt,
      seconds = '5',
      size = '720P',
      aspect_ratio = '16:9'
    } = req.body;

    if (!prompt) return res.status(400).json({ error: 'prompt requis' });

    const isPro = size === '1080P';
    const model = isPro ? MODELS.videoPro : MODELS.videoFlash;

    const body = {
      model,
      prompt: prompt.trim(),
      mode: 'text',
      seconds: String(Math.min(12, Math.max(4, parseInt(seconds) || 5))),
      size: isPro ? '1080P' : '720P',
      aspect_ratio: aspect_ratio || '16:9'
    };

    const createData = await agnesFetch('/videos', apiKey, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    const videoId = createData.video_id || createData.id || createData.task_id;
    if (!videoId) throw new Error('Pas de video_id');

    // Polling bloquant (max 60 tentatives ~ 3min)
    const result = await pollVideoStatus(videoId, apiKey, model, 60, 3000);

    res.json({
      success: true,
      video_url: result.url || result.video_url,
      video_id: videoId,
      status: 'completed',
      size: isPro ? '1080P' : '720P'
    });

  } catch (err) {
    res.status(500).json({
      error: err.message,
      code: err.message.includes('TIMEOUT') ? 'TIMEOUT' : 'GENERATION_FAILED'
    });
  }
});

// ============================================================
// STORY MODE (Chat contextuel avec mémoire)
// ============================================================
// L'onglet Histoire utilise simplement /api/chat avec un system prompt enrichi.
// Le client envoie l'historique complet pour que l'IA se souvienne de tout.
// Cette route est un wrapper sémantique pour la clarté.

app.post('/api/story', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const {
      messages,
      storyState = {},       // { synopsis, characters, prompts, theme }
      theme = null
    } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages requis' });
    }

    // Construction du system prompt avec mémoire de l'histoire
    let systemPrompt = `Tu es le moteur narratif d'IA MASTOR. Tu génères des histoires cohérentes, captivantes et virales.

RÈGLES ABSOLUES :
1. Tu te souviens de TOUT l'historique de la conversation. Ne perds jamais le fil.
2. Tu maintiens la cohérence des personnages, du ton et de l'univers.
3. Tu génères des prompts vidéo ultra-détaillés pour Agnes Video (720P/1080P).
4. Chaque prompt vidéo doit être autonome mais s'inscrire dans la continuité.

`;

    if (theme) {
      systemPrompt += `THÉMATIQUE ACTIVE : ${theme}\n`;
    }

    if (storyState.synopsis) {
      systemPrompt += `SYNOPSIS ACTUEL : ${storyState.synopsis}\n`;
    }

    if (storyState.characters && storyState.characters.length > 0) {
      systemPrompt += `PERSONNAGES PRINCIPAUX :\n`;
      storyState.characters.forEach((c, i) => {
        systemPrompt += `  ${i + 1}. ${c.name || 'Personnage ' + (i+1)} : ${c.description || ''}\n`;
      });
    }

    if (storyState.prompts && storyState.prompts.length > 0) {
      systemPrompt += `DERNIERS PROMPTS VIDÉO GÉNÉRÉS (pour continuité) :\n`;
      storyState.prompts.slice(-5).forEach((p, i) => {
        systemPrompt += `  [${i + 1}] ${typeof p === 'string' ? p : p.prompt || JSON.stringify(p)}\n`;
      });
    }

    systemPrompt += `\nRéponds toujours en français sauf si l'utilisateur demande explicitement l'anglais.`;

    // Injection du system prompt en tête
    const augmentedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-15) // garde les 15 derniers échanges pour la mémoire
    ];

    const body = {
      model: MODELS.chat,
      messages: augmentedMessages,
      stream: true,
      temperature: 0.9,
      max_tokens: 8192
    };

    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    response.body.on('data', (chunk) => res.write(chunk));
    response.body.on('end', () => res.end());
    response.body.on('error', (e) => {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
});

// ============================================================
// FALLBACK SPA (toutes les routes non-API renvoient index.html)
// ============================================================
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint API inconnu' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// DÉMARRAGE
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 IA MASTOR démarré sur le port ${PORT}`);
  console.log(`   Mode: BYOK (Bring Your Own Key)`);
  console.log(`   Agnes Starter Plan: Vidéo Flash 720P, Image 1K-4K, Chat 2.5-flash`);
});

// Gestion arrêt propre (Render)
process.on('SIGTERM', () => {
  console.log('SIGTERM reçu, fermeture...');
  process.exit(0);
});
