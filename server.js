require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Trop de requêtes, veuillez patienter." }
});
app.use("/api/", apiLimiter);

const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';
const AGNES_POLL_BASE = 'https://apihub.agnes-ai.com/agnesapi';

const MODELS = {
  chat: 'agnes-3.0-flash',
  image: 'agnes-image-2.5-flash',
  videoFlash: 'agnes-video-2.5-flash'
};

function getApiKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('MISSING_API_KEY');
  return auth.replace('Bearer ', '').trim();
}

async function agnesFetch(endpoint, apiKey, options = {}) {
  const url = `${AGNES_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    let errJson; 
    try { errJson = JSON.parse(errText); } catch { errJson = { raw: errText }; }
    const exactMessage = errJson.error?.message || errJson.message || errJson.raw || `Agnes error ${res.status}`;
    const error = new Error(exactMessage);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/validate-key', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    await agnesFetch('/chat/completions', apiKey, {
      method: 'POST', body: JSON.stringify({ model: MODELS.chat, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 })
    });
    res.json({ valid: true });
  } catch (err) { res.status(401).json({ valid: false, error: 'Clé invalide' }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, stream = true } = req.body;
    const body = { model: MODELS.chat, messages: messages.slice(-20), stream, temperature: 0.8 };
    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!response.ok) return res.status(response.status).json({ error: await response.text() });
    if (!stream) return res.json(await response.json());
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    
    response.body.on('data', (chunk) => { res.write(chunk); if (typeof res.flush === 'function') res.flush(); });
    response.body.on('end', () => res.end());
  } catch (err) { if (res.headersSent) res.end(); else res.status(500).json({ error: err.message }); }
});

app.post('/api/image', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, size = '2K', ratio = '16:9', n = 1 } = req.body;
    const body = { model: MODELS.image, prompt: prompt.trim(), n: Math.min(n, 4), size: ['1K','2K','3K','4K'].includes(size) ? size : '2K', extra_body: { response_format: 'url', ratio: ratio || '16:9' } };
    const data = await agnesFetch('/images/generations', apiKey, { method: 'POST', body: JSON.stringify(body) });
    const images = (data.data || []).map(item => ({ url: item.url })).filter(i => i.url);
    res.json({ success: true, images });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ VIDÉO : 720P + base64 pur (sans préfixe)
app.post('/api/video', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, seconds = '5', aspect_ratio = '16:9', imageBase64 } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });
    
    const secondsNum = parseInt(seconds) || 5;
    const finalSeconds = String(Math.min(12, Math.max(4, secondsNum)));

    const body = {
      model: MODELS.videoFlash,
      prompt: prompt.trim(),
      seconds: finalSeconds,
      size: '720P',
      aspect_ratio: aspect_ratio || '16:9',
      seed: Math.floor(Math.random() * 1000000),
      mode: 'text'
    };

    if (imageBase64) {
      body.mode = 'reference';
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      body.images = [cleanBase64];
    }

    const createData = await agnesFetch('/videos', apiKey, { method: 'POST', body: JSON.stringify(body) });
    const videoId = createData.video_id || createData.id;
    if (!videoId) throw new Error('Pas de video_id');
    res.json({ success: true, video_id: videoId, model: MODELS.videoFlash });
  } catch (err) { 
    console.error('Erreur vidéo (création):', err.message); 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/video/status', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { video_id, model = MODELS.videoFlash } = req.query;
    if (!video_id) return res.status(400).json({ error: 'video_id requis' });
    
    const url = `${AGNES_POLL_BASE}?video_id=${encodeURIComponent(video_id)}&model_name=${encodeURIComponent(model)}`;
    const pollRes = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    
    if (!pollRes.ok) { 
      const errText = await pollRes.text().catch(() => ''); 
      return res.status(pollRes.status).json({ error: `Polling error: ${errText}` }); 
    }
    
    const data = await pollRes.json();
    res.json({ success: true, status: data.status || 'unknown', video_url: data.url || data.video_url || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/download', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL manquante');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Erreur téléchargement');
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const extension = contentType.includes('video') ? 'mp4' : 'jpg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="iamastor-${Date.now()}.${extension}"`);
    response.body.pipe(res);
  } catch (err) { res.status(500).send('Erreur : ' + err.message); }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint inconnu' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 IA MASTOR démarré sur le port ${PORT}`));
