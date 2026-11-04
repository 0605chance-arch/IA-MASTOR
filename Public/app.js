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
    html = html
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>")
      .replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>");

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
      } else if (inTable) {
        tableHtml += "</table>";
        inTable = false;
      }
    }
    if (inTable) tableHtml += "</table>";
    if (tableHtml) html = html.replace(/(\|.*\|)+/g, tableHtml);
    return html.replace(/\n/g, "<br>");
  }

  // Convertir une URL d'image en Base64 (nécessaire pour l'API Vidéo Agnes)
  async function urlToBase64(url) {
    if (url.startsWith("data:image")) return url.split(",")[1];
    const proxyUrl = `/api/download/${Date.now()}?url=${encodeURIComponent(url)}`;
    const res = await apiFetch(proxyUrl);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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
      alert("Téléchargement échoué. Ouvrez via 'Voir' pour enregistrer.");
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
  // TABS PRINCIPAUX
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
  // CHAT & IMAGE LOGIC
  // ============================================
  // (Code du Chat et de l'Image inchangé et fonctionnel)
  const chatHistory = document.getElementById("chat-history");
  const chatInput = document.getElementById("chat-input");
  const chatSend = document.getElementById("chat-send");
  const chatImageUpload = document.getElementById("chat-image-upload");
  const chatImageBtn = document.getElementById("chat-image-btn");
  const sessionsList = document.getElementById("chat-sessions-list");
  const newChatBtn = document.getElementById("new-chat-btn");

  let chatImageBase64 = null;
  let allSessions = JSON.parse(localStorage.getItem("adopte_chat_sessions") || "[]");
  let currentSessionId = null;

  chatImageBtn.addEventListener("click", () => chatImageUpload.click());
  chatImageUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { chatImageBase64 = reader.result.split(",")[1]; chatImageBtn.textContent = "✅"; };
    reader.readAsDataURL(file);
  });

  function saveSessions() { localStorage.setItem("adopte_chat_sessions", JSON.stringify(allSessions)); }

  function createNewSession() {
    const n = { id: Date.now().toString(), title: "Nouvelle conversation", messages: [{ role: "assistant", content: "Bonjour ! Comment puis-je vous aider ?" }] };
    allSessions.unshift(n); currentSessionId = n.id; saveSessions(); renderSessions(); renderChat();
  }

  function renderSessions() {
    sessionsList.innerHTML = "";
    allSessions.forEach((s) => {
      const div = document.createElement("div");
      div.className = `session-item ${s.id === currentSessionId ? "active" : ""}`;
      div.innerHTML = `<span>${escapeHtml(s.title)}</span><button class="session-del" data-id="${s.id}">×</button>`;
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains("session-del")) {
          e.stopPropagation();
          allSessions = allSessions.filter((x) => x.id !== e.target.dataset.id);
          if (currentSessionId === e.target.dataset.id) currentSessionId = allSessions[0]?.id || null;
          saveSessions(); renderSessions(); renderChat(); return;
        }
        currentSessionId = s.id; renderSessions(); renderChat();
      });
      sessionsList.appendChild(div);
    });
  }

  function renderChat() {
    chatHistory.innerHTML = "";
    if (!currentSessionId) return;
    const s = allSessions.find((x) => x.id === currentSessionId);
    if (!s) return;
    s.messages.forEach((m) => {
      if (m.role === "user") {
        let html = escapeHtml(m.content).replace(/\n/g, "<br>");
        if (m.imageBase64) html += `<br><img src="data:image/jpeg;base64,${m.imageBase64}" style="max-width:200px; border-radius:8px; margin-top:8px;">`;
        chatHistory.innerHTML += `<div class="message user">${html}</div>`;
      } else {
        chatHistory.innerHTML += `<div class="message assistant">${parseMarkdown(m.content)}</div>`;
      }
    });
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  newChatBtn.addEventListener("click", createNewSession);
  if (allSessions.length === 0) createNewSession();
  else { currentSessionId = allSessions[0].id; renderSessions(); renderChat(); }

  chatSend.addEventListener("click", async () => {
    const text = chatInput.value.trim();
    if (!text || !currentSessionId) return;
    const s = allSessions.find((x) => x.id === currentSessionId);
    chatInput.value = ""; chatSend.disabled = true;

    s.messages.push({ role: "user", content: text, imageBase64: chatImageBase64 || undefined });
    if (s.title === "Nouvelle conversation") { s.title = text.slice(0, 30) + "…"; renderSessions(); }
    saveSessions(); renderChat();

    try {
      const apiMessages = s.messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await apiFetch("/api/chat", { method: "POST", body: JSON.stringify({ messages: apiMessages, imageBase64: chatImageBase64 || undefined }) });
      const data = await res.json();
      if (data.content) s.messages.push({ role: "assistant", content: data.content });
      else if (data.error) s.messages.push({ role: "assistant", content: `⚠️ Erreur : ${data.error}` });
    } catch (e) {
      s.messages.push({ role: "assistant", content: "⚠️ Erreur réseau." });
    }
    saveSessions(); renderChat();
    chatImageBase64 = null; chatImageBtn.textContent = "📷"; chatSend.disabled = false;
  });

  const imgPrompt = document.getElementById("image-prompt");
  const imgFormat = document.getElementById("image-format");
  const imgBtn = document.getElementById("image-generate");
  const imgArea = document.getElementById("image-result-area");
  const imgResult = document.getElementById("image-result");
  const imgDownload = document.getElementById("image-download");
  const imgUploadInput = document.getElementById("image-upload");
  const imgUploadBtn = document.getElementById("image-upload-btn");
  const imgPreview = document.getElementById("image-preview");
  const imageHistoryEl = document.getElementById("image-history");

  let imgBase64 = null;

  imgUploadBtn.addEventListener("click", () => imgUploadInput.click());
  imgUploadInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { imgBase64 = reader.result.split(",")[1]; imgPreview.innerHTML = `<img src="${reader.result}">`; };
    reader.readAsDataURL(file);
  });

  imgBtn.addEventListener("click", async () => {
    if (!imgPrompt.value.trim()) return;
    imgBtn.disabled = true; imgBtn.textContent = "Génération…"; imgArea.hidden = true;
    try {
      const res = await apiFetch("/api/generate-image", { method: "POST", body: JSON.stringify({ prompt: imgPrompt.value, format: imgFormat.value, imageBase64: imgBase64 || undefined }) });
      const data = await res.json();
      if (data.url) {
        imgResult.src = data.url;
        imgDownload.onclick = (e) => { e.preventDefault(); downloadFile(data.url, `image-${data.id}.jpg`, data.id); };
        imgArea.hidden = false;
        const h = JSON.parse(localStorage.getItem("adopte_image_history") || "[]");
        h.unshift({ prompt: imgPrompt.value, url: data.url, id: data.id, date: new Date().toLocaleDateString("fr-FR") });
        localStorage.setItem("adopte_image_history", JSON.stringify(h.slice(0, 20)));
        renderImageHistory();
      } else alert(data.error);
    } catch { alert("Erreur réseau"); }
    imgBtn.disabled = false; imgBtn.textContent = "Générer l'image";
  });

  function renderImageHistory() {
    const h = JSON.parse(localStorage.getItem("adopte_image_history") || "[]");
    if (h.length === 0) { imageHistoryEl.innerHTML = "<p style='color:gray;'>Aucune image.</p>"; return; }
    imageHistoryEl.innerHTML = h.map((i) => `
      <div class="history-item">
        <span class="history-prompt">${escapeHtml(i.prompt)}</span>
        <div class="history-actions">
          <a href="${i.url}" target="_blank" class="history-btn">Voir</a>
          <button class="history-btn dl-img-btn" data-url="${i.url}" data-id="${i.id}">⬇ Télécharger</button>
        </div>
      </div>`).join("");
    imageHistoryEl.querySelectorAll(".dl-img-btn").forEach(btn => btn.addEventListener("click", (e) => downloadFile(e.target.dataset.url, `image-${e.target.dataset.id}.jpg`, e.target.dataset.id)));
  }
  renderImageHistory();

  // ============================================
  // FACTORY SLOT VIDÉO (Onglet Vidéo)
  // ============================================
  const slotTemplate = document.getElementById("slot-template");
  const activePolls = new Map();
  const videoSlotsArray = [];

  function createSlot(node, saveHistoryCallback = null) {
    const promptEl = node.querySelector(".slot-prompt");
    const formatEl = node.querySelector(".slot-format");
    const durationEl = node.querySelector(".slot-duration");
    const genBtn = node.querySelector(".slot-gen-btn");
    const dlBtn = node.querySelector(".slot-dl-btn");
    const statusEl = node.querySelector(".slot-status");
    const player = node.querySelector(".slot-player");
    const video = node.querySelector("video");
    
    // Nouveaux éléments d'image
    const imgBtn = node.querySelector(".slot-img-btn");
    const imgInput = node.querySelector(".slot-img-input");
    const imgPreviewContainer = node.querySelector(".slot-img-preview-container");
    const imgPreview = node.querySelector(".slot-img-preview");

    const state = { base64: null, id: null, url: null };
    const slotId = "slot_" + Math.random().toString(36).substr(2, 9);

    function setStatus(s, txt) {
      statusEl.dataset.state = s;
      statusEl.innerHTML = `<span class="dot"></span> ${txt}`;
    }

    // Gestion de l'upload d'image
    imgBtn.addEventListener("click", () => imgInput.click());
    imgInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.base64 = reader.result.split(",")[1];
        imgPreview.src = reader.result;
        imgPreviewContainer.style.display = "block";
        imgBtn.textContent = "✅ Image prête";
      };
      reader.readAsDataURL(file);
    });

    async function checkStatus() {
      if (!state.id) return;
      try {
        const s = await apiFetch(`/api/status/${state.id}`);
        const info = await s.json();
        
        if (info.status === "completed" && info.url) {
          state.url = info.url; video.src = info.url; player.hidden = false;
          dlBtn.disabled = false; setStatus("ready", "Prête"); genBtn.disabled = false;
          if (saveHistoryCallback) saveHistoryCallback(promptEl.value.trim(), info.url, state.id);
          
          const pollData = activePolls.get(slotId);
          if (pollData) clearInterval(pollData.intervalId);
          activePolls.delete(slotId);
          localStorage.removeItem(`video_job_${slotId}`);
          return true;
        } else if (info.status === "failed") {
          setStatus("error", "Échec"); genBtn.disabled = false;
          const pollData = activePolls.get(slotId);
          if (pollData) clearInterval(pollData.intervalId);
          activePolls.delete(slotId);
          localStorage.removeItem(`video_job_${slotId}`);
          return true;
        }
      } catch (err) {}
      return false;
    }

    // Fonction pour le transfert depuis le Studio
    node.fillSlot = (promptText, base64Img) => {
      promptEl.value = promptText;
      if (base64Img) {
        state.base64 = base64Img;
        imgPreview.src = `data:image/jpeg;base64,${base64Img}`;
        imgPreviewContainer.style.display = "block";
        imgBtn.textContent = "✅ Image importée";
      } else {
        state.base64 = null;
        imgPreviewContainer.style.display = "none";
        imgBtn.textContent = "📷 Ajouter une image";
      }
      setStatus("idle", "Prêt (Importé)");
      // On remonte pour voir le slot
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    genBtn.addEventListener("click", async () => {
      if (!promptEl.value.trim()) return;
      genBtn.disabled = true; dlBtn.disabled = true; player.hidden = true; video.src = "";
      setStatus("queued", "En file d'attente…");

      const body = { prompt: promptEl.value.trim(), format: formatEl.value, duration: parseInt(durationEl.value, 10) };
      if (state.base64) body.images = [state.base64];

      try {
        const res = await apiFetch("/api/generate-video", { method: "POST", body: JSON.stringify(body) });
        const data = await res.json();
        if (!data.id) throw new Error(data.error || "Pas d'ID");
        
        state.id = data.id; setStatus("loading", "Génération…");
        localStorage.setItem(`video_job_${slotId}`, JSON.stringify({ id: state.id, prompt: promptEl.value.trim() }));
        
        const intervalId = setInterval(checkStatus, 3000);
        activePolls.set(slotId, { videoId: state.id, intervalId });
        setTimeout(checkStatus, 1000);

      } catch (e) { setStatus("error", "Erreur : " + e.message); genBtn.disabled = false; }
    });

    dlBtn.addEventListener("click", () => { if (state.url) downloadFile(state.url, `video-${state.id}.mp4`, state.id); });
  }

  // Historique Vidéo
  function saveVideoToHistory(prompt, url, id) {
    const h = JSON.parse(localStorage.getItem("adopte_video_history") || "[]");
    h.unshift({ prompt, url, id, date: new Date().toLocaleDateString("fr-FR") });
    localStorage.setItem("adopte_video_history", JSON.stringify(h.slice(0, 20)));
    renderVideoHistory();
  }
  function renderVideoHistory() {
    const el = document.getElementById("video-history");
    const h = JSON.parse(localStorage.getItem("adopte_video_history") || "[]");
    if (h.length === 0) { el.innerHTML = "<p style='color:gray;'>Aucune vidéo.</p>"; return; }
    el.innerHTML = h.map((i) => `
      <div class="history-item">
        <span class="history-prompt">${escapeHtml(i.prompt)}</span>
        <div class="history-actions">
          <a href="${i.url}" target="_blank" class="history-btn">Voir</a>
          <button class="history-btn dl-vid-btn" data-url="${i.url}" data-id="${i.id}">⬇ Télécharger</button>
        </div>
      </div>`).join("");
    el.querySelectorAll(".dl-vid-btn").forEach(btn => btn.addEventListener("click", (e) => downloadFile(e.target.dataset.url, `video-${e.target.dataset.id}.mp4`, e.target.dataset.id)));
  }

  // Init Onglet Vidéo (10 Slots)
  const videoSlotsContainer = document.getElementById("video-slots");
  for (let i = 0; i < 10; i++) {
    const node = slotTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `#${i + 1}`;
    videoSlotsContainer.appendChild(node);
    createSlot(node, saveVideoToHistory);
    videoSlotsArray.push(node);
  }
  renderVideoHistory();

  // ============================================
  // STUDIO DE PRÉPRODUCTION (Superviseur IA)
  // ============================================
  const studioHome = document.getElementById("studio-home");
  const studioWizard = document.getElementById("studio-wizard");
  const studioWorkspace = document.getElementById("studio-workspace");
  
  let currentProject = JSON.parse(localStorage.getItem("adopte_studio_project") || "null");

  function showScreen(screenId) {
    [studioHome, studioWizard, studioWorkspace].forEach(el => el.hidden = true);
    if (screenId === "home") studioHome.hidden = false;
    if (screenId === "wizard") studioWizard.hidden = false;
    if (screenId === "workspace") studioWorkspace.hidden = false;
  }

  document.getElementById("studio-btn-new").addEventListener("click", () => showScreen("wizard"));
  document.getElementById("studio-btn-continue").addEventListener("click", () => {
    if (currentProject) { renderWorkspace(currentProject); showScreen("workspace"); }
    else alert("Aucun projet sauvegardé. Créez-en un nouveau !");
  });

  document.getElementById("wizard-back-to-home").addEventListener("click", () => showScreen("home"));

  // Génération du Storyboard
  const wizGenBtn = document.getElementById("wizard-generate-btn");
  const wizLoading = document.getElementById("wizard-loading");

  wizGenBtn.addEventListener("click", async () => {
    const idea = document.getElementById("wizard-idea").value.trim();
    if (!idea) return alert("Veuillez décrire votre idée.");

    const sceneCount = parseInt(document.getElementById("wizard-scene-count").value, 10);
    const format = document.getElementById("wizard-format").value;
    const style = document.getElementById("wizard-style").value;
    const mood = document.getElementById("wizard-mood").value;

    wizGenBtn.hidden = true;
    wizLoading.hidden = false;

    try {
      const res = await apiFetch("/api/studio/generate-storyboard", {
        method: "POST",
        body: JSON.stringify({ projectIdea: idea, sceneCount, format, style, mood })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur de génération.");

      currentProject = { ...data, format };
      localStorage.setItem("adopte_studio_project", JSON.stringify(currentProject));
      renderWorkspace(currentProject);
      showScreen("workspace");
    } catch (e) {
      alert("Erreur de génération : " + e.message);
    } finally {
      wizGenBtn.hidden = false;
      wizLoading.hidden = true;
    }
  });

  // Rendu du Workspace (Storyboard)
  function renderWorkspace(project) {
    document.getElementById("workspace-title").textContent = project.titre || "Projet sans titre";
    document.getElementById("workspace-synopsis").textContent = project.synopsis || "";
    document.getElementById("ws-script-synopsis").textContent = project.synopsis || "";

    // Onglets
    const tabBtns = document.querySelectorAll(".ws-tab-btn");
    const tabContents = document.querySelectorAll(".ws-tab-content");
    tabBtns.forEach(btn => {
      btn.onclick = () => {
        tabBtns.forEach(b => b.classList.remove("active"));
        tabContents.forEach(c => c.hidden = true);
        btn.classList.add("active");
        document.getElementById(btn.dataset.target).hidden = false;
      };
    });

    // 1. Personnages
    const charsContainer = document.getElementById("ws-characters-container");
    charsContainer.innerHTML = "";
    (project.personnages || []).forEach(p => {
      const charNode = document.getElementById("char-template").content.firstElementChild.cloneNode(true);
      charNode.querySelector(".char-name").value = p.nom;
      charNode.querySelector(".char-desc").value = p.description_physique || p.description_reference || "";
      charsContainer.appendChild(charNode);
    });

    // 2. Scènes
    const scenesContainer = document.getElementById("ws-scenes-container");
    scenesContainer.innerHTML = "";
    const sceneTemplate = document.getElementById("studio-scene-template");

    (project.scenes || []).forEach(scene => {
      const node = sceneTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".studio-scene-title").textContent = `Scène ${scene.numero} : ${scene.titre}`;
      node.querySelector(".studio-scene-action").textContent = scene.description_action;
      node.querySelector(".studio-scene-prompt").value = scene.prompt_video;

      // Copier le prompt
      node.querySelector(".studio-scene-copy-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(scene.prompt_video).then(() => alert("Prompt copié !"));
      });

      // Générer l'image
      let currentImgBase64 = null;
      const imgPlaceholder = node.querySelector(".studio-scene-img-placeholder");
      const imgEl = node.querySelector(".studio-scene-img");
      const imgBtn = node.querySelector(".studio-scene-img-btn");

      imgBtn.addEventListener("click", async () => {
        imgBtn.disabled = true; imgBtn.textContent = "Génération…";
        try {
          const res = await apiFetch("/api/generate-image", { 
            method: "POST", 
            body: JSON.stringify({ prompt: scene.prompt_video, format: project.format || "16:9" }) 
          });
          const data = await res.json();
          if (data.url) {
            imgEl.src = data.url; imgEl.hidden = false; imgPlaceholder.hidden = true;
            // Convertir l'URL en Base64 pour l'API Vidéo
            currentImgBase64 = await urlToBase64(data.url); 
            imgBtn.textContent = "🔄 Régénérer";
          }
        } catch (e) { alert("Erreur d'image."); }
        imgBtn.disabled = false;
      });

      // Envoyer vers Vidéo
      node.querySelector(".studio-scene-send-btn").addEventListener("click", () => {
        let targetSlot = null;
        for (const slot of videoSlotsArray) {
          if (!slot.querySelector(".slot-prompt").value.trim()) { targetSlot = slot; break; }
        }
        
        if (targetSlot) {
          targetSlot.fillSlot(scene.prompt_video, currentImgBase64);
          document.getElementById("tab-video").click();
        } else {
          alert("L'onglet Vidéo est plein (10 slots utilisés).");
        }
      });

      scenesContainer.appendChild(node);
    });

    document.getElementById("workspace-back-btn").onclick = () => showScreen("home");
  }

  // ============================================
  // REPRISE AUTOMATIQUE (Anti Load Failed iOS)
  // ============================================
  function resumePendingJobs() {
    document.querySelectorAll(".slot").forEach(node => {
      const promptVal = node.querySelector(".slot-prompt").value.trim();
      if (!promptVal) return;
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith("video_job_")) {
          const job = JSON.parse(localStorage.getItem(key));
          if (job.prompt === promptVal) {
            const statusEl = node.querySelector(".slot-status");
            if (statusEl && statusEl.dataset.state !== "ready") {
              statusEl.dataset.state = "loading";
              statusEl.innerHTML = `<span class="dot"></span> Reprise…`;
              
              const intervalId = setInterval(async () => {
                const res = await apiFetch(`/api/status/${job.id}`);
                const info = await res.json();
                if (info.status === "completed" && info.url) {
                  clearInterval(intervalId); localStorage.removeItem(key);
                  node.querySelector("video").src = info.url; node.querySelector(".slot-player").hidden = false;
                  node.querySelector(".slot-dl-btn").disabled = false; statusEl.dataset.state = "ready";
                  statusEl.innerHTML = `<span class="dot"></span> Prête`; node.querySelector(".slot-gen-btn").disabled = false;
                } else if (info.status === "failed") {
                  clearInterval(intervalId); localStorage.removeItem(key);
                  statusEl.dataset.state = "error"; statusEl.innerHTML = `<span class="dot"></span> Échec`;
                  node.querySelector(".slot-gen-btn").disabled = false;
                }
              }, 3000);
            }
          }
        }
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumePendingJobs();
  });

  resumePendingJobs();

})();
