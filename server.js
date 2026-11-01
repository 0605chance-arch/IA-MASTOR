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

// ==========================================
// FILE D'ATTENTE ASYNCHRONE (Pour ne jamais bloquer)
// ==========================================
const activeQueues = new Map();

function getQueue(apiKey) {
  if (!activeQueues.has(apiKey)) {
    activeQueues.set(apiKey, { queue: [], running: false });
  }
  return activeQueues.get(apiKey);
}

async function addToQueue(apiKey, body) {
  const q = getQueue(apiKey);
  return new Promise((resolve, reject) => {
    q.queue.push({ body, resolve, reject });
    processQueue(apiKey);
  });
}

async function processQueue(apiKey) {
  const q = getQueue(apiKey);
  if (q.running || q.queue.length === 0) return;
  
  q.running = true;
  const task = q.queue.shift();

  try {
    console.log(`🎬 Traitement file d'attente (${q.queue.length} restants)...`);
    
    // Retry acharné sur 429
    let videoId = null;
    let attempts = 0;
    while (attempts < 10 && !videoId) {
      attempts++;
      const response = await fetch(`${AGNES_BASE}/videos`, {
        method: 'POST', 
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, 
        body: JSON.stringify(task.body)
      });
      const data = await response.json();

      if (response.ok && (data.video_id || data.id)) {
        videoId = data.video_id || data.id;
        break;
      }
      
      if (response.status === 429 || response.status === 503) {
        console.log(`⏳ Agnes occupé. Attente 15s (essai ${attempts})...`);
        await new Promise(r => setTimeout(r, 15000));
      } else {
        throw new Error(data.error?.message || 'Erreur API');
      }
    }

    if (!videoId) throw new Error('Agnes saturé après 10 essais.');
    task.resolve(videoId);

  } catch (err) {
    task.reject(err);
  } finally {
    q.running = false;
    // Attendre 12 secondes avant de traiter la requête suivante (RPM de 5)
    setTimeout(() => processQueue(apiKey), 12000); 
  }
}

// ==========================================
// ROUTES API
// ==========================================
function getApiKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Clé API manquante.');
  return auth.replace('Bearer ', '').trim();
}

app.post('/api/validate-key', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'agnes-3.0-flash', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 })
    });
    if (!response.ok) throw new Error('Clé invalide');
    res.json({ valid: true });
  } catch (err) { res.status(401).json({ valid: false, error: 'Clé invalide' }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, stream = true, imageBase64 } = req.body;
    let finalMessages = [...messages];
    if (imageBase64) {
      const lastMsg = finalMessages[finalMessages.length - 1];
      lastMsg.content = [{ type: "text", text: lastMsg.content }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }];
    }
    const body = { model: 'agnes-3.0-flash', messages: finalMessages.slice(-20), stream, temperature: 0.8 };
    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!response.ok) return res.status(response.status).json({ error: await response.text() });
    if (!stream) return res.json(await response.json());
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.flushHeaders();
    response.body.on('data', (chunk) => { res.write(chunk); if (typeof res.flush === 'function') res.flush(); });
    response.body.on('end', () => res.end());
  } catch (err) { if (res.headersSent) res.end(); else res.status(500).json({ error: err.message }); }
});

app.post('/api/generate-image', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, imageBase64 } = req.body;
    const body = { model: 'agnes-image-2.5-flash', prompt: prompt, size: '4K', ratio: format, extra_body: { response_format: 'url' } };
    if (imageBase64) body.extra_body.image = [`data:image/jpeg;base64,${imageBase64}`];
    const response = await fetch(`${AGNES_BASE}/images/generations`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Erreur Image');
    let finalUrl = data.data?.[0]?.url || data.url;
    res.json({ id: 'img_' + Date.now(), url: finalUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ⚠️ ROUTE VIDÉO AVEC FILE D'ATTENTE
app.post('/api/generate-video', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, duration, imageBase64, storyCharacters } = req.body;
    
    let seconds = String(duration);
    if (parseInt(seconds) < 4) seconds = '4';
    if (parseInt(seconds) > 12) seconds = '12';

    const body = {
      model: 'agnes-video-2.5-flash', prompt: prompt, seconds: seconds, size: '720P', aspect_ratio: format, mode: 'text'
    };

    if (storyCharacters && storyCharacters.length > 0) {
      body.mode = 'reference';
      let validImages = [];
      storyCharacters.forEach(char => {
        if (char.name && prompt.toLowerCase().includes(char.name.toLowerCase()) && char.img) {
          validImages.push(char.img.replace(/^data:image\/\w+;base64,/, ''));
        }
      });
      if (imageBase64) validImages.push(imageBase64.replace(/^data:image\/\w+;base64,/, ''));
      body.images = validImages.slice(0, 5);
      if (body.images.length === 0) body.mode = 'text';
    } else if (imageBase64) {
      body.mode = 'reference'; 
      body.images = [imageBase64.replace(/^data:image\/\w+;base64,/, '')]; 
    }

    // Le serveur gère la file d'attente et renvoie l'ID
    const videoId = await addToQueue(apiKey, body);
    res.json({ id: videoId });

  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// VÉRIFICATION GROUPÉE (Pour ne pas spammer Agnes)
app.get('/api/status-batch', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const ids = (req.query.ids || '').split(',').filter(id => id.trim() !== '');
    
    const results = [];
    for (const id of ids) {
      try {
        const response = await fetch(`${AGNES_POLL_BASE}?video_id=${id}&model_name=agnes-video-2.5-flash`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (response.status === 429) { results.push({ id, status: 'processing', url: null }); continue; }
        const data = await response.json();
        const videoUrl = data.url || data.video_url || data.metadata?.url;
        results.push({ id, status: videoUrl ? 'completed' : (data.status || 'processing'), url: videoUrl });
        await new Promise(r => setTimeout(r, 200)); // Petite pause entre les vérifs
      } catch (err) {
        results.push({ id, status: 'processing', url: null });
      }
    }
    res.json({ statuses: results });
  } catch (err) { res.status(500).json({ error: 'Erreur statut groupé' }); }
});

app.get('/api/download/:id', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { id } = req.params;
    const { url } = req.query;
    let fileUrl = url;
    if (!fileUrl && !id.startsWith('img_')) {
      const s = await fetch(`${AGNES_POLL_BASE}?video_id=${id}&model_name=agnes-video-2.5-flash`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      const d = await s.json();
      fileUrl = d.url || d.metadata?.url;
    }
    if (!fileUrl) return res.status(404).send('Introuvable');
    const fileRes = await fetch(fileUrl);
    const buffer = await fileRes.arrayBuffer();
    const ext = id.startsWith('img_') ? 'jpg' : 'mp4';
    res.setHeader('Content-Disposition', `attachment; filename="ia-mastor-${id}.${ext}"`);
    res.send(Buffer.from(buffer));
  } catch (err) { res.status(500).send('Erreur download'); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 IA MASTOR prêt sur le port ${PORT}`));
