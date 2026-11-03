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
      lockError.textContent = "Clé invalide."; 
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
    const headers = { 
      "Content-Type": "application/json", 
      ...options.headers, 
      "x-api-key": window.userApiKey 
    };
    const response = await fetch(endpoint, { ...options, headers });
    const data = await response.json().catch(()=>({}));
    
    if (!response.ok) { 
      const err = new Error(data.error || "Erreur"); 
      err.status = response.status; 
      err.code = data.code; 
      throw err; 
    }
    return data;
  }

  // --- NAVIGATION ONGLETS ---
  const tabs = document.querySelectorAll(".tab-btn");
  const sections = document.querySelectorAll(".section");
  
  tabs.forEach(t => t.addEventListener("click", () => { 
    tabs.forEach(b => b.classList.remove("active")); 
    sections.forEach(s => s.classList.remove("active")); 
    t.classList.add("active"); 
    document.getElementById(`section-${t.id.split("-")[1]}`).classList.add("active"); 
  }));

  // ==========================================
  // 1. CHAT
  // ==========================================
  const chatHistory = document.getElementById("chat-history");
  const chatInput = document.getElementById("chat-input");
  const chatSend = document.getElementById("chat-send");
  const chatImageUpload = document.getElementById("chat-image-upload");
  const chatImageBtn = document.getElementById("chat-image-btn");
  const sessionsList = document.getElementById("chat-sessions-list");
  const newChatBtn = document.getElementById("new-chat-btn");

  let chatImageBase64 = null;
  let allSessions = JSON.parse(localStorage.getItem("iamastor_chat_sessions") || "[]");
  let currentSessionId = null;

  chatImageBtn.addEventListener("click", () => chatImageUpload.click());
  
  chatImageUpload.addEventListener("change", (e) => { 
    const f = e.target.files[0]; 
    if (!f) return; 
    const r = new FileReader(); 
    r.onload = () => { 
      chatImageBase64 = r.result.split(",")[1]; 
      chatImageBtn.textContent = "✅"; 
    }; 
    r.readAsDataURL(f); 
  });

  function saveSessions() { 
    localStorage.setItem("iamastor_chat_sessions", JSON.stringify(allSessions)); 
  }
  
  function createNewSession() { 
    const n = { id: Date.now().toString(), title: "Discussion", messages: [{ role: "assistant", content: "Bonjour !" }] }; 
    allSessions.unshift(n); 
    currentSessionId = n.id; 
    saveSessions(); 
    renderSessions(); 
    renderChat(); 
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
    const s = allSessions.find(x => x.id === currentSessionId); 
    if (!s) return; 
    s.messages.forEach(m => { 
      chatHistory.innerHTML += `<div class="message ${m.role === 'user' ? 'user' : 'assistant'}">${m.role === 'user' ? m.content : m.content}</div>`; 
    }); 
    chatHistory.scrollTop = chatHistory.scrollHeight; 
  }

  newChatBtn.addEventListener("click", createNewSession);
  if (allSessions.length === 0) createNewSession(); else { currentSessionId = allSessions[0].id; renderSessions(); renderChat(); }

  chatSend.addEventListener("click", async () => { 
    const text = chatInput.value.trim(); 
    if (!text || !currentSessionId) return; 
    const s = allSessions.find(x => x.id === currentSessionId); 
    chatInput.value = ""; 
    chatSend.disabled = true; 
    s.messages.push({ role: "user", content: text }); 
    if (s.title === "Discussion") { 
      s.title = text.slice(0, 30); 
      renderSessions(); 
    } 
    saveSessions(); 
    renderChat(); 
    
    try { 
      const data = await apiFetch("/api/chat", { 
        method: "POST", 
        body: JSON.stringify({ messages: s.messages.map(m => ({ role: m.role, content: m.content })), imageBase64: chatImageBase64 }) 
      }); 
      if (data.content) { 
        s.messages.push({ role: "assistant", content: data.content }); 
        saveSessions(); 
        renderChat(); 
      } 
    } catch (e) { 
      alert(e.message); 
    } 
    chatImageBase64 = null; 
    chatImageBtn.textContent = "📷"; 
    chatSend.disabled = false; 
  });

  // ==========================================
  // 2. IMAGES
  // ==========================================
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
    const f = e.target.files[0]; 
    if(!f) return; 
    const r = new FileReader(); 
    r.onload = () => { 
      imgBase64 = r.result.split(",")[1]; 
      imgPreview.innerHTML = `<img src="${r.result}">`; 
    }; 
    r.readAsDataURL(f); 
  });

  imgBtn.addEventListener("click", async () => { 
    if (!imgPrompt.value.trim()) return; 
    imgBtn.disabled = true; 
    imgBtn.textContent = "Génération..."; 
    imgArea.hidden = true; 
    
    try { 
      const data = await apiFetch("/api/generate-image", { 
        method: "POST", 
        body: JSON.stringify({ prompt: imgPrompt.value, format: imgFormat.value, imageBase64: imgBase64 }) 
      }); 
      if (data.url) { 
        imgResult.src = data.url; 
        imgDownload.href = data.url; 
        imgDownload.download = "image.jpg"; 
        imgArea.hidden = false; 
        const h = JSON.parse(localStorage.getItem("iamastor_image_history") || "[]"); 
        h.unshift({ prompt: imgPrompt.value, url: data.url, id: data.id }); 
        localStorage.setItem("iamastor_image_history", JSON.stringify(h)); 
        renderImageHistory(); 
      } 
    } catch (e) { 
      alert(e.message); 
    } 
    imgBtn.disabled = false; 
    imgBtn.textContent = "Générer l'image"; 
  });

  function renderImageHistory() { 
    const h = JSON.parse(localStorage.getItem("iamastor_image_history") || "[]"); 
    imageHistoryEl.innerHTML = h.map(i => `<div class="history-item"><span class="history-prompt">${i.prompt}</span><div class="history-actions"><a href="${i.url}" target="_blank" class="history-btn">Voir</a><a href="${i.url}" class="history-btn" download>⬇</a></div></div>`).join(""); 
  }
  renderImageHistory();

  // ==========================================
  // 3. VIDÉO (Le système de file d'attente invisible)
  // ==========================================
  let activeVideoTasks = []; 
  let pollingInterval = null;

  function startGlobalPolling() {
    if (pollingInterval) return;
    pollingInterval = setInterval(async () => {
      if (activeVideoTasks.length === 0) { 
        clearInterval(pollingInterval); 
        pollingInterval = null; 
        return; 
      }
      const ids = activeVideoTasks.map(t => t.id);
      
      try {
        const data = await apiFetch("/api/status-batch", { 
          method: "POST", 
          body: JSON.stringify({ ids }) 
        });
        
        data.results.forEach(res => {
          const task = activeVideoTasks.find(t => t.id === res.id);
          if (task) {
             if (res.status === "completed" && res.url) { 
               task.onSuccess(res.url); 
               activeVideoTasks = activeVideoTasks.filter(t => t.id !== res.id); 
             }
             else if (res.status === "failed") { 
               task.onError(); 
               activeVideoTasks = activeVideoTasks.filter(t => t.id !== res.id); 
             }
          }
        });
      } catch (e) { 
        console.warn("Erreur polling", e);
      }
    }, 3000);
  }

  function setupSlot(node, isStory = false) {
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
    
    const state = { base64: null };

    if (uploadBtn) { 
      uploadBtn.addEventListener("click", () => imgInput.click()); 
      imgInput.addEventListener("change", (e) => { 
        const f = e.target.files[0]; 
        if(!f) return; 
        const r = new FileReader(); 
        r.onload = () => { 
          state.base64 = r.result.split(",")[1]; 
          uploadBtn.textContent = "✅ Image"; 
        }; 
        r.readAsDataURL(f); 
      }); 
    }
    
    // ⚠️ LA FAMEUSE FONCTION D'ENVOI SILENCIEUX
    const sendVideoRequest = async (attempt = 1) => {
      try {
        const payload = { prompt: prompt.value, format: format.value, duration: parseInt(duration.value), imageBase64: state.base64 };
        if (isStory) { payload.storyCharacters = window.storyCharactersData || []; }
        
        const res = await apiFetch("/api/generate-video", { method: "POST", body: JSON.stringify(payload) });
        
        // Si ça marche, on affiche "En cours..." (déjà affiché, mais on confirme)
        status.innerHTML = `<span class="dot"></span> En cours...`;
        
        activeVideoTasks.push({ 
          id: res.id, 
          onSuccess: (url) => { 
            video.src = url; 
            player.hidden = false; 
            dlBtn.disabled = false; 
            status.dataset.state = "ready"; 
            status.innerHTML = `<span class="dot"></span> Prête`; 
            genBtn.disabled = false; 
            const h = JSON.parse(localStorage.getItem("iamastor_video_history") || "[]"); 
            h.unshift({ prompt: prompt.value, url, id: res.id }); 
            localStorage.setItem("iamastor_video_history", JSON.stringify(h)); 
            renderVideoHistory(); 
          }, 
          onError: () => { 
            status.dataset.state = "error"; 
            status.innerHTML = `<span class="dot"></span> Échec`; 
            genBtn.disabled = false; 
          } 
        });
        startGlobalPolling();

      } catch (err) {
        // SI AGNES DIT "TROP DE REQUETES" (429), ON ATTEND 5 SECONDES EN SILENCE
        // Le statut reste "En cours..." sans afficher de compte à rebours (pas de "Retry dans 10s")
        if (err.status === 429 || err.code === "rate_limit") { 
          if (attempt <= 10) { 
            setTimeout(() => sendVideoRequest(attempt + 1), 5000); // Réessaie après 5s
            return; 
          }
        }
        // Vraie erreur (ex: problème de prompt)
        status.dataset.state = "error"; 
        status.innerHTML = `<span class="dot"></span> Erreur`; 
        genBtn.disabled = false;
      }
    };

    genBtn.addEventListener("click", () => { 
      if (!prompt.value.trim()) return; 
      genBtn.disabled = true; 
      dlBtn.disabled = true; 
      player.hidden = true; 
      status.dataset.state = "loading"; 
      status.innerHTML = `<span class="dot"></span> En cours...`; // Affiché instantanément au clic
      sendVideoRequest(); 
    });
    
    // Téléchargement direct via l'URL de la vidéo
    dlBtn.addEventListener("click", () => { 
      if (video.src) window.open(video.src, '_blank'); 
    });
  }

  // --- INITIALISATION DES 10 SLOTS VIDÉO ---
  const slotsContainer = document.getElementById("video-slots");
  const template = document.getElementById("slot-template");
  for (let i = 0; i < 10; i++) { 
    const node = template.content.firstElementChild.cloneNode(true); 
    node.querySelector(".slot-num").textContent = `Vidéo #${i + 1}`; 
    slotsContainer.appendChild(node); 
    setupSlot(node, false); 
  }
  
  // --- INITIALISATION DES 10 SCÈNES HISTOIRE ---
  const storySlotsContainer = document.getElementById("story-slots");
  for (let i = 0; i < 10; i++) { 
    const node = template.content.firstElementChild.cloneNode(true); 
    node.querySelector(".slot-num").textContent = `Scène ${i + 1}`; 
    storySlotsContainer.appendChild(node); 
    setupSlot(node, true); 
  }

  // --- GESTION DES PERSONNAGES (HISTOIRE) ---
  window.storyCharactersData = []; 
  [1, 2, 3].forEach(num => { 
    const nameInput = document.getElementById(`char${num}-name`); 
    const fileInput = document.getElementById(`char${num}-file`); 
    const prev = document.getElementById(`char${num}-prev`); 
    if(fileInput) {
      fileInput.addEventListener("change", (e) => { 
        const file = e.target.files[0]; 
        if (!file) return; 
        const reader = new FileReader(); 
        reader.onload = () => { 
          window.storyCharactersData[num - 1] = { name: nameInput.value.trim() || `Perso ${num}`, img: reader.result.split(",")[1] }; 
          prev.innerHTML = `<img src="${reader.result}">`; 
        }; 
        reader.readAsDataURL(file); 
      }); 
    }
  });

  // --- HISTORIQUE VIDÉO ---
  function renderVideoHistory() { 
    const h = JSON.parse(localStorage.getItem("iamastor_video_history") || "[]"); 
    document.getElementById("video-history").innerHTML = h.map(i => `<div class="history-item"><span class="history-prompt">${i.prompt}</span><div class="history-actions"><a href="${i.url}" target="_blank" class="history-btn">Voir</a><a href="${i.url}" class="history-btn" download>⬇</a></div></div>`).join(""); 
  }
  renderVideoHistory();

  // --- BOUTON CHANGER DE CLÉ ---
  document.getElementById('change-key-btn').onclick = () => { 
    if(confirm("Voulez-vous vraiment changer de clé API ? L'historique restera sauvegardé.")) { 
      sessionStorage.removeItem("agnes_api_key"); 
      window.location.reload(); 
    } 
  };

})();
