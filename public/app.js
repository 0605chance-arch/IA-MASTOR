// ==========================================
  // ONGLET CHAT (Historique + Message de bienvenue)
  // ==========================================
  function createNewChat(initialMessage = null) {
    const c = { id: Date.now().toString(), title: 'Nouvelle discussion', messages: [] };
    if (initialMessage) c.messages.push({ role: 'assistant', content: initialMessage });
    state.chatSessions.unshift(c);
    state.currentChatId = c.id;
    renderChatList();
    renderChatMessages();
    save();
  }

  function renderChatList() {
    const l = $('#chat-history-list');
    if (!l) return;
    l.innerHTML = state.chatSessions.map(s => `
      <div class="history-chip ${s.id === state.currentChatId ? 'active' : ''}" data-id="${s.id}">
        ${s.title.length > 20 ? s.title.substring(0,20)+'...' : s.title}
      </div>
    `).join('');
    l.querySelectorAll('.history-chip').forEach(el => {
      el.onclick = () => {
        state.currentChatId = el.dataset.id;
        renderChatList();
        renderChatMessages();
      };
    });
  }

  function renderChatMessages() {
    const box = $('#chat-messages');
    const sess = state.chatSessions.find(s => s.id === state.currentChatId);
    if (!box || !sess) return;
    
    box.innerHTML = '';
    sess.messages.forEach(m => {
      const div = document.createElement('div');
      div.className = `msg ${m.role}`;
      let content = typeof m.content === 'string' ? m.content : '';
      if (Array.isArray(m.content)) {
        m.content.forEach(c => {
          if (c.type === 'text') content += c.text;
          if (c.type === 'image_url') content = `<img src="${c.image_url.url}">` + content;
        });
      }
      div.innerHTML = content.replace(/\n/g, '<br>');
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat(text) {
    const sess = state.chatSessions.find(s => s.id === state.currentChatId); 
    if (!sess) return;

    let content = text;
    if (state.chatImageBase64) {
      content = [{ type: 'text', text: text }, { type: 'image_url', image_url: { url: state.chatImageBase64 } }];
    }
    sess.messages.push({ role: 'user', content });
    state.chatImageBase64 = null;
    $('#chat-input').placeholder = 'Message...';
    if (sess.title === 'Nouvelle discussion') sess.title = text.substring(0, 20);
    
    renderChatList();
    renderChatMessages();
    
    const box = $('#chat-messages');
    const placeholder = document.createElement('div');
    placeholder.className = 'msg assistant';
    placeholder.textContent = '...';
    box.appendChild(placeholder);

    try {
      const res = await api('/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: sess.messages.slice(-15), stream: true })
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const p = JSON.parse(data);
              const delta = p.choices?.[0]?.delta?.content || '';
              if (delta) {
                full += delta;
                placeholder.innerHTML = full.replace(/\n/g, '<br>');
                box.scrollTop = box.scrollHeight;
              }
            } catch(e) {}
          }
        }
      }
      sess.messages.push({ role: 'assistant', content: full });
      save();
    } catch(err) {
      placeholder.textContent = `❌ ${err.message}`;
    }
  }

  // ==========================================
  // INITIALISATION & ÉVÉNEMENTS
  // ==========================================
  function setupEvents() {
    
    // 1. Validation de la clé
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const key = $('#api-key').value.trim();
      const btn = e.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Connexion...';
      
      try {
        const res = await fetch('/api/validate-key', { 
          method: 'POST', 
          headers: { 'Authorization': `Bearer ${key}` } 
        });
        const data = await res.json();
        
        if (!res.ok || !data.valid) throw new Error();
        
        state.apiKey = key;
        $('#welcome').classList.add('hidden');
        $('#app').classList.remove('hidden');
        
        // --- INITIALISATION DES SCÈNES PAR DÉFAUT ---
        if (!state.imageScenes || state.imageScenes.length === 0) state.imageScenes = [{ prompt: '', size: '2K', ratio: '16:9', status: 'pending' }];
        if (!state.videoScenes || state.videoScenes.length === 0) state.videoScenes = [{ prompt: '', seconds: '8', ratio: '9:16', size: '720P', status: 'pending' }];
        if (!state.storyScenes || state.storyScenes.length === 0) state.storyScenes = [{ prompt: '', seconds: '8', ratio: '9:16', size: '720P', status: 'pending' }];
        
        renderImages('image-scenes', state.imageScenes, 'image');
        renderVideos('video-scenes', state.videoScenes, 'video');
        renderStory('story-scenes', state.storyScenes, 'story');

        // --- INITIALISATION DU CHAT (MESSAGE DE BIENVENUE) ---
        if (state.chatSessions.length === 0) {
          const welcomeMsg = `Bienvenue sur IA MASTOR 🚀\n\nJe suis ton mentor créatif propulsé par Agnes AI. Voici comment je peux t'aider à percer :\n\n💬 **Chat** : Générer des idées, écrire des scripts, brainstormer.\n🖼️ **Image** : Créer des visuels uniques (jusqu'en 4K) ou modifier des photos.\n🎬 **Vidéo** : Transformer tes textes en vidéos virales (format TikTok/Shorts).\n📖 **Histoire** : Écrire et storyboarder des récits complets avec cohérence.\n\n*Conseil de mentor : La régularité est la clé. Commence par générer 1 vidéo par jour sur un sujet qui te passionne, puis analyse ce qui fonctionne.*`;
          createNewChat(welcomeMsg);
        } else { 
          renderChatList(); 
          renderChatMessages(); 
        }
        
        save();

      } catch(err) {
        $('#login-error').textContent = 'Clé invalide';
        btn.disabled = false; btn.textContent = 'Démarrer';
      }
    };

    // 2. Navigation (Onglets)
    $$('.nav-btn, .mob-btn').forEach(b => {
      b.onclick = () => {
        $$('.nav-btn, .mob-btn').forEach(x => x.classList.remove('active'));
        $$(`[data-tab="${b.dataset.tab}"]`).forEach(x => x.classList.add('active'));
        $$('.tab').forEach(t => t.classList.remove('active'));
        $(`#tab-${b.dataset.tab}`).classList.add('active');
      };
    });

    // 3. Chat
    $('#new-chat-btn').onclick = () => createNewChat();
    $('#chat-form').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#chat-input').value.trim();
      if (!v) return;
      $('#chat-input').value = '';
      sendChat(v);
    };
    $('#chat-file-btn').onclick = () => $('#chat-file').click();
    $('#chat-file').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => { state.chatImageBase64 = ev.target.result; $('#chat-input').placeholder = '📷 Image jointe'; };
      r.readAsDataURL(f);
    };

    // 4. Image
    $('#add-image-prompt').onclick = () => {
      state.imageScenes.push({ prompt: '', size: '2K', ratio: '16:9', status: 'pending' });
      renderImages('image-scenes', state.imageScenes, 'image');
      save();
    };

    // 5. Vidéo
    $('#add-scene-video').onclick = () => {
      state.videoScenes.push({ prompt: '', seconds: '8', ratio: '9:16', size: '720P', status: 'pending' });
      renderVideos('video-scenes', state.videoScenes, 'video');
      save();
    };

    // 6. Histoire
    $('#add-story-scene').onclick = () => {
      state.storyScenes.push({ prompt: '', seconds: '8', ratio: '9:16', size: '720P', status: 'pending' });
      renderStory('story-scenes', state.storyScenes, 'story');
      save();
    };
    
    // Sauvegarde des champs de l'histoire
    $('#story-synopsis').oninput = e => { save(); };
    
    // Noms et photos des personnages
    $$('.char-row input[type="text"]').forEach((el, i) => {
      el.oninput = e => { state.storyChars[i].name = e.target.value; save(); };
    });
    $$('.char-row input[type="file"]').forEach((el, i) => {
      el.onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = (ev) => { 
          state.storyChars[i].img = ev.target.result; 
          renderStory('story-scenes', state.storyScenes, 'story'); 
          save(); 
        };
        r.readAsDataURL(f);
      };
    });
  }

  // ==========================================
  // LANCEMENT DE L'APP
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    load();
    setupEvents();
  });

})();
