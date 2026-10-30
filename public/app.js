(function () {
  'use strict';

  const state = {
    apiKey: null,
    currentChatId: null,
    chatSessions: [],
    imageHistory: [],
    videoHistory: [],
    storyMessages: [],
    storyState: { synopsis: '', characters: [{name:''},{name:''},{name:''}], prompts: [], theme: null },
    isLoading: false,
    attachedImageBase64: null
  };

  const STORY_THEMES = [
    'Histoires de fruits IA', 'Business automatisé', 'UGC IA / Influenceurs', 'Luxe & Millionnaires',
    'Couples toxiques', 'Animaux humanisés', 'Célébrité virtuelle', 'Transformation avant/après',
    'Secrets Reddit', 'Mini-séries TikTok', 'Streetwear & Sneakers', 'Food IA', 'Motivation & Réussite',
    'Univers futuristes', 'E-commerce & Revenus passifs'
  ];

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  function saveState() {
    try {
      localStorage.setItem('ia_mastor_v3', JSON.stringify({
        chatSessions: state.chatSessions,
        imageHistory: state.imageHistory.slice(0, 30),
        videoHistory: state.videoHistory.slice(0, 15),
        storyMessages: state.storyMessages.slice(-20),
        storyState: state.storyState
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      const saved = localStorage.getItem('ia_mastor_v3');
      if (saved) {
        const p = JSON.parse(saved);
        state.chatSessions = p.chatSessions || [];
        state.imageHistory = p.imageHistory || [];
        state.videoHistory = p.videoHistory || [];
        state.storyMessages = p.storyMessages || [];
        state.storyState = p.storyState || state.storyState;
      }
    } catch (e) {}
  }

  async function apiRequest(endpoint, options = {}) {
    if (!state.apiKey) throw new Error('Clé manquante');
    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers: { 'Authorization': `Bearer ${state.apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!res.ok) { 
      const e = await res.json().catch(()=>({error:'Erreur'})); 
      throw new Error(e.error || 'Erreur API'); 
    }
    return res;
  }

  // --- CHAT ---
  function addMessageToUI(role, text, imageBase64 = null) {
    const container = $('#chat-messages');
    if(!container) return null;
    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    let html = '';
    if (imageBase64) html += `<img src="${imageBase64}" style="max-width:200px;border-radius:8px;margin-bottom:8px;display:block;">`;
    html += text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    div.innerHTML = `<div class="bubble">${html}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  async function sendChatMessage(text) {
    const session = state.chatSessions.find(s => s.id === state.currentChatId);
    if (!session) return;

    addMessageToUI('user', text, state.attachedImageBase64);
    
    let contentPayload = text;
    if (state.attachedImageBase64) {
      contentPayload = [
        { type: "text", text: text },
        { type: "image_url", image_url: { url: state.attachedImageBase64 } }
      ];
    }

    session.messages.push({ role: 'user', content: contentPayload });
    state.attachedImageBase64 = null;
    
    const assistantDiv = addMessageToUI('assistant', '...');
    
    try {
      const res = await apiRequest('/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: session.messages.slice(-15), stream: true })
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
                assistantDiv.querySelector('.bubble').innerHTML = full.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
              }
            } catch(e) {}
          }
        }
      }
      session.messages.push({ role: 'assistant', content: full });
      saveState();
    } catch (err) {
      assistantDiv.querySelector('.bubble').textContent = `❌ ${err.message}`;
    }
  }

  // --- IMAGE BATCH ---
  function renderImageHistory() {
    const c = $('#image-history');
    if (!c) return;
    if (state.imageHistory.length === 0) { c.innerHTML = '<p class="empty-state">Aucune image générée.</p>'; return; }
    c.innerHTML = state.imageHistory.map(e => `
      <div class="history-item">
        <img src="${e.url}" onclick="window.open('${e.url}','_blank')" style="cursor:pointer;">
        <div class="history-prompt">${e.size} · ${e.ratio}<br>${e.prompt.substring(0,30)}...</div>
      </div>
    `).join('');
  }

  async function runImageBatch(prompt, count, size, ratio) {
    const status = $('#image-status');
    if(!status) return;
    for (let i = 0; i < count; i++) {
      status.textContent = `Génération ${i+1}/${count} en cours...`;
      try {
        const res = await apiRequest('/image', {
          method: 'POST',
          body: JSON.stringify({ prompt, size, ratio, n: 1 })
        });
        const data = await res.json();
        if (data.images?.[0]) {
          const entry = { id: Date.now(), url: data.images[0].url, prompt, size, ratio };
          state.imageHistory.unshift(entry);
          renderImageHistory();
          saveState();
        }
      } catch (e) { console.error(e); }
      // Délai de sécurité pour le Starter Plan (4K = 1 par minute)
      await new Promise(r => setTimeout(r, size === '4K' ? 60000 : 3000));
    }
    status.textContent = '✅ Série d\'images terminée !';
  }

  // --- VIDEO BATCH & POLLING ---
  function renderVideoHistory() {
    const c = $('#video-history');
    if (!c) return;
    if (state.videoHistory.length === 0) { c.innerHTML = '<p class="empty-state">Aucune vidéo générée.</p>'; return; }
    c.innerHTML = state.videoHistory.map(e => `
      <div class="video-card">
        <video controls src="${e.url}"></video>
        <div class="history-prompt">${e.seconds}s · ${e.ratio}</div>
        <a href="${e.url}" download class="btn-secondary">⬇ Télécharger</a>
      </div>
    `).join('');
  }

  async function generateOneVideo(prompt, seconds, ratio) {
    const res = await apiRequest('/video', {
      method: 'POST',
      body: JSON.stringify({ prompt, seconds: String(seconds), size: '720P', aspect_ratio: ratio, mode: 'text' })
    });
    const data = await res.json();
    if (!data.success || !data.video_id) throw new Error('Erreur création vidéo');
    
    const videoId = data.video_id;
    const model = data.model;
    let attempts = 0;
    
    while (attempts < 90) {
      attempts++;
      await new Promise(r => setTimeout(r, 3000));
      try {
        const pRes = await apiRequest(`/video/status?video_id=${encodeURIComponent(videoId)}&model=${encodeURIComponent(model)}`);
        const pData = await pRes.json();
        if (pData.status === 'completed' && pData.video_url) return pData.video_url;
        if (pData.status === 'failed') throw new Error('Échec génération vidéo');
      } catch (e) {}
    }
    throw new Error('Délai dépassé');
  }

  async function runVideoBatch(prompt, count, seconds, ratio) {
    const status = $('#video-status');
    if(!status) return;
    for (let i = 0; i < count; i++) {
      status.textContent = `Génération vidéo ${i+1}/${count}... (Patientez, très long)`;
      try {
        const url = await generateOneVideo(prompt, seconds, ratio);
        const entry = { id: Date.now(), url, prompt, seconds, ratio };
        state.videoHistory.unshift(entry);
        renderVideoHistory();
        saveState();
      } catch (e) { console.error(e); }
      await new Promise(r => setTimeout(r, 5000));
    }
    status.textContent = '✅ Série de vidéos terminée !';
  }

  // --- STORY MODE ---
  function renderStoryThemes() {
    const s = $('#story-theme-select');
    if (!s || s.options.length > 1) return;
    STORY_THEMES.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; s.appendChild(o); });
  }

  async function sendStoryMessage(text) {
    state.storyMessages.push({ role: 'user', content: text });
    const assistantDiv = addMessageToUI('assistant', '...');
    if(assistantDiv) assistantDiv.id = 'story-temp-msg';
    // Note: le chat story utilise le même conteneur DOM que le chat global dans cette version simplifiée
    
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
                if(assistantDiv) assistantDiv.querySelector('.bubble').innerHTML = full.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
              }
            } catch(e) {}
          }
        }
      }
      state.storyMessages.push({ role: 'assistant', content: full });
      saveState();
    } catch (err) {
      if(assistantDiv) assistantDiv.querySelector('.bubble').textContent = `❌ ${err.message}`;
    }
  }

  // --- INIT & EVENTS ---
  function createNewChatSession() {
    const n = { id: Date.now().toString(), title: 'Nouvelle discussion', messages: [] };
    state.chatSessions.unshift(n);
    state.currentChatId = n.id;
    $('#chat-messages').innerHTML = '';
    renderChatHistoryList();
    saveState();
  }

  function renderChatHistoryList() {
    const l = $('#chat-history-list');
    if (!l) return;
    l.innerHTML = state.chatSessions.map(s => `
      <div class="history-chat-item ${s.id === state.currentChatId ? 'active' : ''}" data-id="${s.id}">
        💬 ${s.title}
      </div>
    `).join('');
    l.querySelectorAll('.history-chat-item').forEach(i => {
      i.onclick = () => {
        state.currentChatId = i.dataset.id;
        const sess = state.chatSessions.find(x => x.id === state.currentChatId);
        if(sess) {
          $('#chat-messages').innerHTML = '';
          sess.messages.forEach(m => addMessageToUI(m.role, m.content));
        }
        renderChatHistoryList();
      };
    });
  }

  function setupEvents() {
    // Welcome Screen
    $('#key-form').onsubmit = async (e) => {
      e.preventDefault();
      const k = $('#api-key-input').value.trim();
      const btn = $('#key-submit'); const err = $('#key-error');
      btn.disabled = true; btn.textContent = 'Connexion...'; err.textContent = '';
      try {
        const res = await fetch('/api/validate-key', { method: 'POST', headers: { 'Authorization': `Bearer ${k}` } });
        const d = await res.json();
        if (!res.ok || !d.valid) throw new Error(d.error || 'Clé invalide');
        state.apiKey = k;
        $('#welcome-screen').classList.add('hidden');
        $('#main-app').classList.remove('hidden');
        if (state.chatSessions.length === 0) createNewChatSession();
        else renderChatHistoryList();
      } catch(ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; btn.textContent = 'Accéder à IA MASTOR'; }
    };

    // Navigation
    $$('.nav-tab, .mobile-nav-btn').forEach(b => {
      b.onclick = () => {
        $$('.nav-tab, .mobile-nav-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const tab = b.dataset.tab;
        $$('.tab-panel').forEach(p => p.classList.remove('active'));
        $(`#panel-${tab}`).classList.add('active');
        if(tab==='image') renderImageHistory();
        if(tab==='video') renderVideoHistory();
        if(tab==='story') renderStoryThemes();
      };
    });

    // Chat
    $('#new-chat-btn').onclick = createNewChatSession;
    $('#chat-form').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#chat-input').value.trim();
      if(!v) return;
      $('#chat-input').value = '';
      sendChatMessage(v);
    };
    $('#chat-upload-btn').onclick = () => $('#chat-image-upload').click();
    $('#chat-image-upload').onchange = (e) => {
      const f = e.target.files[0];
      if(!f) return;
      const r = new FileReader();
      r.onload = (ev) => { state.attachedImageBase64 = ev.target.result; $('#chat-input').placeholder = "Image jointe ! Écris ton message..."; };
      r.readAsDataURL(f);
    };

    // Image Batch
    $('#image-presets').onclick = (e) => { if(e.target.classList.contains('preset-btn')) $('#image-prompt').value = e.target.dataset.prompt; };
    $('#image-form').onsubmit = (e) => {
      e.preventDefault();
      const p = $('#image-prompt').value;
      const c = parseInt($('#image-batch').value);
      const s = $('#image-size').value;
      const r = $('#image-ratio').value;
      runImageBatch(p, c, s, r);
    };

    // Video Batch
    $('#video-presets').onclick = (e) => { if(e.target.classList.contains('preset-btn')) $('#video-prompt').value = e.target.dataset.prompt; };
    $('#video-form').onsubmit = (e) => {
      e.preventDefault();
      const p = $('#video-prompt').value;
      const c = parseInt($('#video-batch').value);
      const sec = $('#video-seconds').value;
      const r = $('#video-ratio').value;
      runVideoBatch(p, c, sec, r);
    };

    // Story Chat
    $('#story-form').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#story-input').value.trim();
      if(!v) return;
      $('#story-input').value = '';
      sendStoryMessage(v);
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEvents();
  });

})();
