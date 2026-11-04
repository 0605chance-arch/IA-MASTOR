(function () {
  "use strict";

  // ============================================
  // UTILS & SÉCURITÉ
  // ============================================
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  // ============================================
  // TÉLÉCHARGEMENT UNIVERSEL (iOS / ANDROID)
  // ============================================
  async function downloadFile(url, filename, id) {
    try {
      let blob;

      // On utilise apiFetch pour passer la clé API au serveur proxy
      if (url.startsWith("data:")) {
        const res = await fetch(url);
        blob = await res.blob();
      } else {
        const proxyUrl = `/api/download/${id}?url=${encodeURIComponent(url)}`;
        const res = await apiFetch(proxyUrl);
        if (!res.ok) throw new Error("Erreur serveur lors du téléchargement");
        blob = await res.blob();
      }

      // Création du fichier local pour forcer le téléchargement
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = blobUrl;
      a.download = filename; 
      document.body.appendChild(a);
      a.click(); 
      window.URL.revokeObjectURL(blobUrl);
      a.remove();

    } catch (e) {
      console.error("Erreur de téléchargement:", e);
      alert("Le téléchargement a échoué. Si vous êtes sur iPhone, ouvrez la vidéo avec 'Voir' et utilisez le bouton de partage pour l'enregistrer dans vos fichiers.");
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
      const r = await fetch("/api/health", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": key },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      return data.valid === true;
    } catch {
      return false;
    }
  }

  async function bootApi() {
    const key = getKey();
    if (!key) {
      apiDot.classList.remove("ok");
      apiModal.hidden = false;
      return;
    }
    const ok = await validateKey(key);
    if (ok) apiDot.classList.add("ok");
    else {
      apiDot.classList.remove("ok");
      apiModal.hidden = false;
    }
  }

  apiKeySave.addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      apiKeyStatus.textContent = "Entrez une clé.";
      apiKeyStatus.className = "api-status err";
      return;
    }
    apiKeyStatus.textContent = "Validation…";
    apiKeyStatus.className = "api-status";
    apiKeySave.disabled = true;
    
    const ok = await validateKey(key);
    apiKeySave.disabled = false;
    
    if (ok) {
      setKey(key);
      apiDot.classList.add("ok");
      apiKeyStatus.textContent = "Clé validée ✓";
      apiKeyStatus.className = "api-status ok";
      setTimeout(() => { apiModal.hidden = true; apiKeyStatus.textContent = ""; }, 500);
    } else {
      apiKeyStatus.textContent = "Clé invalide ou expirée.";
      apiKeyStatus.className = "api-status err";
    }
  });

  apiKeyBtn.addEventListener("click", () => {
    apiKeyInput.value = getKey();
    apiKeyStatus.textContent = "";
    apiKeyStatus.className = "api-status";
    apiModal.hidden = false;
  });

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
  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      tabs.forEach((b) => b.classList.remove("active"));
      sections.forEach((s) => s.classList.remove("active"));
      t.classList.add("active");
      const name = t.id.split("-")[1];
      document.getElementById(`section-${name}`).classList.add("active");
    })
  );

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
  let allSessions = JSON.parse(localStorage.getItem("videoai_chat_sessions") || "[]");
  let currentSessionId = null;

  chatImageBtn.addEventListener("click", () => chatImageUpload.click());
  chatImageUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      chatImageBase64 = reader.result.split(",")[1];
      chatImageBtn.textContent = "✅";
    };
    reader.readAsDataURL(file);
  });

  function saveSessions() {
    localStorage.setItem("videoai_chat_sessions", JSON.stringify(allSessions));
  }

  function createNewSession() {
    const n = {
      id: Date.now().toString(),
      title: "Nouvelle conversation",
      messages: [{ role: "assistant", content: "Bonjour ! Comment puis-je vous aider aujourd'hui ?" }],
    };
    allSessions.unshift(n);
    currentSessionId = n.id;
    saveSessions();
    renderSessions();
    renderChat();
  }

  function renderSessions() {
    sessionsList.innerHTML = "";
    allSessions.forEach((s) => {
      const div = document.createElement("div");
      div.className = `session-item ${s.id === currentSessionId ? "active" : ""}`;
      div.innerHTML = `<span>${escapeHtml(s.title)}</span><button class="session-del" data-id="${s.id}" title="Supprimer">×</button>`;
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains("session-del")) {
          e.stopPropagation();
          allSessions = allSessions.filter((x) => x.id !== e.target.dataset.id);
          if (currentSessionId === e.target.dataset.id) currentSessionId = allSessions[0]?.id || null;
          saveSessions();
          renderSessions();
          renderChat();
          return;
        }
        currentSessionId = s.id;
        renderSessions();
        renderChat();
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
        if (m.imageBase64) {
          html += `<br><img src="data:image/jpeg;base64,${m.imageBase64}" style="max-width:200px; border-radius:8px; margin-top:8px;" alt="">`;
        }
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
    chatInput.value = "";
    chatSend.disabled = true;

    s.messages.push({ role: "user", content: text, imageBase64: chatImageBase64 || undefined });
    if (s.title === "Nouvelle conversation") {
      s.title = text.slice(0, 30) + (text.length > 30 ? "…" : "");
      renderSessions();
    }
    saveSessions();
    renderChat();

    try {
      const apiMessages = s.messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: apiMessages, imageBase64: chatImageBase64 || undefined }),
      });
      const data = await res.json();
      if (data.content) {
        s.messages.push({ role: "assistant", content: data.content });
      } else if (data.error) {
        s.messages.push({ role: "assistant", content: `⚠️ Erreur : ${data.error}` });
      }
    } catch (e) {
      s.messages.push({ role: "assistant", content: "⚠️ Erreur réseau." });
    }
    saveSessions();
    renderChat();
    chatImageBase64 = null;
    chatImageBtn.textContent = "📷";
    chatSend.disabled = false;
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
    reader.onload = () => {
      imgBase64 = reader.result.split(",")[1];
      imgPreview.innerHTML = `<img src="${reader.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  });

  imgBtn.addEventListener("click", async () => {
    if (!imgPrompt.value.trim()) return;
    imgBtn.disabled = true;
    imgBtn.textContent = "Génération…";
    imgArea.hidden = true;
    try {
      const res = await apiFetch("/api/generate-image", {
        method: "POST",
        body: JSON.stringify({ prompt: imgPrompt.value, format: imgFormat.value, imageBase64: imgBase64 || undefined }),
      });
      const data = await res.json();
      if (data.url) {
        imgResult.src = data.url;
        
        imgDownload.onclick = (e) => {
          e.preventDefault();
          downloadFile(data.url, `videoai-${data.id}.jpg`, data.id);
        };
        
        imgArea.hidden = false;
        const h = JSON.parse(localStorage.getItem("videoai_image_history") || "[]");
        h.unshift({ prompt: imgPrompt.value, url: data.url, id: data.id, date: new Date().toLocaleDateString("fr-FR") });
        localStorage.setItem("videoai_image_history", JSON.stringify(h.slice(0, 20)));
        renderImageHistory();
      } else {
        alert(data.error || "Erreur image");
      }
    } catch {
      alert("Erreur réseau");
    }
    imgBtn.disabled = false;
    imgBtn.textContent = "Générer l'image";
  });

  function renderImageHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_image_history") || "[]");
    if (h.length === 0) {
      imageHistoryEl.innerHTML = "<p style='color:gray;'>Aucune image.</p>";
      return;
    }
    imageHistoryEl.innerHTML = h.map((i) => `
      <div class="history-item">
        <span class="history-prompt">${escapeHtml(i.prompt)}</span>
        <div class="history-actions">
          <a href="${i.url}" target="_blank" class="history-btn">Voir</a>
          <button class="history-btn dl-img-btn" data-url="${i.url}" data-id="${i.id}">⬇ Télécharger</button>
        </div>
      </div>`).join("");

    imageHistoryEl.querySelectorAll(".dl-img-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        downloadFile(e.target.dataset.url, `videoai-${e.target.dataset.id}.jpg`, e.target.dataset.id);
      });
    });
  }
  renderImageHistory();

  // ============================================
  // HISTORIQUES VIDÉO + STUDIO
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
    if (h.length === 0) {
      el.innerHTML = "<p style='color:gray;'>Aucune vidéo.</p>";
      return;
    }
    
    el.innerHTML = h.map((i) => `
      <div class="history-item">
        <span class="history-prompt">${escapeHtml(i.prompt)}</span>
        <div class="history-actions">
          <a href="${i.url}" target="_blank" class="history-btn">Voir</a>
          <button class="history-btn dl-vid-btn" data-url="${i.url}" data-id="${i.id}">⬇ Télécharger</button>
        </div>
      </div>`).join("");

    el.querySelectorAll(".dl-vid-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        downloadFile(e.target.dataset.url, `videoai-${e.target.dataset.id}.mp4`, e.target.dataset.id);
      });
    });
  }

  // ============================================
  // FACTORY SLOT (Vidéo & Studio)
  // ============================================
  const slotTemplate = document.getElementById("slot-template");

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

    const state = { base64: null, id: null, url: null, poll: null };

    uploadBtn.addEventListener("click", () => imgInput.click());
    imgInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        state.base64 = r.result.split(",")[1];
        uploadBtn.textContent = "✅ Image";
      };
      r.readAsDataURL(f);
    });

    function setStatus(s, txt) {
      statusEl.dataset.state = s;
      statusEl.innerHTML = `<span class="dot"></span> ${txt}`;
    }

    genBtn.addEventListener("click", async () => {
      if (!promptEl.value.trim()) return;
      if (state.poll) { clearInterval(state.poll); state.poll = null; }
      genBtn.disabled = true;
      dlBtn.disabled = true;
      player.hidden = true;
      video.src = "";
      setStatus("queued", "En file d'attente…");

      const refs = [];
      if (state.base64) refs.push(state.base64);
      
      if (context === "story") {
        const charImgs = getSharedImages();
        charImgs.forEach(img => {
          if (img && !refs.includes(img) && refs.length < 5) refs.push(img);
        });
      }

      const body = {
        prompt: promptEl.value.trim(),
        format: formatEl.value,
        duration: parseInt(durationEl.value, 10),
      };
      if (refs.length > 0) body.images = refs;

      try {
        const res = await apiFetch("/api/generate-video", {
          method: "POST",
          body: JSON.stringify(body),
        });
        
        // Sécurité Anti-Crash Safari
        const contentType = res.headers.get("content-type");
        let data;
        if (contentType && contentType.includes("application/json")) {
            data = await res.json();
        } else {
            throw new Error(`Erreur serveur (${res.status}). Veuillez réessayer.`);
        }

        if (!data.id) throw new Error(data.error || "Pas d'ID renvoyé");

        state.id = data.id;
        setStatus("loading", "Génération…");
        
        // Polling toutes les 3 secondes
        state.poll = setInterval(async () => {
          try {
            const s = await apiFetch(`/api/status/${state.id}`);
            const info = await s.json();
            
            if (info.status === "completed" && info.url) {
              clearInterval(state.poll);
              state.poll = null;
              state.url = info.url;
              video.src = info.url;
              player.hidden = false;
              dlBtn.disabled = false;
              setStatus("ready", "Prête");
              genBtn.disabled = false;
              saveToHistory(context, promptEl.value.trim(), info.url, state.id);
            } else if (info.status === "failed") {
              clearInterval(state.poll);
              state.poll = null;
              setStatus("error", "Échec");
              genBtn.disabled = false;
            }
          } catch (pollErr) {
            // On ignore les erreurs de réseau transitoires
            console.warn("Erreur polling:", pollErr);
          }
        }, 3000); 

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
  // INITIALISATION ONGLET VIDÉO
  // ============================================
  const videoSlotsContainer = document.getElementById("video-slots");
  for (let i = 0; i < 10; i++) {
    const node = slotTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `#${i + 1}`;
    videoSlotsContainer.appendChild(node);
    createSlot(node, "video");
  }
  renderHistory("video");

  // ============================================
  // INITIALISATION ONGLET STUDIO (HISTOIRE)
  // ============================================
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
      r.onload = () => {
        node._imageBase64 = r.result.split(",")[1];
        thumb.innerHTML = `<img src="${r.result}" alt="">`;
      };
      r.readAsDataURL(f);
    });

    delBtn.addEventListener("click", () => {
      node.remove();
      updateCharUI();
    });

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

})();
