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

// File d'attente pour respecter les 5 RPM
const queueMap = new Map();
const MAX_CONCURRENT = 5;
const MIN_INTERVAL = 12000; // 12 secondes

function getQueue(apiKey) {
  if (!queueMap.has(apiKey)) {
    queueMap.set(apiKey, { running: 0, lastRequest: 0, queue: [] });
  }
  return queueMap.get(apiKey);
}

async function processQueue(apiKey, taskFn) {
  const q = getQueue(apiKey);
  return new Promise((resolve, reject) => {
    q.queue.push({ taskFn, resolve, reject });
    processNext(apiKey);
  });
}

async function processNext(apiKey) {
  const q = getQueue(apiKey);
  if (q.running >= MAX_CONCURRENT || q.queue.length === 0) return;
  
  const now = Date.now();
  const timeSinceLast = now - q.lastRequest;
  if (timeSinceLast < MIN_INTERVAL) {
    setTimeout(() => processNext(apiKey), MIN_INTERVAL - timeSinceLast);
    return;
  }
  
  const task = q.queue.shift();
  q.running++;
  q.lastRequest = Date.now();
  
  try {
    const result = await task.taskFn();
    task.resolve(result);
  } catch (err) {
    task.reject(err);
  } finally {
    q.running--;
    processNext(apiKey);
  }
}

function getApiKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Clé API manquante.');
  return auth.replace('Bearer ', '').trim();
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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
      lastMsg.content = [
        { type: "text", text: lastMsg.content },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      ];
    }

    const body = { model: 'agnes-3.0-flash', messages: finalMessages.slice(-20), stream, temperature: 0.8 };
    
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
    if (!finalUrl) throw new Error('Pas d\'URL image');
    res.json({ id: 'img_' + Date.now(), url: finalUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/generate-video', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, duration, imageBase64, storyCharacters } = req.body;
    
    let seconds = String(duration);
    if (parseInt(seconds) < 4) seconds = '4';
    if (parseInt(seconds) > 12) seconds = '12';

    const body = {
      model: 'agnes-video-2.5-flash',
      prompt: prompt,
      seconds: seconds,
      size: '720P',
      aspect_ratio: format,
      mode: 'text'
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

    const result = await processQueue(apiKey, async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        console.log(`🎬 Tentative ${attempt}/5...`);
        const response = await fetch(`${AGNES_BASE}/videos`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await response.json();

        if (response.status === 503 || (data.error && data.error.code === 'video_queue_full')) {
          console.log(`⏳ File pleine. Attente 30s...`);
          if (attempt < 5) { await new Promise(r => setTimeout(r, 30000)); continue; }
        }

        if (!response.ok) throw new Error(data.error?.message || 'Erreur Vidéo');
        const videoId = data.video_id || data.id;
        if (!videoId) throw new Error('Pas de video_id');
        console.log(`✅ Accepté: ${videoId}`);
        return videoId;
      }
      throw new Error('Agnes saturé après 5 tentatives.');
    });

    res.json({ id: result });
  } catch (err) { 
    console.error('❌ Erreur:', err.message);
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/status/:id', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const videoId = req.params.id;
    const submittedAt = parseInt(req.query.t || '0');
    
    const elapsed = Date.now() - submittedAt;
    if (elapsed < 25000) {
      return res.json({ status: 'processing', url: null });
    }
    
    const response = await fetch(`${AGNES_POLL_BASE}?video_id=${videoId}&model_name=agnes-video-2.5-flash`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (response.status === 429 || response.status === 404) {
      return res.json({ status: 'processing', url: null });
    }
    
    const data = await response.json();
    const videoUrl = data.url || data.video_url || data.metadata?.url;
    const isDone = videoUrl || data.status === 'completed';

    res.json({ status: isDone ? 'completed' : (data.status || 'processing'), url: videoUrl });
  } catch (err) { res.status(500).json({ error: 'Erreur statut' }); }
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
