const express = require("express");
const path = require("path");
const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

function getApiKey(req) {
    const key = req.headers['x-api-key'] || req.body.apiKey || req.query.apiKey;
    if (!key) throw new Error("Clé API manquante.");
    return key;
}

// 1. CHAT
app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, imageBase64 } = req.body;
    const systemPrompt = { role: "system", content: `Tu es une IA de haut niveau. Réponds en français. Formate en Markdown.` };
    let finalMessages = [...messages];
    if (imageBase64) {
      finalMessages[finalMessages.length - 1].content = [
        { type: "text", text: finalMessages[finalMessages.length - 1].content },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      ];
    }
    const response = await fetch("https://apihub.agnes-ai.com/v1/chat/completions", {
      method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [systemPrompt, ...finalMessages], temperature: 0.6 }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API");
    res.json({ content: data.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. IMAGE
app.post("/api/generate-image", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, imageBase64 } = req.body;
    const body = { model: "agnes-image-2.5-flash", prompt: `${prompt}, cinematic photography, 8k resolution`, size: "4K", ratio: format, extra_body: { response_format: "url" } };
    if (imageBase64) body.extra_body.image = [`data:image/jpeg;base64,${imageBase64}`];
    const response = await fetch("https://apihub.agnes-ai.com/v1/images/generations", {
      method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Image");
    let finalUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json || data.url;
    if (!finalUrl.startsWith("http") && !finalUrl.startsWith("data:")) finalUrl = "data:image/jpeg;base64," + finalUrl;
    res.json({ id: "img_" + Date.now(), url: finalUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. VIDÉO
app.post("/api/generate-video", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, duration, imageBase64, storyCharacters } = req.body;
    let seconds = String(Math.min(Math.max(parseInt(duration) || 4, 4), 12));
    const body = { model: "agnes-video-2.5-flash", prompt: `${prompt}, cinematic movement`, seconds, size: "720P", aspect_ratio: format, mode: "text" };
    
    if (storyCharacters?.length > 0) {
      body.mode = "reference"; 
      body.images = storyCharacters.filter(c => c.img).map(c => `data:image/jpeg;base64,${c.img}`).slice(0, 5);
    } else if (imageBase64) {
      body.mode = "reference"; 
      body.images = [`data:image/jpeg;base64,${imageBase64}`]; 
    }

    const response = await fetch("https://apihub.agnes-ai.com/v1/videos", {
      method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || "Erreur Vidéo", 
        code: data.code || (response.status === 429 ? "rate_limit" : (response.status === 503 ? "queue_full" : "error"))
      });
    }
    res.json({ id: data.video_id || data.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. STATUT GROUPÉ (Avec tolérance aux 404 et récupération d'URL)
app.post("/api/status-batch", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { ids } = req.body; 
    
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const response = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${id}&model_name=agnes-video-2.5-flash`, { 
          headers: { "Authorization": `Bearer ${apiKey}` } 
        });
        
        // Si l'API est en rate-limit (429), on dit que c'est encore en cours
        if (response.status === 429) return { id, status: "processing", url: null };
        
        // ⚠️ GESTION DU BUG 404 : Si l'API ne trouve pas la vidéo (car elle est trop récente), on continue d'attendre
        if (response.status === 404) return { id, status: "processing", url: null };

        const data = await response.json();
        
        // HACK : On récupère l'URL dès qu'elle existe
        const forcedUrl = data.url || data.video_url || data.metadata?.url;
        if (forcedUrl) {
            return { id, status: "completed", url: forcedUrl };
        }

        return { id, status: data.status || "processing", url: null };
      } catch (e) { 
        return { id, status: "processing", url: null }; 
      }
    }));

    res.json({ results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. TÉLÉCHARGEMENT
app.get("/api/download/:id", async (req, res) => {
  try {
    const apiKey = getApiKey(req); const { id } = req.params; let fileUrl = req.query.url;
    if (!fileUrl && !id.startsWith("img_")) {
      const s = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${id}&model_name=agnes-video-2.5-flash`, { headers: { "Authorization": `Bearer ${apiKey}` } });
      const d = await s.json(); fileUrl = d.url || d.metadata?.url;
    }
    const fileRes = await fetch(fileUrl); const buffer = await fileRes.arrayBuffer();
    const ext = id.startsWith("img_") ? "jpg" : "mp4";
    res.setHeader("Content-Disposition", `attachment; filename="iamastor-${id}.${ext}"`);
    res.send(Buffer.from(buffer));
  } catch (err) { res.status(500).send("Erreur"); }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(process.env.PORT || 3000, () => console.log(`🚀 Serveur prêt`));
