(function () {
  'use strict';

  const state = {
    apiKey: null,
    chatSessions: [],
    currentChatId: null,
    imageHistory: [],
    videoScenes: [],
    storyScenes: [],
    storyState: { synopsis: '', characters: [{name:'', img:null},{name:'', img:null},{name:'', img:null}], theme: null },
    attachedImageBase64: null
  };

  const STORY_THEMES = [
    'Histoires de fruits IA', 'Business automatisé', 'UGC IA / Influenceurs', 'Luxe & Millionnaires',
    'Couples toxiques', 'Animaux humanisés', 'Célébrité virtuelle', 'Transformation avant/après',
    'Secrets Reddit', 'Mini-séries TikTok', 'Streetwear & Sneakers', 'Food IA', 'Motivation & Réussite',
    'Univers futuristes', 'E-commerce & Revenus passifs'
  ];

  const $ = s => document.querySelector(s);

  function saveState() {
    try {
      localStorage.setItem('ia_mastor_v5', JSON.stringify({
        chatSessions: state.chatSessions,
        imageHistory: state.imageHistory.slice(0, 30),
        videoScenes: state.videoScenes,
        storyScenes: state.storyScenes,
        storyState: state.storyState
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      const saved = localStorage.getItem('ia_mastor_v5');
      if (saved) {
        const p = JSON.parse(saved);
        state.chatSessions = p.chatSessions || [];
        state.imageHistory = p.imageHistory || [];
        state.videoScenes = p.videoScenes || [];
        state.storyScenes = p.storyScenes || [];
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
    if (!res.ok) { const e = await res.json().catch(()=>({error:'Erreur'})); throw new Error(e.error || 'Erreur API'); }
    return res;
  }

  // --- RENDU DES CARTES DE SCÈNES (VIDEO & HISTOIRE) ---
  function renderScenes(containerId, scenesArray, type) {
    const c = $(`#${containerId}`);
    if (!c) return;
    
    if (scenesArray.length === 0) {
      c.innerHTML = '<p class="empty-state">Aucune scène. Clique sur "Ajouter une scène" ou génère depuis l\'Histoire.</p>';
      return;
    }

    c.innerHTML = scenesArray.map((scene, index) => {
      const statusClass = scene.status === 'loading' ? 'loading' : (scene.status === 'error' ? 'error' : (scene.status === 'success' ? 'success' : ''));
      const statusText = scene.status === 'loading' ? 'Génération...' : (scene.status === 'error' ? 'Erreur' : (scene.status === 'success' ? 'Prêt' : 'En attente'));
      
      return `
      <div class="scene-card" data-index="${index}" data-type="${type}">
        <div class="scene-card-header">
          <span>Scène ${index + 1}</span>
          <span class="scene-status ${statusClass}">${statusText}</span>
        </div>
        
        <textarea class="scene-prompt-input" placeholder="Décrivez la scène..." onchange="updateScenePrompt('${type}', ${index}, this.value)">${scene.prompt || ''}</textarea>
        
        <input type="file" accept="image/*" hidden id="scene-img-${type}-${index}" onchange="handleSceneImageUpload(event, '${type}', ${index})">
        <label for="scene-img-${type}-${index}" class="scene-img-upload">
          ${scene.imageBase64 ? `<img src="${scene.imageBase64}" alt="Ref">` : '📷 Image de scène (Optionnel)'}
        </label>

        <div class="scene-controls">
          <select onchange="updateSceneSetting('${type}', ${index}, 'ratio', this.value)">
            <option value="9:16" ${scene.ratio === '9:16' ? 'selected' : ''}>9:16</option>
            <option value="16:9" ${scene.ratio === '16:9' ? 'selected' : ''}>16:9</option>
            <option value="1:1" ${scene.ratio === '1:1' ? 'selected' : ''}>1:1</option>
          </select>
          <select onchange="updateSceneSetting('${type}', ${index}, 'seconds', this.value)">
            <option value="4" ${scene.seconds === '4' ? 'selected' : ''}>4s</option>
            <option value="5" ${scene.seconds === '5' ? 'selected' : ''}>5s</option>
            <option value="8" ${scene.seconds === '8' ? 'selected' : ''}>8s</option>
            <option value="10" ${scene.seconds === '10' ? 'selected' : ''}>10s</option>
            <option value="12" ${scene.seconds === '12' ? 'selected' : ''}>12s</option>
          </select>
        </div>
        
        <div class="scene-controls">
          <select style="grid-column: 1 / -1;" onchange="updateSceneSetting('${type}', ${index}, 'size', this.value)">
            <option value="720P" ${scene.size === '720P' ? 'selected' : ''}>Standard (720P)</option>
            <option value="1080P" ${scene.size === '1080P' ? 'selected' : ''}>HD (1080p) - Pro</option>
          </select>
        </div>

        <div class="scene-actions">
          <button class="btn-primary" onclick="generateSceneVideo('${type}', ${index})">Générer</button>
          <button class="btn-secondary" onclick="downloadSceneVideo('${type}', ${index})" ${!scene.videoUrl ? 'disabled' : ''}>Télécharger</button>
        </div>
        
        <div class="scene-preview">
          ${scene.videoUrl ? `<video controls src="${scene.videoUrl}"></video>` : ''}
        </div>
      </div>
      `;
    }).join('');
  }

  window.updateScenePrompt = (type, index, val) => {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    arr[index].prompt = val; saveState();
  };
  window.updateSceneSetting = (type, index, key, val) => {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    arr[index][key] = val; saveState();
  };
  window.handleSceneImageUpload = (e, type, index) => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const arr = type === 'video' ? state.videoScenes : state.storyScenes;
      arr[index].imageBase64 = ev.target.result; 
      renderScenes(type === 'video' ? 'video-storyboard-container' : 'story-storyboard-container', arr, type); saveState();
    };
    reader.readAsDataURL(file);
  };
  window.downloadSceneVideo = (type, index) => {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    if(arr[index] && arr[index].videoUrl) window.open(arr[index].videoUrl, '_blank');
  };

  // --- LOGIQUE VIDÉO (UNITAIRE) ---
  async function generateSceneVideo(type, index) {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    const scene = arr[index];
    if(!scene.prompt) return alert('Le prompt est vide.');
    
    scene.status = 'loading';
    renderScenes(type === 'video' ? 'video-storyboard-container' : 'story-storyboard-container', arr, type);
    
    try {
      const body = { prompt: scene.prompt, seconds: String(scene.seconds), size: scene.size || '720P', aspect_ratio: scene.ratio };
      if (scene.imageBase64) { body.mode = 'img2video'; body.first_frame = scene.imageBase64; }
      
      const res = await apiRequest('/video', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.video_id) throw new Error('Erreur création vidéo');
      
      let attempts = 0;
      while (attempts < 90) {
        attempts++;
        await new Promise(r => setTimeout(r, 3000));
        try {
          const pRes = await apiRequest(`/video/status?video_id=${data.video_id}&model=${data.model}`);
          const pData = await pRes.json();
          if (pData.status === 'completed' && pData.video_url) {
            scene.status = 'success'; scene.videoUrl = pData.video_url; break;
          }
          if (pData.status === 'failed') throw new Error('Échec génération');
        } catch (e) {}
      }
      if (attempts >= 90) throw new Error('Timeout');
    } catch (e) {
      scene.status = 'error'; console.error(e);
    }
    saveState();
    renderScenes(type === 'video' ? 'video-storyboard-container' : 'story-storyboard-container', arr, type);
  }

  // --- LOGIQUE VIDÉO (BATCH : TOUT GÉNÉRER) ---
  async function generateAllVideos(type) {
    const arr = type === 'video' ? state.videoScenes : state.storyScenes;
    if(arr.length === 0) return alert('Aucune scène.');
    
    for(let i = 0; i < arr.length; i++) {
      if (arr[i].status !== 'success') {
        await generateSceneVideo(type, i);
      }
    }
    alert('✅ Génération de toutes les scènes terminée !');
  }

  // --- LOGIQUE HISTOIRE (GÉNÉRATION DES 10 SCÈNES) ---
  async function generateStoryboard() {
    const btn = $('#story-generate-btn');
    btn.disabled = true; btn.textContent = 'Génération du storyboard...';
    
    const theme = $('#story-theme-select').value;
    const synopsis = $('#story-synopsis').value;
    const chars = state.storyState.characters.map(c => c.name).filter(n => n).join(', ');
    
    if(!synopsis) { alert('Remplis le synopsis.'); btn.disabled=false; btn.textContent='Générer les 10 scènes'; return; }
    
    // Prompt système strict pour forcer Agnes à générer un JSON parfait
    const prompt = `Agis comme un scénariste. Thématique: ${theme}. Synopsis: ${synopsis}. Personnages: ${chars}. 
Génère EXACTEMENT 10 scènes pour un format TikTok/Reels de 9:16.
Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour. 
Format: [{"prompt": "Description visuelle précise", "seconds": "5", "ratio": "9:16"}, ...]`;

    try {
      const res = await apiRequest('/chat', { method: 'POST', body: JSON.stringify({ messages: [{role:'user', content: prompt}], stream: false }) });
      const data = await res.json();
      const text = data.choices[0].message.content;
      
      // Extraction du JSON de la réponse (au cas où l'IA ajoute du texte)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if(jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        state.storyScenes = parsed.map(s => ({ ...s, status: 'pending', videoUrl: null, imageBase64: null, size: '720P' }));
        renderScenes('story-storyboard-container', state.storyScenes, 'story');
        saveState();
      } else { 
        alert('Erreur de format de l\'IA. Elle n\'a pas renvoyé un JSON valide.'); 
      }
    } catch(e) { alert('Erreur : ' + e.message); }
    btn.disabled = false; btn.textContent = 'Générer les 10 scènes';
  }// ============================================================
  // LOGIQUE CHAT
  // ============================================================
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
          sess.messages.forEach(m => addMessageToUI(m.role, typeof m.content === 'string' ? m.content : '[Image jointe]'));
        }
        renderChatHistoryList();
      };
    });
  }

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
    $('#chat-input').placeholder = "Écris ton message…"; 
    
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

  // ============================================================
  // LOGIQUE IMAGE (BATCH)
  // ============================================================
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

  // ============================================================
  // INITIALISATION & ÉVÉNEMENTS
  // ============================================================
  function setupEvents() {
    // 1. Welcome Screen
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
        
        // Chargement de l'interface
        if (state.chatSessions.length === 0) createNewChatSession();
        else renderChatHistoryList();
        
        renderScenes('video-storyboard-container', state.videoScenes, 'video');
        renderScenes('story-storyboard-container', state.storyScenes, 'story');
        renderImageHistory();
      } catch(ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; btn.textContent = 'Accéder à l\'app'; }
    };

    // 2. Toggle mot de passe
    $('#key-toggle-visibility').onclick = () => {
      const input = $('#api-key-input');
      input.type = input.type === 'password' ? 'text' : 'password';
    };

    // 3. Navigation (Desktop & Mobile)
    document.querySelectorAll('.nav-tab, .mobile-nav-btn').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.nav-tab, .mobile-nav-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const tab = b.dataset.tab;
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector(`#panel-${tab}`).classList.add('active');
      };
    });

    // 4. Chat Events
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
      r.onload = (ev) => { 
        state.attachedImageBase64 = ev.target.result; 
        $('#chat-input').placeholder = "📷 Image jointe ! Écris ton message..."; 
      };
      r.readAsDataURL(f);
    };

    // 5. Image Events
    $('#image-presets').onclick = (e) => { 
      if(e.target.classList.contains('preset-btn')) $('#image-prompt').value = e.target.dataset.prompt; 
    };
    $('#image-form').onsubmit = (e) => {
      e.preventDefault();
      const p = $('#image-prompt').value;
      const c = parseInt($('#image-batch').value);
      const s = $('#image-size').value;
      const r = $('#image-ratio').value;
      runImageBatch(p, c, s, r);
    };

    // 6. Video Storyboard Events
    $('#add-video-scene-btn').onclick = () => {
      state.videoScenes.push({ prompt: '', seconds: '5', ratio: '9:16', size: '720P', status: 'pending', videoUrl: null });
      renderScenes('video-storyboard-container', state.videoScenes, 'video');
      saveState();
    };
    $('#video-clear-btn').onclick = () => {
      if(confirm('Effacer toutes les scènes vidéo ?')) {
        state.videoScenes = [];
        renderScenes('video-storyboard-container', state.videoScenes, 'video');
        saveState();
      }
    };
    $('#generate-all-video-btn').onclick = () => generateAllVideos('video');

    // 7. Histoire Events
    const themeSelect = $('#story-theme-select');
    if (themeSelect && themeSelect.options.length === 1) {
      STORY_THEMES.forEach(t => { 
        const o = document.createElement('option'); 
        o.value = t; o.textContent = t; themeSelect.appendChild(o); 
      });
    }
    
    $('#story-synopsis').oninput = (e) => { state.storyState.synopsis = e.target.value; saveState(); };
    
    document.querySelectorAll('.story-character-input').forEach((input, i) => {
      input.oninput = (e) => { 
        if(state.storyState.characters[i]) state.storyState.characters[i].name = e.target.value; 
        saveState(); 
      };
    });

    document.querySelectorAll('.char-upload').forEach((input, i) => {
      input.onchange = (e) => {
        const f = e.target.files[0]; if(!f) return;
        const r = new FileReader();
        r.onload = (ev) => {
          if(state.storyState.characters[i]) {
            state.storyState.characters[i].img = ev.target.result;
            document.querySelector(`#char-label-${i}`).innerHTML = `✅ Visage ${i+1}`;
            saveState();
          }
        };
        r.readAsDataURL(f);
      };
    });

    $('#story-generate-btn').onclick = generateStoryboard;
    $('#generate-all-story-btn').onclick = () => generateAllVideos('story');
  }

  // ============================================================
  // DÉMARRAGE DE L'APP
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEvents();
  });

})();
