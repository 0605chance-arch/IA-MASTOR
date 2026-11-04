(function () {
  "use strict";

  // ============================================
  // UTILS & SÉCURITÉ
  // ============================================
  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function parseMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);
    html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>").replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^### (.*$)/gim, "<h3>$1</h3>").replace(/^## (.*$)/gim, "<h2>$1</h2>").replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>").replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>");
    
    const lines = html.split("\n");
    let inTable = false, tableHtml = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("|") && line.endsWith("|")) {
        if (!inTable) { inTable = true; tableHtml += "<table>"; }
        if (line.includes("---")) continue;
        const cells = line.split("|").filter((c) => c.trim() !== "");
        const tag = (i === 0 || lines[i - 1].includes("---")) ? "th" : "td";
        tableHtml += "<tr>" + cells.map((c) => `<${tag}>${c.trim()}</${tag}>`).join("") + "</tr>";
      } else if (inTable) { tableHtml += "</table>"; inTable = false; }
    }
    if (inTable) tableHtml += "</table>";
    if (tableHtml) html = html.replace(/(\|.*\|)+/g, tableHtml);
    return html.replace(/\n/g, "<br>");
  }

  async function downloadFile(url, filename, id) {
    try {
      let blob;
      if (url.startsWith("data:")) {
        blob = await (await fetch(url)).blob();
      } else {
        const proxyUrl = `/api/download/${id}?url=${encodeURIComponent(url)}`;
        const res = await apiFetch(proxyUrl);
        if (!res.ok) throw new Error("Erreur serveur");
        blob = await res.blob();
      }
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none"; a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(blobUrl); a.remove();
    } catch (e) {
      alert("Téléchargement échoué. Ouvrez via 'Voir' pour l'enregistrer.");
    }
  }

  // ============================================
  // CLÉ API
  // ============================================
  const apiModal = document.getElementById("api-modal");
  const apiKeyInput = document.getElementById("api-key-input");
  const apiKeySave = document.getElementById("api-key-save");
  const apiKeyStatus = document.getElementById("api-key-status");
  const apiKeyBtn = document.getElementById("api-key-btn");
  const apiDot = document.getElementById("api-dot");

  function getKey() { return sessionStorage.getItem("agnes_api_key") || ""; }
  function setKey(k) { sessionStorage.setItem("agnes_api_key", k); }

  async function validateKey(key) {
    try {
      const r = await fetch("/api/health", { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": key }, body: JSON.stringify({}) });
      return (await r.json()).valid === true;
    } catch { return false; }
  }

  async function bootApi() {
    const key = getKey();
    if (!key) { apiDot.classList.remove("ok"); apiModal.hidden = false; return; }
    const ok = await validateKey(key);
    if (ok) apiDot.classList.add("ok");
    else { apiDot.classList.remove("ok"); apiModal.hidden = false; }
  }

  apiKeySave.addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;
    apiKeySave.disabled = true;
    const ok = await validateKey(key);
    apiKeySave.disabled = false;
    if (ok) { setKey(key); apiDot.classList.add("ok"); apiModal.hidden = true; }
    else { apiKeyStatus.textContent = "Clé invalide."; apiKeyStatus.className = "api-status err"; }
  });

  apiKeyBtn.addEventListener("click", () => { apiKeyInput.value = getKey(); apiModal.hidden = false; });
  bootApi();

  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}), "X-API-Key": getKey() };
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    return fetch(url, { ...options, headers });
  }

  // ============================================
  // TABS
  // ============================================
  const tabs = document.querySelectorAll(".tab-btn");
  const sections = document.querySelectorAll(".section");
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((b) => b.classList.remove("active"));
    sections.forEach((s) => s.classList.remove("active"));
    t.classList.add("active");
    document.getElementById(`section-${t.id.split("-")[1]}`).classList.add("active");
  }));

  // ============================================
  // CHAT & IMAGE (Inchangés pour la concision)
  // ============================================
  // ... (Le code du Chat et de l'Image reste identique à la version précédente) ...

  // ============================================
  // HISTORIQUES
  // ============================================
  function saveToHistory(type, prompt, url, id) {
    const key = type === "story" ? "videoai_story_history" : "videoai_video_history";
    const h = JSON.parse(localStorage.getItem(key) || "[]");
    h.unshift({ prompt, url, id, date: new Date().toLocaleDateString("fr-FR") });
    localStorage.setItem(key, JSON.stringify(h.slice(0, 20)));
    renderHistory(type);
  }

  function renderHistory(type) {
    const key = type === "story" ? "videoai_story_history" : "videoai_video_history";
    const el = document.getElementById(type === "story" ? "story-history" : "video-history");
    const h = JSON.parse(localStorage.getItem(key) || "[]");
    if (h.length === 0) { el.innerHTML = "<p style='color:gray;'>Aucune vidéo.</p>"; return; }
    el.innerHTML = h.map((i) => `
      <div class="history-item">
        <span class="history-prompt">${escapeHtml(i.prompt)}</span>
        <div class="history-actions">
          <a href="${i.url}" target="_blank" class="history-btn">Voir</a>
          <button class="history-btn dl-vid-btn" data-url="${i.url}" data-id="${i.id}">⬇ Télécharger</button>
        </div>
      </div>`).join("");
    el.querySelectorAll(".dl-vid-btn").forEach(btn => {
      btn.addEventListener("click", (e) => downloadFile(e.target.dataset.url, `videoai-${e.target.dataset.id}.mp4`, e.target.dataset.id));
    });
  }

  // ============================================
  // GESTION DES SLOTS (Cœur du système de reprise)
  // ============================================
  const slotTemplate = document.getElementById("slot-template");
  const activePolls = new Map(); // Map<slotId, { videoId, intervalId }>

  function createSlot(node, context = "video", getSharedImages = () => []) {
    const promptEl = node.querySelector(".slot-prompt");
    const formatEl = node.querySelector(".slot-format");
    const durationEl = node.querySelector(".slot-duration");
    const genBtn = node.querySelector(".slot-gen-btn");
    const dlBtn = node.querySelector(".slot-dl-btn");
    const statusEl = node.querySelector(".slot-status");
    const player = node.querySelector(".slot-player");
    const video = node.querySelector("video");
    const uploadBtn = node.querySelector(".slot-upload-btn");
    const imgInput = node.querySelector(".slot-img-input");

    const state = { base64: null, id: null, url: null };
    const slotId = "slot_" + Math.random().toString(36).substr(2, 9);

    uploadBtn.addEventListener("click", () => imgInput.click());
    imgInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { state.base64 = r.result.split(",")[1]; uploadBtn.textContent = "✅ Image"; };
      r.readAsDataURL(f);
    });

    function setStatus(s, txt) {
      statusEl.dataset.state = s;
      statusEl.innerHTML = `<span class="dot"></span> ${txt}`;
    }

    async function checkStatus() {
      if (!state.id) return;
      try {
        const s = await apiFetch(`/api/status/${state.id}`);
        const info = await s.json();
        
        if (info.status === "completed" && info.url) {
          state.url = info.url;
          video.src = info.url;
          player.hidden = false;
          dlBtn.disabled = false;
          setStatus("ready", "Prête");
          genBtn.disabled = false;
          saveToHistory(context, promptEl.value.trim(), info.url, state.id);
          
          // Nettoyage : on arrête le polling et on retire l'état sauvegardé
          const pollData = activePolls.get(slotId);
          if (pollData) clearInterval(pollData.intervalId);
          activePolls.delete(slotId);
          localStorage.removeItem(`video_job_${slotId}`);
          return true;
        } else if (info.status === "failed") {
          setStatus("error", "Échec");
          genBtn.disabled = false;
          const pollData = activePolls.get(slotId);
          if (pollData) clearInterval(pollData.intervalId);
          activePolls.delete(slotId);
          localStorage.removeItem(`video_job_${slotId}`);
          return true;
        }
      } catch (err) {
        console.warn("Erreur polling (réseau) :", err);
      }
      return false;
    }

    genBtn.addEventListener("click", async () => {
      if (!promptEl.value.trim()) return;
      genBtn.disabled = true;
      dlBtn.disabled = true;
      player.hidden = true;
      video.src = "";
      setStatus("queued", "En file d'attente…");

      const refs = [];
      if (state.base64) refs.push(state.base64);
      if (context === "story") {
        getSharedImages().forEach(img => { if (img && !refs.includes(img) && refs.length < 5) refs.push(img); });
      }

      const body = { prompt: promptEl.value.trim(), format: formatEl.value, duration: parseInt(durationEl.value, 10) };
      if (refs.length > 0) body.images = refs;

      try {
        const res = await apiFetch("/api/generate-video", { method: "POST", body: JSON.stringify(body) });
        const contentType = res.headers.get("content-type");
        let data;
        if (contentType && contentType.includes("application/json")) data = await res.json();
        else throw new Error(`Erreur serveur (${res.status})`);

        if (!data.id) throw new Error(data.error || "Pas d'ID");
        
        state.id = data.id;
        setStatus("loading", "Génération…");
        
        // SAUVEGARDE DE L'ÉTAT
        localStorage.setItem(`video_job_${slotId}`, JSON.stringify({ id: state.id, context, prompt: promptEl.value.trim() }));
        
        // Lancement du polling
        const intervalId = setInterval(checkStatus, 3000);
        activePolls.set(slotId, { videoId: state.id, intervalId });
        
        // Première vérification immédiate
        setTimeout(checkStatus, 1000);

      } catch (e) {
        setStatus("error", "Erreur : " + e.message);
        genBtn.disabled = false;
      }
    });

    dlBtn.addEventListener("click", () => {
      if (!state.url) return;
      downloadFile(state.url, `videoai-${state.id}.mp4`, state.id);
    });
  }

  // ============================================
  // REPRISE AUTOMATIQUE (Après fermeture ou mise en arrière-plan)
  // ============================================
  function resumePendingJobs() {
    const videoSlots = document.querySelectorAll("#video-slots .slot");
    const storySlots = document.querySelectorAll("#story-slots .slot");
    
    const allSlots = [
      ...Array.from(videoSlots).map((node, i) => ({ node, context: "video", idx: i })),
      ...Array.from(storySlots).map((node, i) => ({ node, context: "story", idx: i }))
    ];

    allSlots.forEach(({ node, context }) => {
      // On identifie le slot par son contenu (prompt) pour retrouver son ID unique
      // C'est une approximation, mais elle fonctionne bien pour la reprise.
      // Dans une version parfaite, on stockerait l'index du slot.
      const promptVal = node.querySelector(".slot-prompt").value.trim();
      if (!promptVal) return;

      // On cherche un job sauvegardé qui correspond à ce prompt
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith("video_job_")) {
          const job = JSON.parse(localStorage.getItem(key));
          if (job.prompt === promptVal && job.context === context) {
            // On a trouvé le job correspondant !
            const statusEl = node.querySelector(".slot-status");
            if (statusEl && statusEl.dataset.state !== "ready") {
              statusEl.dataset.state = "loading";
              statusEl.innerHTML = `<span class="dot"></span> Reprise du suivi…`;
              
              // On réactive le slot
              const slotId = key.replace("video_job_", "");
              const intervalId = setInterval(async () => {
                const res = await apiFetch(`/api/status/${job.id}`);
                const info = await res.json();
                if (info.status === "completed" && info.url) {
                  clearInterval(intervalId);
                  localStorage.removeItem(key);
                  node.querySelector("video").src = info.url;
                  node.querySelector(".slot-player").hidden = false;
                  node.querySelector(".slot-dl-btn").disabled = false;
                  statusEl.dataset.state = "ready";
                  statusEl.innerHTML = `<span class="dot"></span> Prête`;
                  node.querySelector(".slot-gen-btn").disabled = false;
                } else if (info.status === "failed") {
                  clearInterval(intervalId);
                  localStorage.removeItem(key);
                  statusEl.dataset.state = "error";
                  statusEl.innerHTML = `<span class="dot"></span> Échec`;
                  node.querySelector(".slot-gen-btn").disabled = false;
                }
              }, 3000);
              
              activePolls.set(slotId, { videoId: job.id, intervalId });
            }
          }
        }
      }
    });
  }

  // Écouteurs d'événements pour la reprise
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      console.log("Reprise : vérification des jobs en attente...");
      resumePendingJobs();
    }
  });

  window.addEventListener("pagehide", () => {
    // Sauvegarde de secours avant fermeture (optionnel car déjà fait au clic)
    console.log("Page mise en arrière-plan, sauvegarde effectuée.");
  });

  // ============================================
  // INITIALISATION
  // ============================================
  const videoSlotsContainer = document.getElementById("video-slots");
  for (let i = 0; i < 10; i++) {
    const node = slotTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `#${i + 1}`;
    videoSlotsContainer.appendChild(node);
    createSlot(node, "video");
  }
  renderHistory("video");

  const charsContainer = document.getElementById("story-characters");
  const charTemplate = document.getElementById("char-template");
  const charCountEl = document.getElementById("char-count");
  const addCharBtn = document.getElementById("add-char-btn");
  const storySlotsContainer = document.getElementById("story-slots");

  function updateCharUI() {
    const n = charsContainer.querySelectorAll(".char-card").length;
    charCountEl.textContent = `${n} / 10`;
    addCharBtn.hidden = n >= 10;
  }

  function addCharCard() {
    if (charsContainer.querySelectorAll(".char-card").length >= 10) return;
    const node = charTemplate.content.firstElementChild.cloneNode(true);
    const thumb = node.querySelector(".char-thumb");
    const fileInput = node.querySelector(".char-img-input");
    const delBtn = node.querySelector(".char-del");
    node._imageBase64 = null;

    thumb.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { node._imageBase64 = r.result.split(",")[1]; thumb.innerHTML = `<img src="${r.result}">`; };
      r.readAsDataURL(f);
    });

    delBtn.addEventListener("click", () => { node.remove(); updateCharUI(); });
    charsContainer.appendChild(node);
    updateCharUI();
  }

  function getCurrentCharacterImages() {
    const imgs = [];
    charsContainer.querySelectorAll(".char-card").forEach((card) => {
      if (card._imageBase64) imgs.push(card._imageBase64);
    });
    return imgs;
  }

  addCharBtn.addEventListener("click", addCharCard);
  addCharCard();

  for (let i = 0; i < 10; i++) {
    const node = slotTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `Scène ${i + 1}`;
    storySlotsContainer.appendChild(node);
    createSlot(node, "story", getCurrentCharacterImages);
  }
  renderHistory("story");

  // Lancer la reprise au démarrage
  resumePendingJobs();

})();
