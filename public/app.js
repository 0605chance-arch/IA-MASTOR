(function () {
  window.userApiKey = sessionStorage.getItem("agnes_api_key") || null;
  const lockScreen = document.getElementById("lock-screen");
  const mainApp = document.getElementById("main-app");
  const apiKeyInput = document.getElementById("api-key-input");
  const unlockBtn = document.getElementById("unlock-btn");
  const lockError = document.getElementById("lock-error");

  function checkLock() {
    if (window.userApiKey) {
      lockScreen.style.display = "none";
      mainApp.style.display = "flex";
    } else {
      lockScreen.style.display = "flex";
      mainApp.style.display = "none";
    }
  }

  unlockBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (key.length < 5) {
      lockError.textContent = "Veuillez entrer une clé API valide.";
      lockError.style.display = "block";
      return;
    }
    window.userApiKey = key;
    sessionStorage.setItem("agnes_api_key", key);
    lockError.style.display = "none";
    checkLock();
  });

  checkLock();

  async function apiFetch(endpoint, options = {}) {
    if (!window.userApiKey) throw new Error("Non autorisé");
    const headers = { "Content-Type": "application/json", ...options.headers, "x-api-key": window.userApiKey };
    const response = await fetch(endpoint, { ...options, headers });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Erreur serveur");
    }
    return response.json();
  }

  function parseMarkdown(text) {
    if (!text) return "";
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>").replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>").replace(/^## (.*$)/gim, "<h2>$1</h2>").replace(/^# (.*$)/gim, "<h1>$1</h1>");
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>");

    let lines = html.split('\n');
    let inTable = false, tableHtml = "", output = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (!inTable) { inTable = true; tableHtml = "<div class='table-responsive'><table>"; }
        if (line.match(/^\|[\s\-\|]+\|$/)) continue;
        let cells = line.split('|').filter(c => c.trim() !== '');
        let tag = (i === 0 || lines[i-1].match(/^\|[\s\-\|]+\|$/)) ? 'th' : 'td';
        tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      } else {
        if (inTable) { tableHtml += "</table></div>"; output.push(tableHtml); inTable = false; }
        output.push(line);
      }
    }
    if (inTable) { tableHtml += "</table></div>"; output.push(tableHtml); }
    html = output.join('\n').replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>").replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>");
    return html.replace(/\n/g, "<br>");
  }

  const tabs = document.querySelectorAll(".tab-btn"), sections = document.querySelectorAll(".section");
  tabs.forEach(t => t.addEventListener("click", () => {
    tabs.forEach(b => b.classList.remove("active")); sections.forEach(s => s.classList.remove("active"));
    t.classList.add("active"); document.getElementById(`section-${t.id.split("-")[1]}`).classList.add("active");
  }));

  // CHAT
  const chatHistory = document.getElementById("chat-history"), chatInput = document.getElementById("chat-input"), chatSend = document.getElementById("chat-send"), chatImageUpload = document.getElementById("chat-image-upload"), chatImageBtn = document.getElementById("chat-image-btn"), sessionsList = document.getElementById("chat-sessions-list"), newChatBtn = document.getElementById("new-chat-btn");
  let chatImageBase64 = null, allSessions = JSON.parse(localStorage.getItem("videoai_chat_sessions") || "[]"), currentSessionId = null;

  chatImageBtn.addEventListener("click", () => chatImageUpload.click());
  chatImageUpload.addEventListener("change", (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { chatImageBase64 = r.result.split(",")[1]; chatImageBtn.textContent = "✅"; }; r.readAsDataURL(f); });

  function saveSessions() { localStorage.setItem("videoai_chat_sessions", JSON.stringify(allSessions)); }
  function createNewSession() { const n = { id: Date.now().toString(), title: "Nouvelle conversation", messages: [{ role: "assistant", content: "Bonjour !" }] }; allSessions.unshift(n); currentSessionId = n.id; saveSessions(); renderSessions(); renderChat(); }
  function renderSessions() {
    sessionsList.innerHTML = "";
    allSessions.forEach(s => {
      const div = document.createElement("div"); div.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
      div.innerHTML = `<span>${s.title}</span><button class="session-del" data-id="${s.id}">×</button>`;
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains('session-del')) { allSessions = allSessions.filter(x => x.id !== e.target.dataset.id); if (currentSessionId === e.target.dataset.id) currentSessionId = allSessions[0]?.id || null; saveSessions(); renderSessions(); renderChat(); return; }
        currentSessionId = s.id; renderSessions(); renderChat();
      });
      sessionsList.appendChild(div);
    });
  }
  function renderChat() {
    chatHistory.innerHTML = ""; if (!currentSessionId) return;
    const s = allSessions.find(x => x.id === currentSessionId); if (!s) return;
    s.messages.forEach(m => { chatHistory.innerHTML += `<div class="message ${m.role === 'user' ? 'user' : 'assistant'}">${m.role === 'user' ? m.content : parseMarkdown(m.content)}</div>`; });
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
  newChatBtn.addEventListener("click", createNewSession);
  if (allSessions.length === 0) createNewSession(); else { currentSessionId = allSessions[0].id; renderSessions(); renderChat(); }

  chatSend.addEventListener("click", async () => {
    const text = chatInput.value.trim(); if (!text || !currentSessionId) return;
    const s = allSessions.find(x => x.id === currentSessionId);
    chatInput.value = ""; chatSend.disabled = true;
    let displayHtml = text;
    if (chatImageBase64) displayHtml += `<br><img src="data:image/jpeg;base64,${chatImageBase64}" style="max-width:200px; border-radius:8px;">`;
    s.messages.push({ role: "user", content: displayHtml });
    if (s.title === "Nouvelle conversation") { s.title = text.slice(0, 30); renderSessions(); }
    saveSessions(); renderChat();
    try {
      const data = await apiFetch("/api/chat", { method: "POST", body: JSON.stringify({ messages: s.messages.map(m => ({ role: m.role, content: m.content.replace(/<br><img.*>/g, '') })), imageBase64: chatImageBase64 }) });
      if (data.content) { s.messages.push({ role: "assistant", content: data.content }); saveSessions(); renderChat(); }
    } catch (e) { chatHistory.innerHTML += `<div class="message assistant" style="color:#ff453a">Erreur: ${e.message}</div>`; }
    chatImageBase64 = null; chatImageBtn.textContent = "📷"; chatSend.disabled = false;
  });

  // IMAGES
  const imgSlotsContainer = document.getElementById("image-slots"), imgTemplate = document.getElementById("img-slot-template"), imageHistoryEl = document.getElementById("image-history");
  for (let i = 0; i < 10; i++) { const node = imgTemplate.content.firstElementChild.cloneNode(true); node.querySelector(".slot-num").textContent = `Image #${i + 1}`; imgSlotsContainer.appendChild(node); setupImageSlot(node); }
  function setupImageSlot(node) {
    const prompt = node.querySelector(".img-prompt"), format = node.querySelector(".img-format"), genBtn = node.querySelector(".img-gen-btn"), dlBtn = node.querySelector(".img-dl-btn"), refInput = node.querySelector(".img-ref-input"), refBtn = node.querySelector(".img-ref-btn"), refPrev = node.querySelector(".img-ref-prev"), resArea = node.querySelector(".img-result-area"), resImg = node.querySelector(".img-result");
    let base64 = null, id = null;
    refBtn.addEventListener("click", () => refInput.click());
    refInput.addEventListener("change", (e) => { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = () => { base64 = r.result.split(",")[1]; refPrev.innerHTML = `<img src="${r.result}">`; }; r.readAsDataURL(f); });
    genBtn.addEventListener("click", async () => {
      if (!prompt.value.trim()) return;
      genBtn.disabled = true; genBtn.textContent = "Génération..."; resArea.hidden = true;
      try {
        const data = await apiFetch("/api/generate-image", { method: "POST", body: JSON.stringify({ prompt: prompt.value, format: format.value, imageBase64: base64 }) });
        if (data.url) {
          resImg.src = data.url; resArea.hidden = false; dlBtn.disabled = false; id = data.id;
          dlBtn.onclick = () => { window.location.href = `/api/download/${id}?url=${encodeURIComponent(data.url)}&apiKey=${window.userApiKey}`; };
          const h = JSON.parse(localStorage.getItem("videoai_image_history") || "[]"); h.unshift({ prompt: prompt.value, url: data.url, id: data.id }); localStorage.setItem("videoai_image_history", JSON.stringify(h)); renderImageHistory();
        }
      } catch (e) { alert(e.message); }
      genBtn.disabled = false; genBtn.textContent = "Générer l'image";
    });
  }
  function renderImageHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_image_history") || "[]");
    imageHistoryEl.innerHTML = h.map(i => `<div class="history-item"><span class="history-prompt">${i.prompt}</span><div class="history-actions"><a href="${i.url}" target="_blank" class="history-btn">Voir</a><a href="/api/download/${i.id}?url=${encodeURIComponent(i.url)}&apiKey=${window.userApiKey}" class="history-btn" download>⬇</a></div></div>`).join("");
  }
  renderImageHistory();

  // VIDÉO & HISTOIRE
  function setupVideoSlot(node, isStory = false) {
    const prompt = node.querySelector(".slot-prompt"), format = node.querySelector(".slot-format"), duration = node.querySelector(".slot-duration"), genBtn = node.querySelector(".slot-gen-btn"), dlBtn = node.querySelector(".slot-dl-btn"), status = node.querySelector(".slot-status"), player = node.querySelector(".slot-player"), video = node.querySelector("video"), uploadBtn = node.querySelector(".slot-upload-btn"), imgInput = node.querySelector(".slot-img-input");
    const state = { base64: null, id: null, poll: null };
    
    if (uploadBtn) {
      uploadBtn.addEventListener("click", () => imgInput.click());
      imgInput.addEventListener("change", (e) => { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = () => { state.base64 = r.result.split(",")[1]; uploadBtn.textContent = "✅ Image"; }; r.readAsDataURL(f); });
    }

    genBtn.addEventListener("click", async () => {
      if (!prompt.value.trim()) return; if (state.poll) clearInterval(state.poll);
      genBtn.disabled = true; dlBtn.disabled = true; player.hidden = true; status.dataset.state = "loading"; status.innerHTML = `<span class="dot"></span> Génération...`;
      
      try {
        const payload = { prompt: prompt.value, format: format.value, duration: parseInt(duration.value), imageBase64: state.base64 };
        if (isStory) { payload.storyCharacters = window.storyCharactersData || []; payload.storyContext = document.getElementById("story-synopsis").value.trim(); }

        const data = await apiFetch("/api/generate-video", { method: "POST", body: JSON.stringify(payload) });
        if (!data.id) throw new Error(data.error);
        
        state.id = data.id; status.innerHTML = `<span class="dot"></span> En cours...`;
        state.poll = setInterval(async () => {
          const info = await apiFetch(`/api/status/${state.id}`);
          if (info.status === "completed") {
            clearInterval(state.poll); video.src = info.url; player.hidden = false; dlBtn.disabled = false; status.dataset.state = "ready"; status.innerHTML = `<span class="dot"></span> Prête`; genBtn.disabled = false;
            const hKey = isStory ? "videoai_story_history" : "videoai_video_history";
            const h = JSON.parse(localStorage.getItem(hKey) || "[]"); h.unshift({ prompt: prompt.value, url: info.url, id: state.id }); localStorage.setItem(hKey, JSON.stringify(h)); 
            if(isStory) renderStoryHistory(); else renderVideoHistory();
          } else if (info.status === "failed") { clearInterval(state.poll); status.dataset.state = "error"; status.innerHTML = `<span class="dot"></span> Échec`; genBtn.disabled = false; }
        }, 3000);
      } catch (e) { status.dataset.state = "error"; status.innerHTML = `<span class="dot"></span> Erreur`; genBtn.disabled = false; }
    });
    dlBtn.addEventListener("click", () => { if (state.id) window.location.href = `/api/download/${state.id}?apiKey=${window.userApiKey}`; });
  }

  const slotsContainer = document.getElementById("video-slots"), template = document.getElementById("slot-template");
  for (let i = 0; i < 10; i++) { const node = template.content.firstElementChild.cloneNode(true); node.querySelector(".slot-num").textContent = `Vidéo #${i + 1}`; slotsContainer.appendChild(node); setupVideoSlot(node, false); }
  
  const storySlotsContainer = document.getElementById("story-slots");
  for (let i = 0; i < 10; i++) { const node = template.content.firstElementChild.cloneNode(true); node.querySelector(".slot-num").textContent = `Scène ${i + 1}`; storySlotsContainer.appendChild(node); setupVideoSlot(node, true); }

  window.storyCharactersData = []; 
  [1, 2, 3].forEach(num => {
    const nameInput = document.getElementById(`char${num}-name`), fileInput = document.getElementById(`char${num}-file`), prev = document.getElementById(`char${num}-prev`);
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        window.storyCharactersData[num - 1] = { name: nameInput.value.trim() || `Personnage ${num}`, base64: reader.result.split(",")[1] };
        prev.innerHTML = `<img src="${reader.result}">`;
      };
      reader.readAsDataURL(file);
    });
    nameInput.addEventListener("input", () => { if (window.storyCharactersData[num - 1]) window.storyCharactersData[num - 1].name = nameInput.value.trim() || `Personnage ${num}`; });
  });

  function renderVideoHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_video_history") || "[]");
    document.getElementById("video-history").innerHTML = h.map(i => `<div class="history-item"><span class="history-prompt">${i.prompt}</span><div class="history-actions"><a href="${i.url}" target="_blank" class="history-btn">Voir</a><a href="/api/download/${i.id}?apiKey=${window.userApiKey}" class="history-btn" download>⬇</a></div></div>`).join("");
  }
  
  function renderStoryHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_story_history") || "[]");
    document.getElementById("story-history").innerHTML = h.map(i => `<div class="history-item"><span class="history-prompt">${i.prompt}</span><div class="history-actions"><a href="${i.url}" target="_blank" class="history-btn">Voir</a><a href="/api/download/${i.id}?apiKey=${window.userApiKey}" class="history-btn" download>⬇</a></div></div>`).join("");
  }

  renderVideoHistory();
  renderStoryHistory();
})();
