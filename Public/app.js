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

  async function urlToBase64(url) {
    if (url.startsWith("data:image")) return url.split(",")[1];
    const proxyUrl = `/api/download/${Date.now()}?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { headers: { "X-API-Key": getKey() } });
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
        const res = await fetch(proxyUrl, { headers: { "X-API-Key": getKey() } });
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const r = await fetch("/api/health", { 
        method: "POST", 
        headers: { "Content-Type": "application/json", "X-API-Key": key }, 
        body: JSON.stringify({}),
        signal: controller.signal
      });
      clearTimeout(timer);
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
    apiKeyStatus.textContent = "Validation...";
    apiKeyStatus.className = "api-status";
    
    const ok = await validateKey(key);
    apiKeySave.disabled = false;
    
    if (ok) { setKey(key); apiDot.classList.add("ok"); apiModal.hidden = true; }
    else { apiKeyStatus.textContent = "Clé invalide ou serveur endormi."; apiKeyStatus.className = "api-status err"; }
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
  // CHAT
  // ============================================
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
    const n = { id: Date.now().toString(), title: "Nouvelle conversation", messages: [{ role: "assistant", content: "Bonjour !" }] };
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

  // ============================================
  // IMAGE
  // ============================================
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
        h.unshift({ prompt: imgPrompt.value, url: data.url, id: data.id });
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
  // VIDÉO (MÉCANIQUE POLLING CLASSIQUE)
  // ============================================
  const slotTemplate = document.getElementById("slot-template");
  const videoSlotsArray = [];
  const videoSlotsContainer = document.getElementById("video-slots");

  function createSlot(node, index) {
    const promptEl = node.querySelector(".slot-prompt");
    const formatEl = node.querySelector(".slot-format");
    const durationEl = node.querySelector(".slot-duration");
    const genBtn = node.querySelector(".slot-gen-btn");
    const dlBtn = node.querySelector(".slot-dl-btn");
    const statusEl = node.querySelector(".slot-status");
    const player = node.querySelector(".slot-player");
    const video = node.querySelector("video");
    const imgBtn = node.querySelector(".slot-img-btn");
    const imgInput = node.querySelector(".slot-img-input");
    const imgPreviewContainer = node.querySelector(".slot-img-preview-container");
    const imgPreview = node.querySelector(".slot-img-preview");

    const state = { base64: null, url: null, taskId: null, pollInterval: null };

    function setStatus(s, txt) {
      statusEl.dataset.state = s;
      statusEl.innerHTML = `<span class="dot"></span> ${txt}`;
    }

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
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    function startPolling(taskId) {
      if (state.pollInterval) clearInterval(state.pollInterval);
      
      state.pollInterval = setInterval(async () => {
        try {
          const res = await apiFetch(`/api/task-status/${taskId}`);
          if (!res.ok) return;
          const info = await res.json();

          if (info.status === "completed" && info.url) {
            clearInterval(state.pollInterval);
            state.url = info.url;
            video.src = info.url;
            player.hidden = false;
            dlBtn.disabled = false;
            setStatus("ready", "Prête");
            genBtn.disabled = false;
            
            // Sauvegarde historique
            const saved = JSON.parse(localStorage.getItem(`video_task_${taskId}`) || "{}");
            if (saved.prompt) {
              const h = JSON.parse(localStorage.getItem("adopte_video_history") || "[]");
              h.unshift({ prompt: saved.prompt, url: info.url, id: taskId });
              localStorage.setItem("adopte_video_history", JSON.stringify(h.slice(0, 20)));
              renderVideoHistory();
            }
            localStorage.removeItem(`video_task_${taskId}`);
          } else if (info.status === "failed") {
            clearInterval(state.pollInterval);
            setStatus("error", "Échec de génération");
            genBtn.disabled = false;
            localStorage.removeItem(`video_task_${taskId}`);
          } else if (info.status === "processing") {
            setStatus("loading", "Génération…");
          } else if (info.status === "queued") {
            setStatus("queued", "En file d'attente…");
          }
        } catch (e) {
          // Ignore les erreurs réseau transitoires
        }
      }, 3000);
    }

    genBtn.addEventListener("click", async () => {
      if (!promptEl.value.trim()) return;
      
      if (!state.taskId) state.taskId = "task_" + Date.now() + "_" + Math.floor(Math.random()*1000);
      
      genBtn.disabled = true; dlBtn.disabled = true; player.hidden = true;
      setStatus("queued", "Envoi au serveur...");

      const body = {
        prompt: promptEl.value.trim(),
        format: formatEl.value,
        duration: parseInt(durationEl.value, 10),
        taskId: state.taskId
      };
      if (state.base64) body.images = [state.base64];

      try {
        const res = await apiFetch("/api/generate-video", { method: "POST", body: JSON.stringify(body) });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || "Erreur serveur");
        
        node.dataset.taskId = state.taskId;
        localStorage.setItem(`video_task_${state.taskId}`, JSON.stringify({ prompt: promptEl.value.trim(), slotIndex: index }));
        
        startPolling(state.taskId);

      } catch (e) { 
        setStatus("error", "Erreur : " + e.message); 
        genBtn.disabled = false; 
      }
    });

    dlBtn.addEventListener("click", () => { 
      if (state.url) downloadFile(state.url, `video-${state.taskId}.mp4`, state.taskId); 
    });
  }

  for (let i = 0; i < 10; i++) {
    const node = slotTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `#${i + 1}`;
    videoSlotsContainer.appendChild(node);
    createSlot(node, i);
    videoSlotsArray.push(node);
  }

  // Reprise automatique au chargement ou retour sur l'app (iOS)
  function resumePendingJobs() {
    document.querySelectorAll(".slot").forEach(node => {
      const promptVal = node.querySelector(".slot-prompt").value.trim();
      if (!promptVal) return;
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith("video_task_")) {
          const job = JSON.parse(localStorage.getItem(key));
          if (job.prompt === promptVal) {
            const statusEl = node.querySelector(".slot-status");
            if (statusEl && statusEl.dataset.state !== "ready") {
              // Relancer le polling pour ce slot
              const taskId = key.replace("video_task_", "");
              node.dataset.taskId = taskId;
              
              // On simule un clic pour relancer la mécanique de polling
              // (sans renvoyer la requête au serveur, juste le suivi)
              const pollInterval = setInterval(async () => {
                try {
                  const res = await apiFetch(`/api/task-status/${taskId}`);
                  if (!res.ok) return;
                  const info = await res.json();
                  if (info.status === "completed" && info.url) {
                    clearInterval(pollInterval);
                    node.querySelector("video").src = info.url; 
                    node.querySelector(".slot-player").hidden = false;
                    node.querySelector(".slot-dl-btn").disabled = false; 
                    statusEl.dataset.state = "ready";
                    statusEl.innerHTML = `<span class="dot"></span> Prête`; 
                    node.querySelector(".slot-gen-btn").disabled = false;
                    localStorage.removeItem(key);
                  } else if (info.status === "failed") {
                    clearInterval(pollInterval);
                    statusEl.dataset.state = "error"; statusEl.innerHTML = `<span class="dot"></span> Échec`;
                    node.querySelector(".slot-gen-btn").disabled = false;
                    localStorage.removeItem(key);
                  }
                } catch(e) {}
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
  renderVideoHistory();

  // ============================================
  // STUDIO
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
    else alert("Aucun projet sauvegardé.");
  });
  document.getElementById("wizard-back-to-home").addEventListener("click", () => showScreen("home"));

  const wizGenBtn = document.getElementById("wizard-generate-btn");
  const wizLoading = document.getElementById("wizard-loading");

  wizGenBtn.addEventListener("click", async () => {
    const idea = document.getElementById("wizard-idea").value.trim();
    if (!idea) return alert("Veuillez décrire votre idée.");

    const sceneCount = parseInt(document.getElementById("wizard-scene-count").value, 10);
    const format = document.getElementById("wizard-format").value;
    const style = document.getElementById("wizard-style").value;
    const mood = document.getElementById("wizard-mood").value;

    wizGenBtn.hidden = true; wizLoading.hidden = false;

    try {
      const res = await apiFetch("/api/studio/generate-storyboard", {
        method: "POST",
        body: JSON.stringify({ projectIdea: idea, sceneCount, format, style, mood })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");

      currentProject = { ...data, format };
      localStorage.setItem("adopte_studio_project", JSON.stringify(currentProject));
      renderWorkspace(currentProject);
      showScreen("workspace");
    } catch (e) { alert("Erreur : " + e.message); }
    finally { wizGenBtn.hidden = false; wizLoading.hidden = true; }
  });

  function renderWorkspace(project) {
    document.getElementById("workspace-title").textContent = project.titre || "Projet";
    document.getElementById("workspace-synopsis").textContent = project.synopsis || "";
    document.getElementById("ws-script-synopsis").textContent = project.synopsis || "";

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

    const charsContainer = document.getElementById("ws-characters-container");
    charsContainer.innerHTML = "";
    (project.personnages || []).forEach(p => {
      const charNode = document.getElementById("char-template").content.firstElementChild.cloneNode(true);
      charNode.querySelector(".char-name").value = p.nom;
      charNode.querySelector(".char-desc").value = p.description_physique || p.description_reference || "";
      charsContainer.appendChild(charNode);
    });

    const scenesContainer = document.getElementById("ws-scenes-container");
    scenesContainer.innerHTML = "";
    const sceneTemplate = document.getElementById("studio-scene-template");
    
    (project.scenes || []).forEach(scene => {
      const node = sceneTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".studio-scene-title").textContent = `Scène ${scene.numero} : ${scene.titre}`;
      node.querySelector(".studio-scene-action").textContent = scene.description_action;
      node.querySelector(".studio-scene-prompt").value = scene.prompt_video;

      node.querySelector(".studio-scene-copy-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(scene.prompt_video).then(() => alert("Copié !"));
      });

      let currentImgBase64 = null;
      const imgPlaceholder = node.querySelector(".studio-scene-img-placeholder");
      const imgEl = node.querySelector(".studio-scene-img");
      const imgBtn = node.querySelector(".studio-scene-img-btn");

      imgBtn.addEventListener("click", async () => {
        imgBtn.disabled = true; imgBtn.textContent = "Génération…";
        try {
          const res = await apiFetch("/api/generate-image", { method: "POST", body: JSON.stringify({ prompt: scene.prompt_video, format: project.format }) });
          const data = await res.json();
          if (data.url) {
            imgEl.src = data.url; imgEl.hidden = false; imgPlaceholder.hidden = true;
            currentImgBase64 = await urlToBase64(data.url); 
            imgBtn.textContent = "🔄 Régénérer";
          }
        } catch (e) { alert("Erreur image."); }
        imgBtn.disabled = false;
      });

      node.querySelector(".studio-scene-send-btn").addEventListener("click", () => {
        let targetSlot = null;
        for (const slot of videoSlotsArray) {
          if (!slot.querySelector(".slot-prompt").value.trim()) { targetSlot = slot; break; }
        }
        if (targetSlot) {
          targetSlot.fillSlot(scene.prompt_video, currentImgBase64);
          document.getElementById("tab-video").click();
        } else { alert("L'onglet Vidéo est plein."); }
      });

      scenesContainer.appendChild(node);
    });

    document.getElementById("workspace-back-btn").onclick = () => showScreen("home");
  }

})();
