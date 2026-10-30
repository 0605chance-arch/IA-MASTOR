(function () {
  'use strict';

  // ============================================================
  // ÉTAT GLOBAL & SAUVEGARDE LOCALE (localStorage)
  // ============================================================
  const state = {
    apiKey: null,
    currentTab: 'chat',
    chatSessions: [], 
    currentChatId: null,
    imageHistory: [],
    videoHistory: [],
    storyMessages: [],
    storyState: { synopsis: '', characters: [{name:''},{name:''},{name:''}], prompts: [], theme: null },
    isLoading: false
  };

  function loadState() {
    try {
      const saved = localStorage.getItem('ia_mastor_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        state.chatSessions = parsed.chatSessions || [];
        state.imageHistory = parsed.imageHistory || [];
        state.videoHistory = parsed.videoHistory || [];
        state.storyMessages = parsed.storyMessages || [];
        state.storyState = parsed.storyState || state.storyState;
      }
    } catch (e) { console.warn('Erreur chargement localStorage', e); }
  }

  function saveState() {
    try {
      localStorage.setItem('ia_mastor_state', JSON.stringify({
        chatSessions: state.chatSessions,
        imageHistory: state.imageHistory.slice(0, 20), // max 20 pour pas saturer
        videoHistory: state.videoHistory.slice(0, 10),
        storyMessages: state.storyMessages.slice(-30), // garde les 30 derniers messages
        storyState: state.storyState
      }));
    } catch (e) { console.warn('Erreur sauvegarde localStorage', e); }
  }

  const STORY_THEMES = [
    'Histoires de fruits IA (Fruit Story)', 'Business automatisé avec l\'IA', 'UGC IA et influenceurs virtuels',
    'Luxe, richesse et vie de millionnaire', 'Couples toxiques et trahisons', 'Animaux humanisés et histoires virales',
    'Influenceurs IA et célébrité virtuelle', 'Transformation avant / après avec l\'IA', 'Histoires Reddit et secrets inavouables',
    'Mini-séries dramatiques TikTok', 'Streetwear, sneakers et culture urbaine', 'Food IA et recettes impossibles',
    'Motivation, discipline et réussite financière', 'Univers futuristes et intelligence artificielle', 'Business e-commerce et revenus passifs'
  ];

  // ============================================================
  // HELPERS DOM & API
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    });
    children.forEach(c => {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  async function apiRequest(endpoint, options = {}) {
    if (!state.apiKey) throw new Error('NO_API_KEY');
    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${state.apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(errBody.error || `Erreur ${res.status}`);
    }
    return res;
  }

  // ============================================================
  // INITIALISATION & VALIDATION CLE
  // ============================================================
  async function validateKey(key) {
    const res = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok || !data.valid) throw new Error(data.error || 'Clé invalide');
    return data;
  }

  function showMainApp() {
    $('#welcome-screen').classList.add('hidden');
    $('#main-app').classList.remove('hidden');
    
    // Initialiser une session de chat si aucune n'existe
    if (state.chatSessions.length === 0) {
      createNewChatSession();
    } else {
      // Charger la dernière session active
      const lastSession = state.chatSessions[0];
      state.currentChatId = lastSession.id;
      renderChatHistoryList();
      renderChatMessages(lastSession.messages);
    }
    
    // Message de bienvenue système si c'est le tout premier lancement
    if (!localStorage.getItem('ia_mastor_welcomed')) {
      addSystemWelcomeMessage();
      localStorage.setItem('ia_mastor_welcomed', 'true');
    }
  }

  function addSystemWelcomeMessage() {
    const welcomeDiv = addChatMessageToUI('assistant', 
      `Bienvenue sur **IA MASTOR** 🚀\n\nJe suis ton assistant propulsé par Agnes. Voici ce que je peux faire :\n\n• 💬 Discuter avec toi et te donner des idées\n• 🖼️ Générer des images (Onglet Image)\n• 🎬 Créer des vidéos (Onglet Vidéo)\n• 📖 Écrire des histoires cohérentes (Onglet Histoire)\n\n*Après achat, cette application est interdite à la vente.*`
    );
    saveCurrentChatMessage({ role: 'assistant', content: welcomeDiv.dataset.rawText });
  }

  // ============================================================
  // GESTION DES SESSIONS DE CHAT (Historique)
  // ============================================================
  function createNewChatSession() {
    const newSession = {
      id: Date.now().toString(),
      title: 'Nouvelle discussion',
      messages: [],
      createdAt: new Date().toISOString()
    };
    state.chatSessions.unshift(newSession);
    state.currentChatId = newSession.id;
    renderChatHistoryList();
    $('#chat-messages').innerHTML = '';
    saveState();
  }

  function switchChatSession(id) {
    state.currentChatId = id;
    const session = state.chatSessions.find(s => s.id === id);
    if (session) {
      renderChatHistoryList();
      renderChatMessages(session.messages);
    }
  }

  function renderChatHistoryList() {
    const list = $('#chat-history-list');
    if (!list) return;
    list.innerHTML = state.chatSessions.map(session => `
      <div class="history-chat-item ${session.id === state.currentChatId ? 'active' : ''}" data-id="${session.id}">
        💬 ${escapeHtml(session.title)}
      </div>
    `).join('');

    list.querySelectorAll('.history-chat-item').forEach(item => {
      item.addEventListener('click', () => {
        switchChatSession(item.dataset.id);
        // Fermer le tiroir sur mobile
        $('#chat-history-sidebar').classList.remove('open');
      });
    });
  }

  function renderChatMessages(messages) {
    const container = $('#chat-messages');
    if (!container) return;
    container.innerHTML = '';
    if (!messages || messages.length === 0) return;

    messages.forEach(msg => {
      const div = el('div', { className: `chat-message ${msg.role}` });
      const bubble = el('div', { className: 'bubble' });
      bubble.innerHTML = msg.content.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      div.appendChild(bubble);
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  }

  function saveCurrentChatMessage(msg) {
    const session = state.chatSessions.find(s => s.id === state.currentChatId);
    if (session) {
      session.messages.push(msg);
      // Mettre à jour le titre si c'est le premier message utilisateur
      if (session.title === 'Nouvelle discussion' && msg.role === 'user') {
        session.title = msg.content.substring(0, 30) + '...';
        renderChatHistoryList();
      }
      saveState();
    }
  }

  // ============================================================
  // CHAT UI (Envoi et Streaming)
  // ============================================================
  function addChatMessageToUI(role, content) {
    const container = $('#chat-messages');
    if (!container) return null;
    const div = el('div', { className: `chat-message ${role}` });
    const bubble = el('div', { className: 'bubble' });
    if (role === 'assistant' && content) {
      bubble.innerHTML = content.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    } else {
      bubble.textContent = content;
    }
    div.appendChild(bubble);
    div.dataset.rawText = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function updateChatMessageUI(div, content) {
    if (!div) return;
    const bubble = div.querySelector('.bubble');
    if (bubble) {
      bubble.innerHTML = content.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    }
    div.dataset.rawText = content;
    const container = $('#chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  async function sendChatMessage(userContent) {
    saveCurrentChatMessage({ role: 'user', content: userContent });
    
    const assistantDiv = addChatMessageToUI('assistant', '');
    assistantDiv.classList.add('typing');

    const session = state.chatSessions.find(s => s.id === state.currentChatId);
    const contextMessages = session.messages.map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await apiRequest('/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: contextMessages.slice(-15), stream: true })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
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
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                updateChatMessageUI(assistantDiv, fullContent);
              }
            } catch (e) {}
          }
        }
      }

      assistantDiv.classList.remove('typing');
      saveCurrentChatMessage({ role: 'assistant', content: fullContent });
      
    } catch (err) {
      assistantDiv.classList.remove('typing');
      assistantDiv.querySelector('.bubble').textContent = `❌ Erreur : ${err.message}`;
    }
  }// ============================================================
  // IMAGE GENERATION & HISTORIQUE
  // ============================================================
  async function generateImage(prompt, size, ratio) {
    const res = await apiRequest('/image', {
      method: 'POST',
      body: JSON.stringify({ prompt: prompt.trim(), size: size || '2K', ratio: ratio || '16:9', n: 1 })
    });
    const data = await res.json();
    if (!data.success || !data.images || data.images.length === 0) throw new Error('Aucune image générée');

    const image = data.images[0];
    const entry = {
      id: Date.now(),
      prompt: prompt.trim(),
      size: data.size,
      ratio: data.ratio,
      url: image.url || image.b64,
      timestamp: new Date().toISOString()
    };

    state.imageHistory.unshift(entry);
    if (state.imageHistory.length > 20) state.imageHistory.pop(); // Limite à 20
    
    saveState();
    renderImageHistory();
    return entry;
  }

  function renderImageHistory() {
    const container = $('#image-history');
    if (!container) return;

    if (state.imageHistory.length === 0) {
      container.innerHTML = '<p class="empty-state">Aucune image générée pour le moment.</p>';
      return;
    }

    container.innerHTML = state.imageHistory.map(entry => `
      <div class="history-item" data-id="${entry.id}">
        <img src="${entry.url}" alt="Image" loading="lazy" onclick="window.open('${entry.url}', '_blank')">
        <div class="history-prompt" title="${escapeHtml(entry.prompt)}">${entry.size} · ${entry.ratio}<br>${escapeHtml(entry.prompt.substring(0, 40))}...</div>
      </div>
    `).join('');
  }

  // ============================================================
  // VIDEO GENERATION & POLLING ASYNC
  // ============================================================
  async function createVideoTask(prompt, seconds, aspectRatio) {
    const res = await apiRequest('/video', {
      method: 'POST',
      body: JSON.stringify({
        prompt: prompt.trim(),
        seconds: String(Math.min(12, Math.max(4, parseInt(seconds) || 5))),
        size: '720P',
        aspect_ratio: aspectRatio || '16:9',
        mode: 'text'
      })
    });
    const data = await res.json();
    if (!data.success || !data.video_id) throw new Error('Impossible de créer la tâche vidéo');
    return data;
  }

  async function pollVideoStatus(videoId, model) {
    const res = await apiRequest(`/video/status?video_id=${encodeURIComponent(videoId)}&model=${encodeURIComponent(model)}`);
    return res.json();
  }

  async function generateVideo(prompt, seconds, aspectRatio) {
    const task = await createVideoTask(prompt, seconds, aspectRatio);
    const statusEl = $('#video-status');
    if (statusEl) statusEl.textContent = '⏳ Initialisation de la génération…';

    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 90; // ~3 min

      const check = async () => {
        attempts++;
        try {
          const status = await pollVideoStatus(task.video_id, task.model);
          if (statusEl) {
            if (status.progress != null) statusEl.textContent = `⏳ Génération : ${status.progress}%`;
            else statusEl.textContent = '⏳ Traitement en cours…';
          }

          if (status.status === 'completed' && status.video_url) {
            if (statusEl) statusEl.textContent = '✅ Vidéo prête !';
            const entry = {
              id: Date.now(), prompt: prompt.trim(), seconds: String(seconds),
              aspectRatio: aspectRatio || '16:9', size: '720P', url: status.video_url, timestamp: new Date().toISOString()
            };
            state.videoHistory.unshift(entry);
            if (state.videoHistory.length > 10) state.videoHistory.pop();
            saveState();
            renderVideoHistory();
            resolve(entry);
            return;
          }

          if (status.status === 'failed') {
            if (statusEl) statusEl.textContent = '❌ Échec de la génération.';
            reject(new Error(status.error?.message || 'La génération vidéo a échoué.'));
            return;
          }

          if (attempts >= maxAttempts) {
            if (statusEl) statusEl.textContent = '❌ Délai dépassé (Serveur occupé).';
            reject(new Error('Délai dépassé.'));
            return;
          }
          setTimeout(check, 2000);
        } catch (err) {
          if (attempts >= maxAttempts) reject(err);
          else setTimeout(check, 3000);
        }
      };
      setTimeout(check, 2000);
    });
  }

  function renderVideoHistory() {
    const container = $('#video-history');
    if (!container) return;

    if (state.videoHistory.length === 0) {
      container.innerHTML = '<p class="empty-state">Aucune vidéo générée pour le moment.</p>';
      return;
    }

    container.innerHTML = state.videoHistory.map(entry => `
      <div class="video-card">
        <video controls preload="metadata" src="${entry.url}"></video>
        <div class="history-prompt">${entry.seconds}s · ${entry.aspectRatio}</div>
        <a href="${entry.url}" download class="btn-secondary">⬇ Télécharger</a>
      </div>
    `).join('');
  }

  // ============================================================
  // STORY MODE (Histoire avec mémoire)
  // ============================================================
  function renderStoryThemes() {
    const select = $('#story-theme-select');
    if (!select || select.options.length > 1) return;
    STORY_THEMES.forEach(theme => {
      const opt = document.createElement('option');
      opt.value = theme;
      opt.textContent = theme;
      select.appendChild(opt);
    });
  }

  function addStoryMessageToUI(role, content) {
    const container = $('#story-messages');
    if (!container) return null;
    const div = el('div', { className: `chat-message ${role}` });
    const bubble = el('div', { className: 'bubble' });
    bubble.innerHTML = content.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    div.appendChild(bubble);
    div.dataset.rawText = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function updateStoryStateUI() {
    const synopsisEl = $('#story-synopsis');
    if (synopsisEl) synopsisEl.value = state.storyState.synopsis;

    $$('.story-character-input').forEach((input, i) => {
      if (state.storyState.characters[i]) input.value = state.storyState.characters[i].name || '';
    });

    const promptsEl = $('#story-prompts-list');
    if (promptsEl) {
      if (state.storyState.prompts.length === 0) {
        promptsEl.innerHTML = '<p class="empty-state-small">Aucun prompt.</p>';
      } else {
        promptsEl.innerHTML = state.storyState.prompts.slice(-5).map((p, i) => `
          <div class="story-prompt-item">Prompt ${i+1}: ${escapeHtml(typeof p === 'string' ? p : p.prompt)}</div>
        `).join('');
      }
    }
  }

  async function sendStoryMessage(userContent) {
    state.storyMessages.push({ role: 'user', content: userContent });
    const assistantDiv = addStoryMessageToUI('assistant', '');
    assistantDiv.classList.add('typing');

    try {
      const res = await apiRequest('/story', {
        method: 'POST',
        body: JSON.stringify({
          messages: state.storyMessages.slice(-15),
          storyState: state.storyState,
          theme: state.storyState.theme
        })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
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
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                updateChatMessageUI(assistantDiv, fullContent); // Réutilise l'update du chat
              }
            } catch (e) {}
          }
        }
      }

      assistantDiv.classList.remove('typing');
      state.storyMessages.push({ role: 'assistant', content: fullContent });
      saveState();
      updateStoryStateUI();
    } catch (err) {
      assistantDiv.classList.remove('typing');
      assistantDiv.querySelector('.bubble').textContent = `❌ Erreur : ${err.message}`;
    }
  }

  // ============================================================
  // NAVIGATION & ÉVÉNEMENTS
  // ============================================================
  function switchTab(tab) {
    state.currentTab = tab;
    $$('.nav-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${tab}`));

    if (tab === 'image') renderImageHistory();
    if (tab === 'video') renderVideoHistory();
    if (tab === 'story') {
      renderStoryThemes();
      updateStoryStateUI();
    }
  }

  function setupEventListeners() {
    // 1. Validation de clé
    const keyForm = $('#key-form');
    if (keyForm) {
      keyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = $('#api-key-input').value.trim();
        const errorEl = $('#key-error');
        const btn = $('#key-submit');
        if (!key) { errorEl.textContent = 'Colle ta clé Agnes.'; return; }

        btn.disabled = true; btn.textContent = 'Validation…'; errorEl.textContent = '';
        try {
          await validateKey(key);
          state.apiKey = key;
          showMainApp();
        } catch (err) {
          errorEl.textContent = err.message || 'Clé invalide.';
        } finally {
          btn.disabled = false; btn.textContent = 'Accéder à IA MASTOR';
        }
      });
    }

    // 2. Afficher/Masquer la clé
    const toggleBtn = $('#key-toggle-visibility');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const input = $('#api-key-input');
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    }

    // 3. Navigation
    $$('.nav-tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    // 4. Chat : Nouveau & Envoi
    const newChatBtn = $('#new-chat-btn');
    if (newChatBtn) newChatBtn.addEventListener('click', createNewChatSession);

    const chatForm = $('#chat-form');
    if (chatForm) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('#chat-input');
        const msg = input.value.trim();
        if (!msg || state.isLoading) return;
        input.value = ''; input.style.height = 'auto';
        state.isLoading = true;
        try { await sendChatMessage(msg); } finally { state.isLoading = false; }
      });
    }
    
    // Auto-resize textarea
    $$('textarea').forEach(ta => {
      ta.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
      });
    });

    // 5. Image
    $('#image-presets').addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-btn')) $('#image-prompt').value = e.target.dataset.prompt;
    });
    
    const imageForm = $('#image-form');
    if (imageForm) {
      imageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = imageForm.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Génération…';
        try {
          const entry = await generateImage($('#image-prompt').value, $('#image-size').value, $('#image-ratio').value);
          $('#image-preview').innerHTML = `<img src="${entry.url}" alt="Résultat">`;
        } catch (err) { alert(err.message); } finally { btn.disabled = false; btn.textContent = 'Générer'; }
      });
    }

    // 6. Vidéo
    $('#video-presets').addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-btn')) $('#video-prompt').value = e.target.dataset.prompt;
    });

    const videoForm = $('#video-form');
    if (videoForm) {
      videoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = videoForm.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Génération…';
        try {
          const entry = await generateVideo($('#video-prompt').value, $('#video-seconds').value, $('#video-ratio').value);
          $('#video-preview').innerHTML = `<video controls autoplay src="${entry.url}"></video>`;
        } catch (err) { alert(err.message); } finally { btn.disabled = false; btn.textContent = 'Générer'; }
      });
    }

    // 7. Histoire (Chat & Formulaire)
    const storyForm = $('#story-form');
    if (storyForm) {
      storyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('#story-input');
        const msg = input.value.trim();
        if (!msg || state.isLoading) return;
        input.value = ''; input.style.height = 'auto';
        state.isLoading = true;
        try { await sendStoryMessage(msg); } finally { state.isLoading = false; }
      });
    }

    $('#story-theme-select').addEventListener('change', (e) => {
      state.storyState.theme = e.target.value;
      saveState();
    });
    $('#story-synopsis').addEventListener('input', (e) => {
      state.storyState.synopsis = e.target.value;
      saveState();
    });
    $$('.story-character-input').forEach((input, i) => {
      input.addEventListener('input', () => {
        if (state.storyState.characters[i]) state.storyState.characters[i].name = input.value;
        saveState();
      });
    });
  }

  // ============================================================
  // DÉMARRAGE
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEventListeners();
    
    // Toujours afficher le welcome screen au démarrage (sécurité BYOK)
    $('#welcome-screen').classList.remove('hidden');
    $('#main-app').classList.add('hidden');
  });

})();
