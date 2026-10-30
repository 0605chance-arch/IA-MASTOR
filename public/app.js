(function () {
  'use strict';

  const state = {
    apiKey: null, chatSessions: [], currentChatId: null, imageHistory: [],
    videoScenes: [], storyScenes: [], attachedImageBase64: null
  };

  const STORY_THEMES = [
    'Histoires de fruits IA', 'Business automatisé', 'UGC IA', 'Luxe & Millionnaires',
    'Couples toxiques', 'Animaux humanisés', 'Célébrité virtuelle', 'Transformation',
    'Secrets Reddit', 'Mini-séries TikTok', 'Streetwear', 'Food IA', 
    'Motivation', 'Univers futuristes', 'E-commerce'
  ];
  
  const $ = s => document.querySelector(s);

  function saveState() {
    try { localStorage.setItem('ia_mastor_v7', JSON.stringify({
      chatSessions: state.chatSessions, imageHistory: state.imageHistory.slice(0, 30),
      videoScenes: state.videoScenes, storyScenes: state.storyScenes
    })); } catch(e){}
  }

  function loadState() {
    try {
      const saved = localStorage.getItem('ia_mastor_v7');
      if (saved) {
        const p = JSON.parse(saved);
        state.chatSessions = p.chatSessions || []; state.imageHistory = p.imageHistory || [];
        state.videoScenes = p.videoScenes || []; state.storyScenes = p.storyScenes || [];
      }
    } catch(e){}
  }

  async function apiRequest(endpoint, options = {}) {
    if (!state.apiKey) throw new Error('Clé manquante');
    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers: { 'Authorization': `Bearer ${state.apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!res.ok) { const e = await res.json().catch(()=>({error:'Erreur'})); throw new Error(e.error || 'Erreur API'); }
    return res;
  }

  // ==========================================
  // LOGIQUE SCÈNES (VIDEO & HISTOIRE)
  // ==========================================
  function renderScenes(containerId, scenesArray, type) {
    const c = $(`#${containerId}`);
    if (!c) return;
    if (scenesArray.length === 0) { c.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">Aucune scène.</p>'; return; }

    c.innerHTML = scenesArray.map((scene, index) => {
      const statusText = scene.status === 'loading' ? '⏳ Génération en cours...' : (scene.status === 'error' ? '❌ Erreur' : (scene.status === 'success' ? '✅ Prêt' : '⏸ En attente'));
      const videoHtml = scene.videoUrl ? `<div class="scene-preview"><video controls src="${scene.videoUrl}"></video><br><a href="${scene.videoUrl}" target="_blank" class="btn-secondary" style="display:inline-block;margin-top:8px;">⬇ Télécharger</a></div>` : '';
      
      return `
      <div class="scene-card">
        <div class="scene-card-header"><span>SCÈNE ${index + 1}</span><span class="scene-status">${statusText}</span></div>
        <textarea class="scene-prompt-input" placeholder="Décris la scène..." data-type="${type}" data-idx="${index}">${scene.prompt || ''}</textarea>
        <div class="scene-controls">
          <select data-type="${type}" data-idx="${index}" data-key="ratio">
            <option value="9:16" ${scene.ratio === '9:16' ? 'selected' : ''}>9:16</option>
            <option value="16:9" ${scene.ratio === '16:9' ? 'selected' : ''}>16:9</option>
          </select>
          <select data-type="${type}" data-idx="${index}" data-key="seconds">
            ${[4,5,6,8,10,12].map(s => `<option value="${s}" ${scene.seconds == s ? 'selected' : ''}>${s}s</option>`).join('')}
          </select>
          <select data-type="${type}" data-idx="${index}" data-key="size">
            <option value="720P" ${scene.size === '720P' ? 'selected' : ''}>720P</option>
            <option value="1080P" ${scene.size === '1080P' ? 'selected' : ''}>1080P</option>
          </select>
        </div>
        <div class="scene-actions">
          <button class="btn-primary gen-scene-btn" data-type="${type}" data-idx="${index}">Générer</button>
        </div>
        ${videoHtml}
      </div>`;
    }).join('');

    // Attacher les événements manuellement (plus fiable que onclick inline)
    c.querySelectorAll('.scene-prompt-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const type = e.target.dataset.type; const idx = parseInt(e.target.dataset.idx);
        const arr = type === 'video' ? state.videoScenes : state.storyScenes;
        arr[idx].prompt = e.target.value; saveState();
      });
    });
    c.querySelectorAll('select[data-key]').forEach(el => {
      el.addEventListener('change', (e) => {
        const type = e.target.dataset.type; const idx = parseInt(e.target.dataset.idx); const key = e.target.dataset.key;
        const arr = type === 'video' ? state.videoScenes : state.storyScenes;
        arr[idx][key] = e.target.value; saveState();
      });
    });
    c.querySelectorAll('.gen-scene-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        const type = e.target.dataset.type; const idx = parseInt(e.target.dataset.idx);
        generateSceneVideo(type, idx);
      });
    });
  }

  async function generateSceneVideo(type, index) {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    const scene = arr[index];
    if(!scene.prompt) return alert('Écris un prompt.');
    
    scene.status = 'loading';
    renderScenes(type === 'video' ? 'video-storyboard-container' : 'story-storyboard-container', arr, type);
    
    try {
      const body = { prompt: scene.prompt, seconds: String(scene.seconds), size: scene.size, aspect_ratio: scene.ratio };
      const res = await apiRequest('/video', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.video_id) throw new Error('Erreur création');
      
      let attempts = 0;
      while (attempts < 90) {
        attempts++;
        await new Promise(r => setTimeout(r, 3000));
        const pRes = await apiRequest(`/video/status?video_id=${data.video_id}&model=${data.model}`);
        const pData = await pRes.json();
        if (pData.status === 'completed' && pData.video_url) { scene.status = 'success'; scene.videoUrl = pData.video_url; break; }
        if (pData.status === 'failed') throw new Error('Échec');
      }
      if (attempts >= 90) throw new Error('Timeout');
    } catch (e) { scene.status = 'error'; }
    saveState();
    renderScenes(type === 'video' ? 'video-storyboard-container' : 'story-storyboard-container', arr, type);
  }

  async function generateAllVideos(type) {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    if(arr.length === 0) return;
    for(let i = 0; i < arr.length; i++) {
      if(arr[i].status !== 'success') await generateSceneVideo(type, i);
    }
    alert('✅ Série terminée !');
  }

  // ==========================================
  // CHAT
  // ==========================================
  function createNewChatSession() {
    const n = { id: Date.now().toString(), title: 'Nouvelle discussion', messages: [] };
    state.chatSessions.unshift(n); state.currentChatId = n.id;
    $('#chat-messages').innerHTML = ''; renderChatHistoryList(); saveState();
  }

  function renderChatHistoryList() {
    const l = $('#chat-history-list'); if (!l) return;
    l.innerHTML = state.chatSessions.map(s => `
      <div class="history-chat-item ${s.id === state.currentChatId ? 'active' : ''}" data-id="${s.id}">💬 ${s.title}</div>
    `).join('');
    l.querySelectorAll('.history-chat-item').forEach(el => {
      el.addEventListener('click', () => {
        state.currentChatId = el.dataset.id;
        const sess = state.chatSessions.find(x => x.id === state.currentChatId);
        if(sess) { $('#chat-messages').innerHTML = ''; sess.messages.forEach(m => addMessageToUI(m.role, typeof m.content === 'string' ? m.content : '[Image]')); }
        renderChatHistoryList();
      });
    });
  }

  function addMessageToUI(role, text, img = null) {
    const container = $('#chat-messages'); if(!container) return null;
    const div = document.createElement('div'); div.className = `chat-message ${role}`;
    let html = img ? `<img src="${img}" style="max-width:200px;border-radius:8px;margin-bottom:8px;">` : '';
    html += text.replace(/\n/g, '<br>');
    div.innerHTML = `<div class="bubble">${html}</div>`;
    container.appendChild(div); container.scrollTop = container.scrollHeight;
    return div;
  }

  async function sendChatMessage(text) {
    const session = state.chatSessions.find(s => s.id === state.currentChatId); if (!session) return;
    addMessageToUI('user', text, state.attachedImageBase64);
    let payload = text;
    if (state.attachedImageBase64) payload = [{ type: "text", text: text }, { type: "image_url", image_url: { url: state.attachedImageBase64 } }];
    session.messages.push({ role: 'user', content: payload });
    state.attachedImageBase64 = null; $('#chat-input').placeholder = "Message...";
    const assistantDiv = addMessageToUI('assistant', '...');
    
    try {
      const res = await apiRequest('/chat', { method: 'POST', body: JSON.stringify({ messages: session.messages.slice(-15), stream: true }) });
      const reader = res.body.getReader(); const decoder = new TextDecoder();
      let full = ''; let buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim(); if (data === '[DONE]') continue;
            try {
              const p = JSON.parse(data); const delta = p.choices?.[0]?.delta?.content || '';
              if (delta) { full += delta; assistantDiv.querySelector('.bubble').innerHTML = full.replace(/\n/g, '<br>'); $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight; }
            } catch(e) {}
          }
        }
      }
      session.messages.push({ role: 'assistant', content: full });
      if (session.title === 'Nouvelle discussion') { session.title = text.substring(0, 20) + '...'; renderChatHistoryList(); }
      saveState();
    } catch (err) { assistantDiv.querySelector('.bubble').textContent = `❌ Erreur: ${err.message}`; }
  }

  // ==========================================
  // IMAGE (BATCH)
  // ==========================================
  function renderImageHistory() {
    const c = $('#image-history'); if (!c) return;
    if (state.imageHistory.length === 0) { c.innerHTML = ''; return; }
    c.innerHTML = state.imageHistory.map(e => `
      <div class="history-item">
        <img src="${e.url}" onclick="window.open('${e.url}','_blank')">
        <div class="history-prompt">${e.size} · ${e.ratio}</div>
      </div>
    `).join('');
  }

  async function runImageBatch(prompt, count, size, ratio) {
    const status = $('#image-status');
    for (let i = 0; i < count; i++) {
      status.textContent = `Génération image ${i+1}/${count}...`;
      try {
        const res = await apiRequest('/image', { method: 'POST', body: JSON.stringify({ prompt, size, ratio, n: 1 }) });
        const data = await res.json();
        if (data.images?.[0]) { state.imageHistory.unshift({ url: data.images[0].url, prompt, size, ratio }); renderImageHistory(); saveState(); }
      } catch (e) {}
      await new Promise(r => setTimeout(r, size === '4K' ? 60000 : 4000));
    }
    status.textContent = '✅ Terminé !';
  }

  // ==========================================
  // HISTOIRE (GÉNÉRATION 10 SCÈNES)
  // ==========================================
  async function generateStoryboard() {
    const btn = $('#story-generate-btn'); btn.disabled = true; btn.textContent = 'Génération...';
    const theme = $('#story-theme-select').value;
    const synopsis = $('#story-synopsis').value;
    if(!synopsis) { alert('Remplis le synopsis.'); btn.disabled=false; btn.textContent='Générer le Storyboard'; return; }
    
    const prompt = `Agis comme un scénariste. Thématique: ${theme}. Synopsis: ${synopsis}. Génère EXACTEMENT 10 scènes. Réponds UNIQUEMENT avec un tableau JSON: [{"prompt": "description", "seconds": "5", "ratio": "9:16"}, ...]`;

    try {
      const res = await apiRequest('/chat', { method: 'POST', body: JSON.stringify({ messages: [{role:'user', content: prompt}], stream: false }) });
      const data = await res.json();
      const text = data.choices[0].message.content;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if(jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        state.storyScenes = parsed.map(s => ({ ...s, status: 'pending', videoUrl: null, size: '720P' }));
        renderScenes('story-storyboard-container', state.storyScenes, 'story'); saveState();
      } else { alert('Erreur format IA.'); }
    } catch(e) { alert('Erreur : ' + e.message); }
    btn.disabled = false; btn.textContent = 'Générer le Storyboard';
  }

  // ==========================================
  // INITIALISATION
  // ==========================================
  function setupEvents() {
    $('#key-form').onsubmit = async (e) => {
      e.preventDefault();
      const k = $('#api-key-input').value.trim();
      $('#key-submit').textContent = '...'; $('#key-submit').disabled = true;
      try {
        const res = await fetch('/api/validate-key', { method: 'POST', headers: { 'Authorization': `Bearer ${k}` } });
        const d = await res.json(); if (!res.ok || !d.valid) throw new Error();
        state.apiKey = k;
        $('#welcome-screen').classList.add('hidden'); $('#main-app').classList.remove('hidden');
        if (state.chatSessions.length === 0) createNewChatSession(); else renderChatHistoryList();
        
        // Ajout scène par défaut
        if (state.videoScenes.length === 0) state.videoScenes.push({ prompt: '', seconds: '5', ratio: '9:16', size: '720P', status: 'pending' });
        if (state.storyScenes.length === 0) state.storyScenes.push({ prompt: '', seconds: '5', ratio: '9:16', size: '720P', status: 'pending' });
        
        renderScenes('video-storyboard-container', state.videoScenes, 'video');
        renderScenes('story-storyboard-container', state.storyScenes, 'story');
        renderImageHistory();
      } catch(ex) { $('#key-error').textContent = 'Clé invalide.'; $('#key-submit').disabled = false; $('#key-submit').textContent = 'Démarrer'; }
    };

    document.querySelectorAll('.nav-tab, .mobile-nav-btn').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.nav-tab, .mobile-nav-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector(`#panel-${b.dataset.tab}`).classList.add('active');
      };
    });

    $('#new-chat-btn').onclick = createNewChatSession;
    $('#chat-form').onsubmit = (e) => {
      e.preventDefault(); const v = $('#chat-input').value.trim(); if(!v) return;
      $('#chat-input').value = ''; sendChatMessage(v);
    };
    $('#chat-upload-btn').onclick = () => $('#chat-image-upload').click();
    $('#chat-image-upload').onchange = (e) => {
      const f = e.target.files[0]; if(!f) return;
      const r = new FileReader(); r.onload = (ev) => { state.attachedImageBase64 = ev.target.result; $('#chat-input').placeholder = "📷 Image jointe"; }; r.readAsDataURL(f);
    };

    $('#image-form').onsubmit = (e) => {
      e.preventDefault();
      runImageBatch($('#image-prompt').value, parseInt($('#image-batch').value), $('#image-size').value, $('#image-ratio').value);
    };

    $('#add-video-scene-btn').onclick = () => {
      state.videoScenes.push({ prompt: '', seconds: '5', ratio: '9:16', size: '720P', status: 'pending' });
      renderScenes('video-storyboard-container', state.videoScenes, 'video'); saveState();
    };
    $('#generate-all-video-btn').onclick = () => generateAllVideos('video');

    $('#add-story-scene-btn').onclick = () => {
      state.storyScenes.push({ prompt: '', seconds: '5', ratio: '9:16', size: '720P', status: 'pending' });
      renderScenes('story-storyboard-container', state.storyScenes, 'story'); saveState();
    };
    $('#generate-all-story-btn').onclick = () => generateAllVideos('story');

    // Remplir les thèmes
    const ts = $('#story-theme-select');
    if (ts && ts.options.length === 1) {
      STORY_THEMES.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; ts.appendChild(o); });
    }

    $('#story-generate-btn').onclick = generateStoryboard;
    $('#story-synopsis').oninput = (e) => { saveState(); };
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEvents();
  });

})();(function () {
  'use strict';

  // State global
  const state = {
    apiKey: null,
    chatSessions: [],
    currentChatId: null,
    imageHistory: [],
    videoScenes: [],
    storyScenes: [],
    chatImageBase64: null
  };

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  // Sauvegarde locale
  function save() {
    try {
      localStorage.setItem('iamastor_v8', JSON.stringify({
        chatSessions: state.chatSessions,
        imageHistory: state.imageHistory.slice(0, 30),
        videoScenes: state.videoScenes,
        storyScenes: state.storyScenes
      }));
    } catch(e) {}
  }

  function load() {
    try {
      const s = localStorage.getItem('iamastor_v8');
      if (s) {
        const p = JSON.parse(s);
        state.chatSessions = p.chatSessions || [];
        state.imageHistory = p.imageHistory || [];
        state.videoScenes = p.videoScenes || [];
        state.storyScenes = p.storyScenes || [];
      }
    } catch(e) {}
  }

  // API
  async function api(url, options = {}) {
    if (!state.apiKey) throw new Error('Clé manquante');
    const res = await fetch(`/api${url}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${state.apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({error:'Erreur'}));
      throw new Error(err.error || `Erreur ${res.status}`);
    }
    return res;
  }

  // ==========================================
  // CHAT
  // ==========================================
  function renderChat() {
    const box = $('#chat-messages');
    const sess = state.chatSessions.find(s => s.id === state.currentChatId);
    if (!box || !sess) return;
    
    box.innerHTML = '';
    sess.messages.forEach(m => {
      const div = document.createElement('div');
      div.className = `msg ${m.role}`;
      let content = '';
      if (typeof m.content === 'string') {
        content = m.content;
      } else if (Array.isArray(m.content)) {
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

  function newChat() {
    const s = { id: Date.now().toString(), messages: [] };
    state.chatSessions.push(s);
    state.currentChatId = s.id;
    renderChat();
    save();
  }

  async function sendChat(text) {
    const sess = state.chatSessions.find(s => s.id === state.currentChatId);
    if (!sess) return;

    let content = text;
    if (state.chatImageBase64) {
      content = [
        { type: 'text', text: text },
        { type: 'image_url', image_url: { url: state.chatImageBase64 } }
      ];
    }
    sess.messages.push({ role: 'user', content });
    state.chatImageBase64 = null;
    $('#chat-input').placeholder = 'Message...';
    renderChat();
    
    // Placeholder assistant
    const box = $('#chat-messages');
    const placeholder = document.createElement('div');
    placeholder.className = 'msg assistant';
    placeholder.textContent = '...';
    box.appendChild(placeholder);

    try {
      const res = await api('/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: sess.messages.slice(-15),
          stream: true
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
  // IMAGE
  // ==========================================
  function renderImages() {
    const box = $('#image-history');
    if (!box) return;
    
    if (state.imageHistory.length === 0) {
      box.innerHTML = '';
      return;
    }
    
    box.innerHTML = state.imageHistory.map(img => `
      <div class="item">
        <img src="${img.url}" onclick="window.open('${img.url}','_blank')">
        <p>${img.size} · ${img.ratio}</p>
      </div>
    `).join('');
  }

  async function generateImages(prompt, count, size, ratio) {
    const status = $('#image-status');
    
    for (let i = 0; i < count; i++) {
      status.textContent = `Image ${i+1}/${count}...`;
      try {
        const res = await api('/image', {
          method: 'POST',
          body: JSON.stringify({ prompt, size, ratio, n: 1 })
        });
        const data = await res.json();
        if (data.images?.[0]) {
          state.imageHistory.unshift({
            url: data.images[0].url,
            size, ratio
          });
          renderImages();
          save();
        }
      } catch(e) {
        console.error(e);
      }
      await new Promise(r => setTimeout(r, size === '4K' ? 60000 : 4000));
    }
    status.textContent = `✅ ${count} image(s) générée(s)`;
  }

  // ==========================================
  // VIDÉO (SCÈNES)
  // ==========================================
  function renderScenes(containerId, scenes, type) {
    const box = $(`#${containerId}`);
    if (!box) return;

    if (scenes.length === 0) {
      box.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Aucune scène. Clique sur + Scène</p>';
      return;
    }

    box.innerHTML = scenes.map((s, i) => {
      const status = s.status === 'loading' ? '⏳ En cours...' : 
                     s.status === 'error' ? '❌ Erreur' : 
                     s.status === 'success' ? '✅ Prêt' : '⏸ En attente';
      
      const video = s.videoUrl ? `
        <video controls src="${s.videoUrl}"></video>
        <a href="${s.videoUrl}" target="_blank" class="download">⬇ Télécharger</a>
      ` : '';
      
      return `
        <div class="scene" data-idx="${i}">
          <div class="scene-head">
            <span>SCÈNE ${i+1}</span>
            <span>${status}</span>
          </div>
          <textarea placeholder="Décris cette scène..." data-type="${type}" data-idx="${i}">${s.prompt || ''}</textarea>
          <div class="row">
            <select data-type="${type}" data-idx="${i}" data-key="ratio">
              <option value="9:16" ${s.ratio === '9:16' ? 'selected' : ''}>9:16</option>
              <option value="16:9" ${s.ratio === '16:9' ? 'selected' : ''}>16:9</option>
            </select>
            <select data-type="${type}" data-idx="${i}" data-key="seconds">
              ${[4,5,6,8,10,12].map(n => `<option value="${n}" ${s.seconds == n ? 'selected' : ''}>${n}s</option>`).join('')}
            </select>
            <select data-type="${type}" data-idx="${i}" data-key="size">
              <option value="720P" ${s.size === '720P' ? 'selected' : ''}>720P</option>
              <option value="1080P" ${s.size === '1080P' ? 'selected' : ''}>1080P</option>
            </select>
          </div>
          <button class="gen-btn" data-type="${type}" data-idx="${i}">Générer cette scène</button>
          ${video}
        </div>
      `;
    }).join('');

    // Attacher les événements
    box.querySelectorAll('textarea').forEach(el => {
      el.addEventListener('input', e => {
        const type = e.target.dataset.type;
        const idx = parseInt(e.target.dataset.idx);
        const arr = type === 'video' ? state.videoScenes : state.storyScenes;
        arr[idx].prompt = e.target.value;
        save();
      });
    });

    box.querySelectorAll('select').forEach(el => {
      el.addEventListener('change', e => {
        const type = e.target.dataset.type;
        const idx = parseInt(e.target.dataset.idx);
        const key = e.target.dataset.key;
        const arr = type === 'video' ? state.videoScenes : state.storyScenes;
        arr[idx][key] = e.target.value;
        save();
      });
    });

    box.querySelectorAll('.gen-btn').forEach(el => {
      el.addEventListener('click', e => {
        const type = e.target.dataset.type;
        const idx = parseInt(e.target.dataset.idx);
        generateScene(type, idx);
      });
    });
  }

  async function generateScene(type, idx) {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    const scene = arr[idx];
    
    if (!scene.prompt) return alert('Écris un prompt');
    
    scene.status = 'loading';
    renderScenes(type === 'video' ? 'video-scenes' : 'story-scenes', arr, type);
    
    try {
      const res = await api('/video', {
        method: 'POST',
        body: JSON.stringify({
          prompt: scene.prompt,
          seconds: String(scene.seconds),
          size: scene.size,
          aspect_ratio: scene.ratio
        })
      });
      const data = await res.json();
      if (!data.video_id) throw new Error('Pas de video_id');
      
      let attempts = 0;
      while (attempts < 100) {
        attempts++;
        await new Promise(r => setTimeout(r, 3000));
        try {
          const pRes = await api(`/video/status?video_id=${data.video_id}&model=${data.model}`);
          const pData = await pRes.json();
          if (pData.status === 'completed' && pData.video_url) {
            scene.status = 'success';
            scene.videoUrl = pData.video_url;
            break;
          }
          if (pData.status === 'failed') throw new Error('Échec');
        } catch(e) {}
      }
      if (attempts >= 100) throw new Error('Timeout');
    } catch(e) {
      scene.status = 'error';
    }
    
    save();
    renderScenes(type === 'video' ? 'video-scenes' : 'story-scenes', arr, type);
  }

  async function generateAll(type) {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].status !== 'success') {
        await generateScene(type, i);
      }
    }
  }

  // ==========================================
  // HISTOIRE (GÉNÉRATION AUTO)
  // ==========================================
  async function generateStoryboard() {
    const btn = $('#story-gen-btn');
    const synopsis = $('#story-synopsis').value.trim();
    const char1 = $('#story-char1').value.trim();
    const char2 = $('#story-char2').value.trim();
    
    if (!synopsis) return alert('Remplis le synopsis');
    
    btn.disabled = true;
    btn.textContent = 'Génération...';
    
    const prompt = `Tu es scénariste. Synopsis: ${synopsis}. Personnages: ${char1}, ${char2}. 
Génère EXACTEMENT 10 scènes pour TikTok (9:16, 8s chacune).
Réponds UNIQUEMENT avec un JSON, sans texte avant/après :
[{"prompt": "description visuelle détaillée", "seconds": "8", "ratio": "9:16"}, ...]`;

    try {
      const res = await api('/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          stream: false
        })
      });
      const data = await res.json();
      const text = data.choices[0].message.content;
      
      // Extraction du JSON
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('L\'IA n\'a pas renvoyé de JSON');
      
      const scenes = JSON.parse(match[0]);
      state.storyScenes = scenes.map(s => ({
        prompt: s.prompt,
        seconds: s.seconds || '8',
        ratio: s.ratio || '9:16',
        size: '720P',
        status: 'pending',
        videoUrl: null
      }));
      
      renderScenes('story-scenes', state.storyScenes, 'story');
      save();
    } catch(e) {
      alert('Erreur : ' + e.message);
    }
    
    btn.disabled = false;
    btn.textContent = 'Générer 10 scènes';
  }

  // ==========================================
  // NAVIGATION
  // ==========================================
  function switchTab(tab) {
    $$('.nav-btn, .mob-btn').forEach(b => b.classList.remove('active'));
    $$(`[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));
    $$('.tab').forEach(t => t.classList.remove('active'));
    $(`#tab-${tab}`).classList.add('active');
  }

  // ==========================================
  // INITIALISATION
  // ==========================================
  function setupEvents() {
    // Login
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const key = $('#api-key').value.trim();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Connexion...';
      
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
        
        // Init
        if (state.chatSessions.length === 0) newChat();
        else {
          state.currentChatId = state.chatSessions[0].id;
          renderChat();
        }
        
        if (state.videoScenes.length === 0) {
          state.videoScenes.push({
            prompt: '', seconds: '8', ratio: '9:16',
            size: '720P', status: 'pending', videoUrl: null
          });
        }
        if (state.storyScenes.length === 0) {
          state.storyScenes.push({
            prompt: '', seconds: '8', ratio: '9:16',
            size: '720P', status: 'pending', videoUrl: null
          });
        }
        
        renderScenes('video-scenes', state.videoScenes, 'video');
        renderScenes('story-scenes', state.storyScenes, 'story');
        renderImages();
        
      } catch(err) {
        $('#login-error').textContent = 'Clé invalide';
        btn.disabled = false;
        btn.textContent = 'Démarrer';
      }
    };

    // Navigation
    $$('.nav-btn, .mob-btn').forEach(b => {
      b.onclick = () => switchTab(b.dataset.tab);
    });

    // Chat
    $('#chat-form').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#chat-input').value.trim();
      if (!v) return;
      $('#chat-input').value = '';
      sendChat(v);
    };
    $('#chat-file-btn').onclick = () => $('#chat-file').click();
    $('#chat-file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        state.chatImageBase64 = ev.target.result;
        $('#chat-input').placeholder = '📷 Image jointe';
      };
      r.readAsDataURL(f);
    };

    // Image
    $('#image-form').onsubmit = (e) => {
      e.preventDefault();
      const p = $('#image-prompt').value.trim();
      if (!p) return;
      generateImages(p, parseInt($('#image-count').value), $('#image-size').value, $('#image-ratio').value);
    };

    // Vidéo
    $('#add-scene-video').onclick = () => {
      state.videoScenes.push({
        prompt: '', seconds: '8', ratio: '9:16',
        size: '720P', status: 'pending', videoUrl: null
      });
      renderScenes('video-scenes', state.videoScenes, 'video');
      save();
    };
    $('#gen-all-video').onclick = () => generateAll('video');

    // Histoire
    $('#gen-all-story').onclick = () => generateAll('story');
    $('#story-gen-btn').onclick = generateStoryboard;
  }

  // Start
  document.addEventListener('DOMContentLoaded', () => {
    load();
    setupEvents();
  });

})();
