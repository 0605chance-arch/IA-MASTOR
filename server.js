const express = require("express");
const path = require("path");
const app = express();

const AGNES_API_KEY = process.env.AGNES_API_KEY;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "Public")));

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, imageBase64 } = req.body;
    if (!messages) return res.status(400).json({ error: "Messages manquants" });

    const systemPrompt = { 
      role: "system", 
      content: `Tu es une IA de très haut niveau (style GPT-4). Réponds TOUJOURS en français. 
      Formate TOUJOURS ta réponse en Markdown valide. 
      Sois clair, précis et très bien structuré.` 
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
      headers: { "Authorization": `Bearer ${AGNES_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "agnes-3.0-flash",
        messages: [systemPrompt, ...finalMessages],
        temperature: 0.65,
        max_tokens: 4096
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API");

    res.json({ content: data.choices[0].message.content });
  } catch (err) {
    console.error("Erreur Chat:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/generate-image", async (req, res) => {
  try {
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
      headers: { "Authorization": `Bearer ${AGNES_API_KEY}`, "Content-Type": "application/json" },
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
    res.status(500).json({ error: err.message });
  }
});

// ✅ VIDÉO : Upload d'image vers 0x0.st puis envoi de l'URL à Agnes
app.post("/api/generate-video", async (req, res) => {
  try {
    const { prompt, format, duration, imageBase64, storyCharacters } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    let seconds = String(duration);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";

    // ✅ On upload l'image vers 0x0.st pour avoir une URL publique
    let publicImageUrl = null;
    if (imageBase64) {
      try {
        const FormData = require('form-data');
        const buffer = Buffer.from(imageBase64, 'base64');
        const form = new FormData();
        form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
        const uploadRes = await fetch('https://0x0.st', {
          method: 'POST',
          body: form,
          headers: { 'User-Agent': 'IA-MASTOR/1.0' }
        });
        if (uploadRes.ok) {
          const url = (await uploadRes.text()).trim();
          if (url.startsWith('http')) publicImageUrl = url;
        }
      } catch (e) { console.error('Upload image échoué:', e.message); }
    }

    const videoPrompt = `${prompt}, cinematic camera movement, smooth tracking shot, natural motion, filmic color grading, atmospheric lighting, high detail`;
    
    const body = {
      model: "agnes-video-2.5-flash",
      prompt: videoPrompt,
      seconds: seconds,
      size: "720P",        
      aspect_ratio: format, 
      seed: Math.floor(Math.random() * 1000000)
    };

    // ✅ Mode keyframe si on a une URL publique d'image
    if (publicImageUrl) {
      body.mode = "keyframe";
      body.first_frame = publicImageUrl;
    } else {
      body.mode = "text";
    }

    const response = await fetch("https://apihub.agnes-ai.com/v1/videos", {
      method: "POST",
      headers: { "Authorization": `Bearer ${AGNES_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Vidéo");

    res.json({ id: data.video_id || data.id });
  } catch (err) {
    console.error("Erreur Vidéo:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/status/:id", async (req, res) => {
  try {
    const response = await fetch(
      `https://apihub.agnes-ai.com/agnesapi?video_id=${req.params.id}&model_name=agnes-video-2.5-flash`,
      { headers: { "Authorization": `Bearer ${AGNES_API_KEY}` } }
    );
    const data = await response.json();
    res.json({ status: data.status || "processing", url: data.url || data.metadata?.url });
  } catch (err) {
    res.status(500).json({ error: "Erreur statut" });
  }
});

app.get("/api/download/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { url } = req.query;
    let fileUrl = url;

    if (!fileUrl && !id.startsWith("img_")) {
      const s = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${id}&model_name=agnes-video-2.5-flash`, { headers: { "Authorization": `Bearer ${AGNES_API_KEY}` } });
      const d = await s.json();
      fileUrl = d.url || d.metadata?.url;
    }

    if (!fileUrl) return res.status(404).send("Fichier introuvable");

    if (fileUrl.startsWith("data:")) {
        const base64Data = fileUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = id.startsWith("img_") ? "jpg" : "mp4";
        res.setHeader("Content-Disposition", `attachment; filename="videoai-${id}.${ext}"`);
        return res.send(buffer);
    }

    const fileRes = await fetch(fileUrl);
    const buffer = await fileRes.arrayBuffer();
    const ext = id.startsWith("img_") ? "jpg" : "mp4";
    res.setHeader("Content-Disposition", `attachment; filename="videoai-${id}.${ext}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send("Erreur download");
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "Public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur ${PORT}`));
