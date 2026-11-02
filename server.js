require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';
const AGNES_POLL_BASE = 'https://apihub.agnes-ai.com/agnesapi';

function getApiKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Clé API manquante.');
  return auth.replace('Bearer ', '').trim();
}

app.post('/api/validate-key', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'agnes-3.0-flash', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 })
    });
    if (!response.ok) throw new Error('Clé invalide');
    res.json({ valid: true });
  } catch (err) { res.status(401).json({ valid: false, error: 'Clé invalide' }); }
});

app.post('/api/generate-video', async (req, res) => {
  console.log("📥 [RENDER] Nouvelle requête de génération vidéo reçue !");
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

    console.log(`🎬 [AGNES] Envoi de la requête (${prompt.substring(0, 15)}...)`);
    const response = await fetch(`${AGNES_BASE}/videos`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();

    if (!response.ok) {
      console.log(`❌ [AGNES] Erreur ${response.status} :`, data.error?.message || data);
      return res.status(response.status).json({ 
        error: data.error?.message || 'Erreur Vidéo', 
        code: data.error?.code || (response.status === 429 ? 'rate_limit' : 'unknown')
      });
    }

    console.log(`✅ [AGNES] Accepté ! ID: ${data.video_id || data.id}`);
    res.json({ id: data.video_id || data.id });
  } catch (err) { 
    console.error(`💥 [RENDER] Crash :`, err.message);
    res.status(500).json({ error: err.message }); 
  }
});

// ... (Garde les autres routes /api/chat, /api/generate-image, /api/status et /api/download identiques au message précédent) ...
