const express = require("express");
const path = require("path");
const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "Public")));

function getApiKey(req) {
    const key = req.headers['x-api-key'] || req.body.apiKey || req.query.apiKey;
    if (!key) throw new Error("Clé API manquante. Veuillez déverrouiller l'application.");
    return key;
}

// 1. CHAT
app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { messages, imageBase64 } = req.body;
    if (!messages) return res.status(400).json({ error: "Messages manquants" });

    const systemPrompt = { 
      role: "system", 
      content: `Tu es un assistant IA de très haut niveau. Réponds TOUJOURS en français. 
      Formate TOUJOURS ta réponse en Markdown valide (gras, titres, listes, tableaux). 
      Pour les tableaux, utilise la syntaxe standard : | Titre 1 | Titre 2 | avec une ligne de séparation |---|---|.` 
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
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "agnes-3.0-flash",
        messages: [systemPrompt, ...finalMessages],
        temperature: 0.65,
        max_tokens: 4096
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur API Agnes");

    res.json({ content: data.choices[0].message.content });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// 2. IMAGE
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

    let finalUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json || data.url;
    if (!finalUrl) throw new Error("Aucune image renvoyée.");
    if (!finalUrl.startsWith("http") && !finalUrl.startsWith("data:")) finalUrl = "data:image/jpeg;base64," + finalUrl;

    res.json({ id: "img_" + Date.now(), url: finalUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. VIDÉO & HISTOIRE
app.post("/api/generate-video", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, duration, imageBase64, storyContext, storyCharacters } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    let seconds = String(duration);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";

    let finalPrompt = prompt;
    if (storyContext) {
      finalPrompt = `Contexte de l'histoire : ${storyContext}. Scène à générer : ${prompt}. cinematic camera movement, high detail.`;
    } else {
      finalPrompt = `${prompt}, cinematic camera movement, smooth tracking shot, high detail`;
    }
    
    const body = {
      model: "agnes-video-2.5-flash",
      prompt: finalPrompt,
      seconds: seconds,
      size: "720P",        
      aspect_ratio: format, 
      seed: Math.floor(Math.random() * 1000000),
      mode: "text"
    };

    let imagesToSend = [];
    if (imageBase64) imagesToSend.push(`data:image/jpeg;base64,${imageBase64}`);
    
    if (storyCharacters && storyCharacters.length > 0) {
      storyCharacters.forEach(char => {
        if (char.name && prompt.toLowerCase().includes(char.name.toLowerCase())) {
          imagesToSend.push(`data:image/jpeg;base64,${char.base64}`);
        }
      });
    }

    if (imagesToSend.length > 0) {
      body.mode = "reference";
      body.images = imagesToSend.slice(0, 5);
    }

    const response = await fetch("https://apihub.agnes-ai.com/v1/videos", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Erreur Vidéo");

    res.json({ id: data.video_id || data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ⚠️ CORRECTION ICI : On essaie tous les noms de modèles possibles pour le statut
app.get("/api/status/:id", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const videoId = req.params.id;
    const models = ["agnes-video-2.5-flash", "agnes-video-v2.0", "agnes-video-2.5"];
    
    for (let model of models) {
        const response = await fetch(
          `https://apihub.agnes-ai.com/agnesapi?video_id=${videoId}&model_name=${model}`,
          { headers: { "Authorization": `Bearer ${apiKey}` } }
        );
        const data = await response.json();
        
        // Si le statut est trouvé (complété ou échoué), on le renvoie
        if (data.status && data.status !== "processing") {
            return res.json({ status: data.status, url: data.url || data.metadata?.url });
        }
        // Si on a une URL mais pas de statut clair, on considère que c'est prêt
        if (data.url || data.metadata?.url) {
             return res.json({ status: "completed", url: data.url || data.metadata?.url });
        }
    }
    
    // Si après avoir testé tous les modèles on est toujours "processing"
    res.json({ status: "processing", url: null });
  } catch (err) {
    res.status(500).json({ error: "Erreur statut" });
  }
});

app.get("/api/download/:id", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { id } = req.params;
    const { url } = req.query;
    let fileUrl = url;

    if (!fileUrl && !id.startsWith("img_")) {
      const s = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${id}&model_name=agnes-video-2.5-flash`, { headers: { "Authorization": `Bearer ${apiKey}` } });
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
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
