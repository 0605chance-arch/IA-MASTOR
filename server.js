const express = require("express");
const path = require("path");
const app = express();

// Augmenté à 50mb pour accepter les images en base64
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Récupération sécurisée de la clé API envoyée par le client
function getApiKey(req) {
    const key = req.headers['x-api-key'] || req.body.apiKey || req.query.apiKey;
    if (!key) throw new Error("Clé API manquante.");
    return key;
}

// ==========================================
// 1. CHAT
// ==========================================
app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, imageBase64 } = req.body;
    if (!messages) return res.status(400).json({ error: "Messages manquants" });

    const systemPrompt = { 
      role: "system", 
      content: `Tu es une IA de haut niveau. Réponds toujours en français. Formate TOUJOURS en Markdown (gras, titres, listes).` 
    };

    let finalMessages = [...messages];
    if (imageBase64) {
      const lastMsg = finalMessages[finalMessages.length - 1];
      lastMsg.content = [
        { type: "text", text: lastMsg.content },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      ];
    }
    
    const response = await fetch("https://apihub.agnes-ai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "agnes-3.0-flash",
        messages: [systemPrompt, ...finalMessages],
        temperature: 0.6,
        max_tokens: 4096
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
    const apiKey = getApiKey(req);
    const { prompt, format, imageBase64 } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    const cinematicPrompt = `${prompt}, cinematic photography, shot on ARRI Alexa, 35mm lens, dramatic volumetric lighting, shallow depth of field, film grain, hyper-realistic, 8k resolution, highly detailed, color graded like a movie scene`;

    const body = {
      model: "agnes-image-2.5-flash",
      prompt: cinematicPrompt,
      size: "4K",          
      ratio: format,       
      extra_body: { response_format: "url" }
    };

    if (imageBase64) {
      body.extra_body.image = [`data:image/jpeg;base64,${imageBase64}`];
      body.prompt = `Transform the reference image with this style: ${cinematicPrompt}`;
    }

    const response = await fetch("https://apihub.agnes-ai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Image");

    let finalUrl = null;
    if (data.data && data.data[0]) finalUrl = data.data[0].url || data.data[0].b64_json;
    else if (data.url) finalUrl = data.url;

    if (!finalUrl) throw new Error("Aucune image renvoyée.");
    if (!finalUrl.startsWith("http") && !finalUrl.startsWith("data:")) finalUrl = "data:image/jpeg;base64," + finalUrl;

    res.json({ id: "img_" + Date.now(), url: finalUrl });
  } catch (err) {
    console.error("Erreur Image:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. VIDÉO & HISTOIRE
// ==========================================
app.post("/api/generate-video", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, duration, imageBase64, storyCharacters } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    let seconds = String(duration);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";

    const body = {
      model: "agnes-video-2.5-flash",
      prompt: prompt + ", cinematic camera movement, smooth tracking shot",
      seconds: seconds,
      size: "720P",        
      aspect_ratio: format, 
      seed: Math.floor(Math.random() * 1000000),
      mode: "text"
    };

    if (storyCharacters && storyCharacters.length > 0) {
      body.mode = "reference";
      let allImages = storyCharacters.filter(c => c.img).map(c => `data:image/jpeg;base64,${c.img}`);
      if (imageBase64) allImages.push(`data:image/jpeg;base64,${imageBase64}`);
      body.images = allImages.slice(0, 5); 
    } else if (imageBase64) {
      body.mode = "reference"; 
      body.images = [`data:image/jpeg;base64,${imageBase64}`]; 
    }

    const response = await fetch("https://apihub.agnes-ai.com/v1/videos", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || "Erreur Vidéo", 
        code: data.error?.code 
      });
    }

    res.json({ id: data.video_id || data.id });
  } catch (err) {
    console.error("Erreur Vidéo:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. STATUT GROUPÉ (Le secret pour ne pas planter)
// ==========================================
app.post("/api/status-batch", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { ids } = req.body; 
    
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const response = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${id}&model_name=agnes-video-2.5-flash`, {
          headers: { "Authorization": `Bearer ${apiKey}` }
        });
        if (response.status === 429) return { id, status: "processing", url: null };
        const data = await response.json();
        return { id, status: data.status, url: data.url || data.metadata?.url };
      } catch (e) { return { id, status: "processing", url: null }; }
    }));

    res.json({ results });
  } catch (err) {
    console.error("Erreur statut groupé:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. TÉLÉCHARGEMENT
// ==========================================
app.get("/api/download/:id", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { id } = req.params;
    let fileUrl = req.query.url;

    if (!fileUrl && !id.startsWith("img_")) {
      const s = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${id}&model_name=agnes-video-2.5-flash`, { headers: { "Authorization": `Bearer ${apiKey}` } });
      const d = await s.json();
      fileUrl = d.url || d.metadata?.url;
    }
    
    if (!fileUrl) return res.status(404).send("Fichier introuvable");
    
    const fileRes = await fetch(fileUrl);
    const buffer = await fileRes.arrayBuffer();
    const ext = id.startsWith("img_") ? "jpg" : "mp4";
    
    res.setHeader("Content-Disposition", `attachment; filename="iamastor-${id}.${ext}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Erreur download:", err);
    res.status(500).send("Erreur téléchargement");
  }
});

// Route par défaut
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 IA MASTOR prêt sur le port ${PORT}`));
