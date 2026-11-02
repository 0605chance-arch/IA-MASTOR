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

// File d'attente : 1 requête toutes les 13s pour respecter le RPM
const queueMap = new Map();
const MIN_INTERVAL = 13000; 

function getQueue(apiKey) {
  if (!queueMap.has(apiKey)) {
    queueMap.set(apiKey, { lastRequest: 0, queue: [] });
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
  if (q.queue.length === 0) return;
  
  const now = Date.now();
  const timeSinceLast = now - q.lastRequest;
  if (timeSinceLast < MIN_INTERVAL) {
    setTimeout(() => processNext(apiKey), MIN_INTERVAL - timeSinceLast);
    return;
  }
  
  const task = q.queue.shift();
  q.lastRequest = Date.now();
  
  try {
    const result = await task.taskFn();
    task.resolve(result);
  } catch (err) {
    task.reject(err);
  } finally {
    processNext(apiKey);
  }
}

// ... (garder getApiKey, /api/validate-key, /api/chat, /api/generate-image identiques) ...

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

    const result = await processQueue(apiKey, async () => {
      console.log(`🎬 Envoi création vidéo (respect RPM)...`);
      let response = await fetch(`${AGNES_BASE}/videos`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      let data = await response.json();

      if (response.status === 429) {
        console.log(`⏳ Trop de requêtes (429). Attente 30s...`);
        await new Promise(r => setTimeout(r, 30000));
        response = await fetch(`${AGNES_BASE}/videos`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        data = await response.json();
      }

      if (!response.ok) throw new Error(data.error?.message || 'Erreur Vidéo');
      const videoId = data.video_id || data.id;
      if (!videoId) throw new Error('Pas de video_id');
      console.log(`✅ Accepté: ${videoId}`);
      return videoId;
    });

    res.json({ id: result });
  } catch (err) { 
    console.error('❌ Erreur:', err.message);
    res.status(500).json({ error: err.message }); 
  }
});

// ... (garder /api/status-batch, /api/download, app.get('*'), app.listen) ...
