(function () {
  function parseMarkdown(text) {
    if (!text) return "";
    let html = text;
    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>");

    const lines = html.split('\n');
    let inTable = false, tableHtml = '';
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (!inTable) { inTable = true; tableHtml += '<table>'; }
        if (line.includes('---')) continue;
        let cells = line.split('|').filter(c => c.trim() !== '');
        let tag = (i === 0 || lines[i-1].includes('---')) ? 'th' : 'td';
        tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      } else {
        if (inTable) { tableHtml += '</table>'; inTable = false; }
      }
    }
    if (inTable) tableHtml += '</table>';
    if (tableHtml) html = html.replace(/(\|.*\|)/g, tableHtml);
    return html.replace(/\n/g, "<br>");
  }

  const tabs = document.querySelectorAll(".tab-btn");
  const sections = document.querySelectorAll(".section");
  tabs.forEach(t => t.addEventListener("click", () => {
    tabs.forEach(b => b.classList.remove("active"));
    sections.forEach(s => s.classList.remove("active"));
    t.classList.add("active");
    document.getElementById(`section-${t.id.split("-")[1]}`).classList.add("active");
  }));

  // --- CHAT ---
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

  function saveSessions() { localStorage.setItem("videoai_chat_sessions", JSON.stringify(allSessions)); }
  
  function createNewSession() {
    const n = { id: Date.now().toString(), title: "Nouvelle conversation", messages: [{ role: "assistant", content: "Bonjour ! Comment puis-je vous aider aujourd'hui ?" }] };
    allSessions.unshift(n); currentSessionId = n.id; saveSessions(); renderSessions(); renderChat();
  }

  function renderSessions() {
    sessionsList.innerHTML = "";
    allSessions.forEach(s => {
      const div = document.createElement("div");
      div.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
      div.innerHTML = `<span>${s.title}</span><button class="session-del" data-id="${s.id}">×</button>`;
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains('session-del')) {
          allSessions = allSessions.filter(x => x.id !== e.target.dataset.id);
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
    const s = allSessions.find(x => x.id === currentSessionId);
    if (!s) return;
    s.messages.forEach(m => {
      let content = m.role === 'user' ? m.content : parseMarkdown(m.content);
      chatHistory.innerHTML += `<div class="message ${m.role === 'user' ? 'user' : 'assistant'}">${content}</div>`;
    });
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  newChatBtn.addEventListener("click", createNewSession);
  if (allSessions.length === 0) createNewSession(); else { currentSessionId = allSessions[0].id; renderSessions(); renderChat(); }

  chatSend.addEventListener("click", async () => {
    const text = chatInput.value.trim();
    if (!text || !currentSessionId) return;
    const s = allSessions.find(x => x.id === currentSessionId);
    chatInput.value = ""; chatSend.disabled = true;

    let displayHtml = text;
    if (chatImageBase64) {
        displayHtml += `<br><img src="data:image/jpeg;base64,${chatImageBase64}" style="max-width:200px; border-radius:8px; margin-top:8px;">`;
    }

    s.messages.push({ role: "user", content: displayHtml });
    if (s.title === "Nouvelle conversation") { s.title = text.slice(0, 30) + "..."; renderSessions(); }
    saveSessions(); renderChat();

    try {
      const res = await fetch("/api/chat", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ 
            messages: s.messages.map(m => ({ role: m.role, content: m.content.replace(/<br><img.*>/g, '') })), // On retire l'image du texte pour l'API
            imageBase64: chatImageBase64 
        }) 
      });
      const data = await res.json();
      if (data.content) { s.messages.push({ role: "assistant", content: data.content }); saveSessions(); renderChat(); }
    } catch (e) { alert("Erreur chat"); }
    
    chatImageBase64 = null;
    chatImageBtn.textContent = "📷";
    chatSend.disabled = false;
  });

  // --- IMAGE ---
  const imgPrompt = document.getElementById("image-prompt"), imgFormat = document.getElementById("image-format"), imgBtn = document.getElementById("image-generate"), imgArea = document.getElementById("image-result-area"), imgResult = document.getElementById("image-result"), imgDownload = document.getElementById("image-download"), imgUploadInput = document.getElementById("image-upload"), imgUploadBtn = document.getElementById("image-upload-btn"), imgPreview = document.getElementById("image-preview"), imageHistoryEl = document.getElementById("image-history");
  let imgBase64 = null;

  imgUploadBtn.addEventListener("click", () => imgUploadInput.click());
  imgUploadInput.addEventListener("change", (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { imgBase64 = reader.result.split(",")[1]; imgPreview.innerHTML = `<img src="${reader.result}">`; };
    reader.readAsDataURL(file);
  });

  imgBtn.addEventListener("click", async () => {
    if (!imgPrompt.value.trim()) return;
    imgBtn.disabled = true; imgBtn.textContent = "Génération..."; imgArea.hidden = true;
    try {
      const res = await fetch("/api/generate-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: imgPrompt.value, format: imgFormat.value, imageBase64: imgBase64 }) });
      const data = await res.json();
      if (data.url) {
        imgResult.src = data.url; imgDownload.href = `/api/download/${data.id}?url=${encodeURIComponent(data.url)}`; imgArea.hidden = false;
        const h = JSON.parse(localStorage.getItem("videoai_image_history") || "[]");
        h.unshift({ prompt: imgPrompt.value, url: data.url, id: data.id, date: new Date().toLocaleDateString("fr-FR") });
        localStorage.setItem("videoai_image_history", JSON.stringify(h.slice(0, 20)));
        renderImageHistory();
      } else alert(data.error);
    } catch (e) { alert("Erreur réseau"); }
    imgBtn.disabled = false; imgBtn.textContent = "Générer l'image";
  });

  function renderImageHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_image_history") || "[]");
    imageHistoryEl.innerHTML = h.length === 0 ? "<p style='color:gray;'>Aucune image.</p>" : h.map(i => `
      <div class="history-item"><span class="history-prompt">${i.prompt}</span><div class="history-actions">
      <a href="${i.url}" target="_blank" class="history-btn">Voir</a><a href="/api/download/${i.id}?url=${encodeURIComponent(i.url)}" class="history-btn" download>⬇ Télécharger</a></div></div>`).join("");
  }
  renderImageHistory();

  // --- VIDÉO ---
  const slotsContainer = document.getElementById("video-slots"), template = document.getElementById("slot-template"), videoHistoryEl = document.getElementById("video-history");
  for (let i = 0; i < 10; i++) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".slot-num").textContent = `#${i + 1}`; slotsContainer.appendChild(node); createSlot(node);
  }
  function createSlot(node) {
    const prompt = node.querySelector(".slot-prompt"), format = node.querySelector(".slot-format"), duration = node.querySelector(".slot-duration"), genBtn = node.querySelector(".slot-gen-btn"), dlBtn = node.querySelector(".slot-dl-btn"), status = node.querySelector(".slot-status"), player = node.querySelector(".slot-player"), video = node.querySelector("video"), uploadBtn = node.querySelector(".slot-upload-btn"), imgInput = node.querySelector(".slot-img-input");
    const state = { base64: null, id: null, poll: null };
    uploadBtn.addEventListener("click", () => imgInput.click());
    imgInput.addEventListener("change", (e) => { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = () => { state.base64 = r.result.split(",")[1]; uploadBtn.textContent = "✅ Image"; }; r.readAsDataURL(f); });
    function setS(s, txt) { status.dataset.state = s; status.innerHTML = `<span class="dot"></span> ${txt}`; }
    genBtn.addEventListener("click", async () => {
      if (!prompt.value.trim()) return; if (state.poll) clearInterval(state.poll);
      genBtn.disabled = true; dlBtn.disabled = true; player.hidden = true; setS("loading", "Génération...");
      try {
        const res = await fetch("/api/generate-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.value, format: format.value, duration: parseInt(duration.value), imageBase64: state.base64 }) });
        const data = await res.json(); if (!data.id) throw new Error(data.error);
        state.id = data.id; setS("loading", "En cours...");
        state.poll = setInterval(async () => {
          const s = await fetch(`/api/status/${state.id}`); const info = await s.json();
          if (info.status === "completed") {
            clearInterval(state.poll); video.src = info.url; player.hidden = false; dlBtn.disabled = false; setS("ready", "Prête"); genBtn.disabled = false;
            const h = JSON.parse(localStorage.getItem("videoai_video_history") || "[]");
            h.unshift({ prompt: prompt.value, url: info.url, id: state.id, date: new Date().toLocaleDateString("fr-FR") });
            localStorage.setItem("videoai_video_history", JSON.stringify(h.slice(0, 20))); renderVideoHistory();
          } else if (info.status === "failed") { clearInterval(state.poll); setS("error", "Échec"); genBtn.disabled = false; }
        }, 3000);
      } catch (e) { setS("error", "Erreur"); genBtn.disabled = false; }
    });
    dlBtn.addEventListener("click", () => { if (state.id) window.location.href = `/api/download/${state.id}`; });
  }
  function renderVideoHistory() {
    const h = JSON.parse(localStorage.getItem("videoai_video_history") || "[]");
    videoHistoryEl.innerHTML = h.length === 0 ? "<p style='color:gray;'>Aucune vidéo.</p>" : h.map(i => `
      <div class="history-item"><span class="history-prompt">${i.prompt}</span><div class="history-actions">
      <a href="${i.url}" target="_blank" class="history-btn">Voir</a><a href="/api/download/${i.id}" class="history-btn" download>⬇ Télécharger</a></div></div>`).join("");
  }
  renderVideoHistory();
})();
