// ============================================
  // FACTORY SLOT VIDÉO (Contrôle Client + Gestion 429)
  // ============================================
  const slotTemplate = document.getElementById("slot-template");
  const videoSlotsArray = [];
  const videoSlotsContainer = document.getElementById("video-slots");

  function createSlot(node) {
    // ... (Récupération des éléments DOM identique) ...

    // Fonction pour afficher les messages d'erreur de limite de débit
    function showRateLimitMessage(statusEl, waitMs) {
      const waitSec = Math.ceil(waitMs / 1000);
      statusEl.dataset.state = "error";
      statusEl.innerHTML = `<span class="dot"></span> Limite atteinte. Attente de ${waitSec}s…`;
    }

    genBtn.addEventListener("click", async () => {
      if (!promptEl.value.trim()) return;
      
      const taskId = "task_" + Date.now() + "_" + Math.floor(Math.random()*1000);
      
      genBtn.disabled = true; dlBtn.disabled = true; player.hidden = true;
      setStatus("queued", "Envoi en cours…");

      const body = {
        prompt: promptEl.value.trim(),
        format: formatEl.value,
        duration: parseInt(durationEl.value, 10),
        taskId: taskId
      };
      if (state.base64) body.images = [state.base64];

      try {
        const res = await apiFetch("/api/generate-video", { method: "POST", body: JSON.stringify(body) });
        
        // GESTION DU 429 CÔTÉ CLIENT
        if (res.status === 429) {
          const data = await res.json();
          showRateLimitMessage(statusEl, data.retryAfter);
          
          // On attend le temps indiqué puis on réessaie automatiquement
          await new Promise(r => setTimeout(r, data.retryAfter));
          genBtn.click(); // Relance
          return;
        }

        const data = await res.json();
        if (!data.id) throw new Error(data.error || "Pas d'ID");
        
        node.dataset.taskId = taskId;
        localStorage.setItem(`video_task_${taskId}`, JSON.stringify({ 
          prompt: promptEl.value.trim(), 
          slotIndex: Array.from(videoSlotsContainer.children).indexOf(node) 
        }));
        
        setStatus("loading", "Génération…");

      } catch (e) { setStatus("error", "Erreur : " + e.message); genBtn.disabled = false; }
    });

    // ... (Gestion du bouton télécharger identique) ...
  }

  for (let i = 0; i < 10; i++) {
    const node = slotTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `#${i + 1}`;
    videoSlotsContainer.appendChild(node);
    createSlot(node);
    videoSlotsArray.push(node);
  }

  // ============================================
  // CONNEXION SSE + SIGNAL DE VIE
  // ============================================
  let sseConnection = null;
  let sseRetryCount = 0;

  function connectSSE() {
    if (sseConnection) sseConnection.close();
    sseConnection = new EventSource("/api/events");

    sseConnection.onopen = () => {
      sseRetryCount = 0;
      console.log("SSE connecté");
    };

    sseConnection.onmessage = (event) => {
      const tasks = JSON.parse(event.data);
      // ... (Mise à jour des slots identique) ...
    };

    sseConnection.onerror = () => {
      sseConnection.close();
      const delay = Math.min(1000 * Math.pow(2, sseRetryCount), 30000);
      sseRetryCount++;
      setTimeout(connectSSE, delay);
    };
  }

  connectSSE();

  // Reconnexion forcée au retour sur l'application
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      connectSSE();
    }
  });
