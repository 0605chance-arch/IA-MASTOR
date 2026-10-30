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

})();
