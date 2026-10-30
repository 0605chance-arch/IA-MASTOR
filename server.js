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

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Trop de requêtes. Patiente une minute.' }
});
app.use('/api/', limiter);

// ============================================================
// CONFIGURATION AGNES (CORRIGÉ : agnes-3.0-flash)
// ============================================================
const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';
const AGNES_POLL_BASE = 'https://apihub.agnes-ai.com/agnesapi';

const MODELS = {
  chat: 'agnes-3.0-flash',                // ✅ Modèle texte actuel
  image: 'agnes-image-2.5-flash',         // ✅ OK
  videoFlash: 'agnes-video-2.5-flash',    // ✅ 720P uniquement
  videoPro: 'agnes-video-2.5'             // ✅ 1080P/2K
};

// ============================================================
// HELPERS
// ============================================================
function getApiKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('MISSING_API_KEY');
  return auth.replace('Bearer ', '').trim();
}

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

// ============================================================
// ROUTES API
// ============================================================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'IA MASTOR', timestamp: Date.now() });
});

// Validation Clé
app.post('/api/validate-key', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
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
// CHAT (CORRIGÉ : gestion SSE sécurisée)
// ============================================================
app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, stream = true } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages requis' });

    const body = {
      model: MODELS.chat,
      messages: messages.slice(-20),
      stream: stream,
      temperature: 0.8,
      max_tokens: 4096
    };

    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) return res.status(response.status).json({ error: await response.text() });

    if (!stream) {
      const data = await response.json();
      return res.json(data);
    }

    // Headers SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Évite le buffering proxy
    res.flushHeaders(); // Envoie les headers immédiatement

    response.body.on('data', (chunk) => {
      res.write(chunk);
      if (typeof res.flush === 'function') res.flush(); // Force l'envoi immédiat
    });
    response.body.on('end', () => res.end());
    response.body.on('error', (e) => {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    // CORRECTION : gestion propre si les headers SSE sont déjà envoyés
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
});

// ============================================================
// IMAGE
// ============================================================
app.post('/api/image', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, size = '2K', ratio = '16:9', n = 1, referenceImages = [], mode = 'text2img' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });

    const validSizes = ['1K', '2K', '3K', '4K'];
    const finalSize = validSizes.includes(size) ? size : '2K';

    const body = {
      model: MODELS.image,
      prompt: prompt.trim(),
      n: Math.min(n, 4),
      size: finalSize,
      extra_body: { response_format: 'url', ratio: ratio || '16:9' }
    };

    if (mode !== 'text2img' && referenceImages.length > 0) {
      body.extra_body.image = referenceImages.slice(0, 4);
    }

    const data = await agnesFetch('/images/generations', apiKey, { method: 'POST', body: JSON.stringify(body) });
    const images = (data.data || []).map(item => ({ url: item.url || null, b64: item.b64_json || null, revised_prompt: item.revised_prompt || prompt })).filter(i => i.url || i.b64);

    res.json({ success: true, images, size: finalSize, ratio, prompt });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details || null });
  }
});

// ============================================================
// VIDÉO (avec bascule 1080P)
// ============================================================
app.post('/api/video', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, seconds = '5', size = '720P', aspect_ratio = '16:9', mode = 'text', first_frame = null } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });

    const isPro = size === '1080P' || size === '2K';
    const model = isPro ? MODELS.videoPro : MODELS.videoFlash;
    const finalSize = isPro ? '1080P' : '720P';

    const body = {
      model,
      prompt: prompt.trim(),
      mode: mode === 'text' ? 'text' : mode,
      seconds: String(Math.min(12, Math.max(4, parseInt(seconds) || 5))),
      size: finalSize,
      aspect_ratio: aspect_ratio || '16:9'
    };

    if (first_frame) body.first_frame = first_frame;

    const createData = await agnesFetch('/videos', apiKey, { method: 'POST', body: JSON.stringify(body) });
    const videoId = createData.video_id || createData.id || createData.task_id;
    if (!videoId) return res.status(500).json({ error: 'Pas de video_id', raw: createData });

    res.json({ success: true, video_id: videoId, model, status: 'queued' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details || null });
  }
});

// Polling Vidéo
app.get('/api/video/status', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { video_id, model = MODELS.videoFlash } = req.query;
    if (!video_id) return res.status(400).json({ error: 'video_id requis' });

    const url = `${AGNES_POLL_BASE}?video_id=${encodeURIComponent(video_id)}&model_name=${encodeURIComponent(model)}`;
    const pollRes = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });

    if (!pollRes.ok) {
      const err = await pollRes.text().catch(() => '');
      return res.status(pollRes.status).json({ error: `Polling error: ${err}` });
    }

    const data = await pollRes.json();
    res.json({
      success: true,
      status: data.status || 'unknown',
      video_url: data.url || data.video_url || data.output?.url || null,
      progress: data.progress || null,
      error: data.error || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// STORY (Chat contextuel)
// ============================================================
app.post('/api/story', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, storyState = {}, theme = null } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages requis' });

    let systemPrompt = `Tu es le moteur narratif d'IA MASTOR. Tu génères des histoires cohérentes, captivantes et virales.
RÈGLES ABSOLUES :
1. Tu te souviens de TOUT l'historique.
2. Tu maintiens la cohérence des personnages et du ton.
3. Tu génères des prompts vidéo ultra-détaillés pour Agnes Video (720P/1080P).
`;

    if (theme) systemPrompt += `THÉMATIQUE ACTIVE : ${theme}\n`;
    if (storyState.synopsis) systemPrompt += `SYNOPSIS ACTUEL : ${storyState.synopsis}\n`;
    if (storyState.characters && storyState.characters.length > 0) {
      systemPrompt += `PERSONNAGES PRINCIPAUX :\n`;
      storyState.characters.forEach((c, i) => { systemPrompt += `  ${i + 1}. ${c.name || 'Personnage ' + (i+1)}\n`; });
    }

    const augmentedMessages = [{ role: 'system', content: systemPrompt }, ...messages.slice(-15)];

    const body = { model: MODELS.chat, messages: augmentedMessages, stream: true, temperature: 0.9, max_tokens: 8192 };

    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) return res.status(response.status).json({ error: await response.text() });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    response.body.on('data', (chunk) => {
      res.write(chunk);
      if (typeof res.flush === 'function') res.flush();
    });
    response.body.on('end', () => res.end());
    response.body.on('error', (e) => {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });
  } catch (err) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
});

// ============================================================
// FALLBACK SPA
// ============================================================
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint inconnu' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// DÉMARRAGE
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 IA MASTOR démarré sur le port ${PORT}`);
  console.log(`   Mode: BYOK (Bring Your Own Key)`);
  console.log(`   Chat: ${MODELS.chat}`);
  console.log(`   Image: ${MODELS.image}`);
  console.log(`   Video Flash: ${MODELS.videoFlash} (720P)`);
  console.log(`   Video Pro: ${MODELS.videoPro} (1080P)`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM reçu, fermeture...');
  process.exit(0);
});
