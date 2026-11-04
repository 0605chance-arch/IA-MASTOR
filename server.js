app.post("/api/generate-video", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { prompt, format, duration, imageBase64, storyContext, storyCharacters } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt manquant" });

    let seconds = String(duration);
    if (parseInt(seconds) < 4) seconds = "4";
    if (parseInt(seconds) > 12) seconds = "12";

    // On force le modèle Flash et la 720P (seule option gratuite et fonctionnelle)
    const modelName = "agnes-video-2.5-flash";
    const resolution = "720P";

    let finalPrompt = prompt;
    if (storyContext) {
      finalPrompt = `Contexte de l'histoire : ${storyContext}. Scène à générer : ${prompt}. cinematic camera movement, high detail.`;
    } else {
      finalPrompt = `${prompt}, cinematic camera movement, smooth tracking shot, high detail`;
    }
    
    const body = {
      model: modelName,
      prompt: finalPrompt,
      seconds: seconds,
      size: resolution,        
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
