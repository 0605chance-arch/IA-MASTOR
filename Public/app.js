(function () {
  "use strict";

  // ============================================
  // CONSTANTES GLOBALES
  // ============================================
  const KEY_STORAGE = "videoai_api_key";
  const MAX_CONCURRENT_SUBMIT = 2;
  const SUBMIT_GAP_MS = 700;
  const POLL_INTERVAL_MS = 4000;
  const MAX_SUBMIT_RETRIES = 3;
  const MAX_CHARS = 5;
  const MAX_SCENES = 10;

  // ============================================
  // HELPERS
  // ============================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getApiKey() {
    return sessionStorage.getItem(KEY_STORAGE) || "";
  }
  function setApiKey(k) {
    if (k) sessionStorage.setItem(KEY_STORAGE, k);
    else sessionStorage.removeItem(KEY_STORAGE);
  }

  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const key = getApiKey();
    if (key) headers["X-API-Key"] = key;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      // clé invalide → rouvrir modal
      openApiModal(true);
      throw new Error("Clé API invalide ou expirée");
    }
    return res;
  }

  function escapeHtml(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Markdown parser (corrigé)
  function parseMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Headings
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");
    // Bold / italic
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    // Listes
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");

    // Tables (parsing ligne par ligne, propre)
    const lines = html.split("\n");
    const out = [];
    let inTable = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isTableRow = line.startsWith("|") && line.endsWith("|");
      if (isTableRow) {
        if (line.includes("---")) continue; // séparateur
        if (!inTable) {
          out.push("<table>");
          inTable = true;
          const cells = line.split("|").slice(1, -1);
          out.push("<tr>" + cells.map((c) => `<th>${c.trim()}</th>`).join("") + "</tr>");
        } else {
          const cells = line.split("|").slice(1, -1);
          out.push("<tr>" + cells.map((c) => `<td>${c.trim()}</td>`).join("") + "</tr>");
        }
      } else {
        if (inTable) {
          out.push("</table>");
          inTable = false;
        }
        out.push(lines[i]);
      }
    }
    if (inTable) out.push("</table>");
    html = out.join("\n");

    return html.replace(/\n/g, "<br>");
  }

  // ============================================
  // API KEY MODAL
  // ============================================
  const apiModal = document.getElementById("api-modal");
  const apiInput = document.getElementById("api-key-input");
  const apiSave = document.getElementById("api-key-save");
  const apiStatus = document.getElementById("api-key-status");
  const apiBtn = document.getElementById("api-key-btn");
  const apiDot = document.getElementById("api-dot");

  function openApiModal(force = false) {
    apiModal.hidden = false;
    apiInput.value = force ? "" : getApiKey();
    apiInput.focus();
    apiStatus.textContent = "";
    apiStatus.className = "api-status";
  }
  function closeApiModal() {
    apiModal.hidden = true;
  }
  function markApi(valid) {
    apiDot.style.background = valid ? "#30d158" : "#ff453a";
    apiBtn.title = valid ? "Clé API active" : "Clé API non configurée";
  }

  async function validateKey(key) {
    const res = await fetch("/api/health", {
      method: "POST",
      headers: { "X-API-Key": key },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.valid, error: data.error };
  }

  apiSave.addEventListener("click", async () => {
    const key = apiInput.value.trim();
    if (!key) {
      apiStatus.textContent = "Entrez une clé.";
      apiStatus.className = "api-status error";
      return;
    }
    apiSave.disabled = true;
    apiSave.textContent = "Validation…";
    apiStatus.textContent = "";
    try {
      const { ok, error } = await validateKey(key);
      if (ok) {
        setApiKey(key);
        markApi(true);
        apiStatus.textContent = "✅ Clé valide.";
        apiStatus.className = "api-status success";
        await sleep(400);
        closeApiModal();
        onApiReady();
      } else {
        apiStatus.textContent = "❌ " + (error || "Clé refusée.");
        apiStatus.className = "api-status error";
        markApi(false);
      }
    } catch (e) {
      apiStatus.textContent = "❌ " + e.message;
      apiStatus.className = "api-status error";
    } finally {
      apiSave.disabled = false;
      apiSave.textContent = "Valider & continuer";
    }
  });

  apiInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") apiSave.click();
  });

  apiBtn.addEventListener("click", () => openApiModal(false));

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
      const id = t.id.split("-")[1];
      const sec = document.getElementById(`section-${id}`);
      if (sec) sec.classList.add("active");
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
  let allSessions = [];
  let currentSessionId = null;

  try {
    allSessions = JSON.parse(localStorage.getItem("videoai_chat_sessions") || "[]");
  } catch {
    allSessions = [];
  }

  // Migration ancien format (<img> dans content)
  allSessions.forEach((s) =>
    (s.messages || []).forEach((m) => {
      if (m.role === "user" && typeof m.content === "string" && m.content.includes("<img")) {
        const mt = m.content.match(/<img src="data:image\/jpeg;base64,([^"]+)"/);
        if (mt) m.imageBase64 = mt[1];
        m.content = m.content.replace(/<br><img.*?>/g, "").trim();
      }
    })
  );

  chatImageBtn.addEventListener("click", () => chatImageUpload.click());
  chatImageUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      chatImageBase64 = String(reader.result).split(",")[1];
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
      div.innerHTML = `<span>${escapeHtml(s.title)}</span><button class="session-del" data-id="${s.id}">×</button>`;
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains("session-del")) {
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
      let html =
        m.role === "user" ? escapeHtml(m.content).replace(/\n/g, "<br>") : parseMarkdown(m.content);
      if (m.imageBase64) {
        html += `<br><img src="data:image/jpeg;base64,${m.imageBase64}" style="max-width:200px; border-radius:8px; margin-top:8px;">`;
      }
      chatHistory.innerHTML += `<div class="message ${m.role === "user" ? "user" : "assistant"}">${html}</div>`;
    });
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  newChatBtn.addEventListener("click", createNewSession);

  chatSend.addEventListener("click", async () => {
    const text = chatInput.value.trim();
    if (!text || !currentSessionId) return;
    const s = allSessions.find((x) => x.id === currentSessionId);
    chatInput.value = "";
    chatSend.disabled = true;

    const msg = { role: "user", content: text };
    if (chatImageBase64) msg.imageBase64 = chatImageBase64;
    s.messages.push(msg);

    if (s.title === "Nouvelle conversation") {
      s.title = text.slice(0, 30) + (text.length > 30 ? "…" : "");
      renderSessions();
    }
    saveSessions();
    renderChat();

    try {
      const messagesForApi = s.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesForApi,
          imageBase64: chatImageBase64 || undefined,
        }),
      });
      const data = await res.json();
      if (data.content) {
        s.messages.push({ role: "assistant", content: data.content });
        saveSessions();
        renderChat();
      }
    } catch (e) {
      console.error(e);
      alert("Erreur chat : " + e.message);
    }

    chatImageBase64 = null;
    chatImageBtn.textContent = "📷";
    chatSend.disabled = false;
  });

  // Entrée pour envoyer
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatSend.click();
    }
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
      imgBase64 = String(reader.result).split(",")[1];
      imgPreview.innerHTML = `<img src="${reader.result}">`;
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imgPrompt.value,
          format: imgFormat.value,
          imageBase64: imgBase64 || undefined,
        }),
      });
      const data = await res.json();
      if (data.url) {
        imgResult.src = data.url;
        imgDownload.href = `/api/download/${data.id}?url=${encodeURIComponent(data.url)}`;
        imgArea.hidden = false;
        const h = JSON.parse(localStorage.getItem("videoai_image_history") || "[]");
        h.unshift({
          prompt: imgPrompt.value,
          url: data.url,
          id: data.id,
          date: new Date().toLocaleDateString("fr-FR"),
        });
        localStorage.setItem("videoai_image_history", JSON.stringify(h.slice(0, 20)));
        renderImageHistory();
      } else {
        alert(data.error || "Erreur");
      }
    } catch (e) {
      alert("Erreur réseau : " + e.message);
    }
    imgBtn.disabled = false;
    imgBtn.textContent = "Générer l'image";
  });

  function renderImageHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_image_history") || "[]");
    imageHistoryEl.innerHTML =
      h.length === 0
        ? "<p style='color:gray;'>Aucune image.</p>"
        : h
            .map(
              (i) => `
      <div class="history-item">
        <span class="history-prompt">${escapeHtml(i.prompt)}</span>
        <div class="history-actions">
          <a href="${i.url}" target="_blank" class="history-btn">Voir</a>
          <a href="/api/download/${i.id}?url=${encodeURIComponent(i.url)}" class="history-btn" download>⬇ Télécharger</a>
        </div>
      </div>`
            )
            .join("");
  }
  renderImageHistory();

  // ============================================
  // FILE D'ATTENTE VIDÉO (rate-limit aware)
  // ============================================
  class VideoQueue {
    constructor(concurrency = MAX_CONCURRENT_SUBMIT, gap = SUBMIT_GAP_MS) {
      this.concurrency = concurrency;
      this.gap = gap;
      this.running = 0;
      this.queue = [];
    }
    add(task) {
      return new Promise((resolve, reject) => {
        this.queue.push({ task, resolve, reject });
        this._next();
      });
    }
    async _next() {
      if (this.running >= this.concurrency || this.queue.length === 0) return;
      this.running++;
      const { task, resolve, reject } = this.queue.shift();
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      } finally {
        this.running--;
        setTimeout(() => this._next(), this.gap);
      }
    }
  }
  const videoQueue = new VideoQueue();

  async function submitVideo(payload) {
    // Wrapper avec retry exponentiel sur 429
    for (let attempt = 0; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
      const res = await apiFetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 429 && attempt < MAX_SUBMIT_RETRIES) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur vidéo");
      return data;
    }
    throw new Error("Trop de requêtes — réessayez dans quelques instants.");
  }

  // ============================================
  // SLOT VIDÉO / SCÈNE HISTOIRE (générique)
  // ============================================
  function createSlot(node, config) {
    // config = { containerId, getAutoRefs }
    const prompt = node.querySelector(".slot-prompt");
    const format = node.querySelector(".slot-format");
    const duration = node.querySelector(".slot-duration");
    const genBtn = node.querySelector(".slot-gen-btn");
    const dlBtn = node.querySelector(".slot-dl-btn");
    const status = node.querySelector(".slot-status");
    const player = node.querySelector(".slot-player");
    const video = node.querySelector("video");
    const uploadBtn = node.querySelector(".slot-upload-btn");
    const imgInput = node.querySelector(".slot-img-input");

    const state = { base64: null, id: null, url: null, poll: null, seed: null, busy: false };

    uploadBtn.addEventListener("click", () => imgInput.click());
    imgInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        state.base64 = String(r.result).split(",")[1];
        uploadBtn.textContent = "✅ Image";
      };
      r.readAsDataURL(f);
    });

    function setStatus(s, txt) {
      status.dataset.state = s;
      status.innerHTML = `<span class="dot"></span> ${txt}`;
    }

    async function startGeneration() {
      if (!prompt.value.trim()) return;
      if (state.busy) return;
      state.busy = true;
      if (state.poll) clearInterval(state.poll);
      genBtn.disabled = true;
      dlBtn.disabled = true;
      player.hidden = true;
      video.removeAttribute("src");
      setStatus("loading", "En file…");

      const autoRefs = config.getAutoRefs ? config.getAutoRefs() : [];
      const refs = state.base64 ? [state.base64] : autoRefs;

      const payload = {
        prompt: prompt.value,
        format: format.value,
        duration: parseInt(duration.value),
      };
      if (refs && refs.length > 0) payload.images = refs;

      try {
        const data = await videoQueue.add(() => {
          setStatus("loading", "Envoi…");
          return submitVideo(payload);
        });
        if (!data.id) throw new Error(data.error || "Pas d'ID vidéo");
        state.id = data.id;
        state.seed = data.seed;
        setStatus("loading", "Rendu en cours…");

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
              state.busy = false;
              const h = JSON.parse(localStorage.getItem("videoai_video_history") || "[]");
              h.unshift({
                prompt: prompt.value,
                url: info.url,
                id: state.id,
                date: new Date().toLocaleDateString("fr-FR"),
              });
              localStorage.setItem("videoai_video_history", JSON.stringify(h.slice(0, 30)));
              renderVideoHistory();
            } else if (info.status === "failed") {
              clearInterval(state.poll);
              state.poll = null;
              setStatus("error", "Échec");
              genBtn.disabled = false;
              state.busy = false;
            }
          } catch (err) {
            console.error("poll err", err);
          }
        }, POLL_INTERVAL_MS);
      } catch (e) {
        setStatus("error", e.message || "Erreur");
        genBtn.disabled = false;
        state.busy = false;
      }
    }

    genBtn.addEventListener("click", startGeneration);
    dlBtn.addEventListener("click", () => {
      if (state.id) window.location.href = `/api/download/${state.id}`;
    });

    // expose pour "générer tout"
    return { startGeneration, getState: () => state };
  }

  // ============================================
  // VIDÉO (10 slots)
  // ============================================
  const slotsContainer = document.getElementById("video-slots");
  const template = document.getElementById("slot-template");
  const videoHistoryEl = document.getElementById("video-history");

  const videoSlotControllers = [];
  for (let i = 0; i < 10; i++) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `#${i + 1}`;
    slotsContainer.appendChild(node);
    videoSlotControllers.push(
      createSlot(node, { containerId: "video-slots", getAutoRefs: () => [] })
    );
  }

  function renderVideoHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_video_history") || "[]");
    videoHistoryEl.innerHTML =
      h.length === 0
        ? "<p style='color:gray;'>Aucune vidéo.</p>"
        : h
            .map(
              (i) => `
      <div class="history-item">
        <span class="history-prompt">${escapeHtml(i.prompt)}</span>
        <div class="history-actions">
          <a href="${i.url}" target="_blank" class="history-btn">Voir</a>
          <a href="/api/download/${i.id}" class="history-btn" download>⬇ Télécharger</a>
        </div>
      </div>`
            )
            .join("");
  }
  renderVideoHistory();

  // ============================================
  // HISTOIRE — synopsis + 5 personnages
  // ============================================
  const storySynopsis = document.getElementById("story-synopsis");
  const storyChars = document.getElementById("story-characters");
  const charTemplate = document.getElementById("char-template");
  const charCountEl = document.getElementById("char-count");
  const storyGenPrompts = document.getElementById("story-gen-prompts");
  const storyGenStatus = document.getElementById("story-gen-status");
  const storySlots = document.getElementById("story-slots");
  const storyClearBtn = document.getElementById("story-clear");

  // État des personnages
  const characters = []; // { name, description, imageBase64 }

  function updateCharCount() {
    charCountEl.textContent = `${characters.length} / ${MAX_CHARS}`;
  }

  function addCharacter() {
    if (characters.length >= MAX_CHARS) return;
    const index = characters.length;
    const node = charTemplate.content.firstElementChild.cloneNode(true);
    const imgInput = node.querySelector(".char-img-input");
    const thumb = node.querySelector(".char-thumb");
    const nameIn = node.querySelector(".char-name");
    const descIn = node.querySelector(".char-desc");
    const delBtn = node.querySelector(".char-del");

    const charData = { name: "", description: "", imageBase64: null };
    characters.push(charData);

    thumb.addEventListener("click", () => imgInput.click());
    imgInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        charData.imageBase64 = String(r.result).split(",")[1];
        thumb.innerHTML = `<img src="${r.result}" alt="">`;
        thumb.classList.add("has-image");
      };
      r.readAsDataURL(f);
    });

    nameIn.addEventListener("input", () => (charData.name = nameIn.value));
    descIn.addEventListener("input", () => (charData.description = descIn.value));

    delBtn.addEventListener("click", () => {
      const idx = characters.indexOf(charData);
      if (idx >= 0) characters.splice(idx, 1);
      node.remove();
      updateCharCount();
      // Réajouter le bouton "+" si place libre
      if (characters.length < MAX_CHARS && !storyChars.querySelector(".char-add-btn")) {
        addAddButton();
      }
    });

    storyChars.appendChild(node);
    updateCharCount();

    // retirer le bouton "+" si on a atteint la limite
    if (characters.length >= MAX_CHARS) {
      const addBtn = storyChars.querySelector(".char-add-btn");
      if (addBtn) addBtn.remove();
    }
  }

  function addAddButton() {
    if (storyChars.querySelector(".char-add-btn")) return;
    if (characters.length >= MAX_CHARS) return;
    const btn = document.createElement("button");
    btn.className = "char-add-btn btn-secondary";
    btn.textContent = "+ Ajouter un personnage";
    btn.addEventListener("click", () => {
      addCharacter();
      if (characters.length >= MAX_CHARS) btn.remove();
    });
    storyChars.appendChild(btn);
  }

  function resetCharacters() {
    characters.length = 0;
    storyChars.innerHTML = "";
    updateCharCount();
    addAddButton();
  }

  resetCharacters();

  // Stockage des scènes histoire (pour "générer tout")
  const storySlotControllers = [];

  function clearStorySlots() {
    storySlotControllers.forEach((c) => {
      const s = c.getState();
      if (s.poll) clearInterval(s.poll);
    });
    storySlotControllers.length = 0;
    storySlots.innerHTML = "";
    storyClearBtn.hidden = true;
  }

  async function generateStoryPrompts() {
    const synopsis = storySynopsis.value.trim();
    if (!synopsis) {
      storyGenStatus.textContent = "⚠️ Entrez d'abord un synopsis.";
      storyGenStatus.className = "story-status error";
      return;
    }
    storyGenPrompts.disabled = true;
    const oldText = storyGenPrompts.textContent;
    storyGenPrompts.textContent = "⏳ L'IA écrit les scènes…";
    storyGenStatus.textContent = "";
    storyGenStatus.className = "story-status";

    // Préparer personnages pour l'API
    const payloadChars = characters
      .filter((c) => c.name || c.description || c.imageBase64)
      .map((c) => ({
        name: c.name,
        description: c.description,
        imageBase64: c.imageBase64,
      }));

    try {
      const res = await apiFetch("/api/story/generate-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ synopsis, characters: payloadChars }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur story");

      const prompts = (data.prompts || []).slice(0, MAX_SCENES);
      if (prompts.length === 0) throw new Error("Aucune scène reçue");

      // Nettoyer puis créer les slots
      clearStorySlots();

      // Auto-refs = les images de personnages
      const autoRefs = characters
        .map((c) => c.imageBase64)
        .filter(Boolean);

      prompts.forEach((p, i) => {
        const node = template.content.firstElementChild.cloneNode(true);
        node.querySelector(".slot-num").textContent = `Scène ${i + 1}`;
        const ta = node.querySelector(".slot-prompt");
        ta.value = p;
        storySlots.appendChild(node);
        const ctrl = createSlot(node, {
          containerId: "story-slots",
          getAutoRefs: () => autoRefs,
        });
        storySlotControllers.push(ctrl);
      });

      storyClearBtn.hidden = false;
      storyGenStatus.textContent = `✅ ${prompts.length} scène(s) prêtes. Génération avec vos références personnages.`;
      storyGenStatus.className = "story-status success";

      // Ajouter bouton "Générer tout"
      injectGenerateAllButton();
    } catch (e) {
      storyGenStatus.textContent = "❌ " + (e.message || "Erreur");
      storyGenStatus.className = "story-status error";
    } finally {
      storyGenPrompts.disabled = false;
      storyGenPrompts.textContent = oldText;
    }
  }

  function injectGenerateAllButton() {
    // supprimer ancien
    const old = document.getElementById("story-gen-all");
    if (old) old.remove();
    if (storySlotControllers.length === 0) return;

    const btn = document.createElement("button");
    btn.id = "story-gen-all";
    btn.className = "btn-primary";
    btn.style.margin = "12px 0";
    btn.textContent = "🎬 Générer les 10 scènes (file d'attente rapide)";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "⏳ Envoi groupé en cours…";
      storySlotControllers.forEach((c) => c.startGeneration());
      // Attente visuelle
      await sleep(2000);
      btn.textContent = "✅ Générations lancées";
    });
    storySlots.parentNode.insertBefore(btn, storySlots);
  }

  storyGenPrompts.addEventListener("click", generateStoryPrompts);
  storyClearBtn.addEventListener("click", () => {
    if (confirm("Effacer toutes les scènes générées ?")) {
      clearStorySlots();
      const g = document.getElementById("story-gen-all");
      if (g) g.remove();
    }
  });

  // ============================================
  // HISTOIRE — bibliothèque
  // ============================================
  const storyHistoryEl = document.getElementById("story-history");
  function renderStoryHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_story_history") || "[]");
    storyHistoryEl.innerHTML =
      h.length === 0
        ? "<p style='color:gray;'>Aucune vidéo d'histoire.</p>"
        : h
            .map(
              (i) => `
      <div class="history-item">
        <span class="history-prompt">${escapeHtml(i.prompt)}</span>
        <div class="history-actions">
          <a href="${i.url}" target="_blank" class="history-btn">Voir</a>
          <a href="/api/download/${i.id}" class="history-btn" download>⬇ Télécharger</a>
        </div>
      </div>`
            )
            .join("");
  }
  renderStoryHistory();

  // Note : les scènes générées vont dans videoai_video_history pour l'instant.
  // On peut aussi les dupliquer dans story_history si tu veux (à activer côté serveur).

  // ============================================
  // BOOT
  // ============================================
  function onApiReady() {
    // Charger l'état initial du chat
    if (allSessions.length === 0) createNewSession();
    else {
      currentSessionId = allSessions[0].id;
      renderSessions();
      renderChat();
    }
  }

  (async function boot() {
    const key = getApiKey();
    if (!key) {
      markApi(false);
      openApiModal(true);
      return;
    }
    // Valider silencieusement
    try {
      const { ok } = await validateKey(key);
      markApi(ok);
      if (!ok) {
        openApiModal(true);
        return;
      }
      onApiReady();
    } catch {
      markApi(false);
      openApiModal(true);
    }
  })();

  // Exposer pour debug
  window.__videoai = {
    videoSlotControllers,
    storySlotControllers,
    characters,
  };
})();
