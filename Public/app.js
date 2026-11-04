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
  // CHAT LOGIC
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

  // ============================================
  // IMAGE LOGIC
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
  // HISTORIQUE VIDÉO (Onglet Vidéo)
  // ============================================
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

  // ============================================
  // FACTORY SLOT VIDÉO (Partagé)
  // ============================================
  const slotTemplate = document.getElementById("slot-template");
  const activePolls = new Map();

  function createSlot(node, saveHistoryCallback = null) {
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

  // Initialisation de l'onglet Vidéo
  const videoSlotsContainer = document.getElementById("video-slots");
  for (let i = 0; i < 10; i++) {
    const node = slotTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `#${i + 1}`;
    videoSlotsContainer.appendChild(node);
    createSlot(node, saveVideoToHistory);
  }
  renderVideoHistory();

  // ============================================
  // STUDIO DE PRODUCTION LOGIC
  // ============================================
  let wizardData = { type: "", idea: "", format: "16:9", duration: 30, style: "Cinématographique", mood: "Dramatique" };
  let currentWizardStep = 1;
  let currentProject = JSON.parse(localStorage.getItem("adopte_current_project") || "null");

  const viewHome = document.getElementById("studio-home");
  const viewWizard = document.getElementById("studio-wizard");
  const viewWorkspace = document.getElementById("studio-workspace");

  function showStudioView(view) {
    viewHome.hidden = view !== "home";
    viewWizard.hidden = view !== "wizard";
    viewWorkspace.hidden = view !== "workspace";
    viewHome.classList.toggle("active", view === "home");
    viewWizard.classList.toggle("active", view === "wizard");
    viewWorkspace.classList.toggle("active", view === "workspace");
  }

  // Navigation interne du Studio
  document.getElementById("studio-btn-new").addEventListener("click", () => { currentWizardStep = 1; renderWizard(); showStudioView("wizard"); });
  document.getElementById("studio-btn-continue").addEventListener("click", () => {
    if (currentProject) loadWorkspace(currentProject);
    else alert("Aucun projet en cours. Créez-en un nouveau !");
  });
  document.getElementById("studio-btn-templates").addEventListener("click", () => {
    alert("Les modèles seront bientôt disponibles ! Utilisez 'Créer un projet' pour commencer.");
  });

  // Wizard Navigation
  const btnNext = document.getElementById("wizard-next");
  const btnPrev = document.getElementById("wizard-prev");
  const btnBackHome = document.getElementById("wizard-back-to-home");

  btnBackHome.addEventListener("click", () => showStudioView("home"));

  function renderWizard() {
    document.querySelectorAll(".wizard-step").forEach((el, i) => el.hidden = (i + 1) !== currentWizardStep);
    document.getElementById("wizard-progress").textContent = `Étape ${currentWizardStep} sur 4`;
    btnPrev.hidden = currentWizardStep === 1;
    btnNext.textContent = currentWizardStep === 4 ? "Lancer la production" : "Suivant";

    if (currentWizardStep === 4) {
      document.getElementById("wizard-summary").innerHTML = `
        <div style="padding: 15px; background: rgba(255,255,255,0.05); border-radius: 8px;">
          <p><strong>Type :</strong> ${wizardData.type}</p>
          <p><strong>Idée :</strong> ${wizardData.idea}</p>
          <p><strong>Format :</strong> ${wizardData.format} | <strong>Durée :</strong> ${wizardData.duration}s</p>
          <p><strong>Style :</strong> ${wizardData.style} | <strong>Ambiance :</strong> ${wizardData.mood}</p>
        </div>
      `;
    }
  }

  document.querySelectorAll(".wizard-option-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".wizard-option-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      wizardData.type = btn.dataset.type;
    });
  });

  btnPrev.addEventListener("click", () => { if (currentWizardStep > 1) { currentWizardStep--; renderWizard(); } });

  btnNext.addEventListener("click", async () => {
    if (currentWizardStep === 1) {
      if (!wizardData.type) return alert("Veuillez sélectionner un type de vidéo.");
    } else if (currentWizardStep === 2) {
      wizardData.idea = document.getElementById("wizard-idea").value.trim();
      if (!wizardData.idea) return alert("Veuillez décrire votre idée.");
    } else if (currentWizardStep === 3) {
      wizardData.format = document.getElementById("wizard-format").value;
      wizardData.duration = parseInt(document.getElementById("wizard-duration").value, 10);
      wizardData.style = document.getElementById("wizard-style").value;
      wizardData.mood = document.getElementById("wizard-mood").value;
    } else if (currentWizardStep === 4) {
      // Lancement de la génération
      btnNext.disabled = true;
      btnNext.textContent = "L'IA écrit le scénario... ⏳";
      try {
        const res = await apiFetch("/api/studio/generate-plan", { method: "POST", body: JSON.stringify(wizardData) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur de génération.");
        
        currentProject = data;
        localStorage.setItem("adopte_current_project", JSON.stringify(currentProject));
        loadWorkspace(currentProject);
      } catch (e) {
        alert("Erreur : " + e.message);
      } finally {
        btnNext.disabled = false;
        btnNext.textContent = "Lancer la production";
      }
      return;
    }
    currentWizardStep++;
    renderWizard();
  });

  // Workspace Logic
  const wsNavBtns = document.querySelectorAll(".ws-nav-btn");
  wsNavBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      wsNavBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".ws-tab").forEach(t => t.hidden = true);
      document.getElementById(btn.dataset.target).hidden = false;
    });
  });

  document.getElementById("workspace-back-btn").addEventListener("click", () => showStudioView("home"));

  function loadWorkspace(project) {
    showStudioView("workspace");
    document.getElementById("workspace-title").textContent = project.titre;
    document.getElementById("workspace-synopsis").textContent = project.synopsis;
    document.getElementById("ws-synopsis-text").textContent = project.synopsis;

    // Direction Artistique
    const da = project.direction_artistique || {};
    document.getElementById("ws-da-info").innerHTML = `
      <p><strong>Palette :</strong> ${da.palette || "Standard"}</p>
      <p><strong>Lumière :</strong> ${da.lumiere || "Cinématographique"}</p>
      <p><strong>Ambiance :</strong> ${da.ambiance || "Standard"}</p>
    `;

    // Personnages
    const charsContainer = document.getElementById("ws-characters-list");
    charsContainer.innerHTML = "";
    (project.personnages || []).forEach(p => {
      const charNode = document.getElementById("char-template").content.firstElementChild.cloneNode(true);
      charNode.querySelector(".char-name").value = p.nom;
      charNode.querySelector(".char-desc").value = p.description_reference;
      charsContainer.appendChild(charNode);
    });

    // Scènes & Vidéos
    const scenesContainer = document.getElementById("ws-scenes-list");
    scenesContainer.innerHTML = "";
    (project.scenes || []).forEach(scene => {
      const node = slotTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".slot-num").textContent = `Scène ${scene.numero}`;
      node.querySelector(".slot-prompt").value = scene.prompt_video;
      node.querySelector(".slot-duration").value = scene.duree || 4;
      scenesContainer.appendChild(node);
      createSlot(node, () => {}); // Callback d'historique vide pour le studio
    });
  }

  // Reprise auto au démarrage si un projet est en cours
  if (currentProject) document.getElementById("studio-projects-list").hidden = false;

  // Exportation
  document.getElementById("export-json").addEventListener("click", () => {
    if (!currentProject) return;
    const blob = new Blob([JSON.stringify(currentProject, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `dossier-production-${currentProject.titre.replace(/\s+/g, '_')}.json`;
    a.click(); URL.revokeObjectURL(url);
  });

  document.getElementById("export-txt").addEventListener("click", () => {
    if (!currentProject) return;
    let txt = `=== DOSSIER DE PRODUCTION : ${currentProject.titre} ===\n\n`;
    txt += `SYNOPSIS:\n${currentProject.synopsis}\n\n`;
    txt += `--- PERSONNAGES ---\n`;
    (currentProject.personnages || []).forEach(p => txt += `[${p.nom}] ${p.description_reference}\n`);
    txt += `\n--- SCÈNES & PROMPTS ---\n`;
    (currentProject.scenes || []).forEach(s => {
      txt += `\nSCÈNE ${s.numero} (${s.duree}s):\n`;
      txt += `Action: ${s.description_action}\n`;
      txt += `Prompt: ${s.prompt_video}\n`;
    });
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `script-${currentProject.titre.replace(/\s+/g, '_')}.txt`;
    a.click(); URL.revokeObjectURL(url);
  });

  // ============================================
  // REPRISE AUTOMATIQUE (Anti Load Failed iOS)
  // ============================================
  function resumePendingJobs() {
    // Parcourt les slots qui pourraient avoir un job en cours
    const allSlots = document.querySelectorAll(".slot");
    allSlots.forEach(node => {
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
              statusEl.innerHTML = `<span class="dot"></span> Reprise du suivi…`;
              
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
    if (document.visibilityState === "visible") {
      resumePendingJobs();
    }
  });

  // Lancement au démarrage
  resumePendingJobs();

})();
