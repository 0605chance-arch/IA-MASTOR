(function () {
  'use strict';

  const state = {
    apiKey: null,
    chatSessions: [],
    currentChatId: null,
    imageHistory: [],
    imageScenes: [],
    videoScenes: [],
    videoHistory: [],
    storyScenes: [],
    storyHistory: [],
    chatImageBase64: null,
    storyChars: [{name:'', img:null},{name:'', img:null},{name:'', img:null}]
  };

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  function save() {
    try {
      localStorage.setItem('iamastor_final_v4', JSON.stringify({
        chatSessions: state.chatSessions,
        imageHistory: state.imageHistory.slice(0, 30),
        imageScenes: state.imageScenes,
        videoScenes: state.videoScenes,
        videoHistory: state.videoHistory.slice(0, 30),
        storyScenes: state.storyScenes,
        storyHistory: state.storyHistory.slice(0, 30),
        storyChars: state.storyChars
      }));
    } catch(e) {}
  }

  function load() {
    try {
      const s = localStorage.getItem('iamastor_final_v4');
      if (s) {
        const p = JSON.parse(s);
        Object.assign(state, p);
      }
    } catch(e) {}
  }

  async function api(url, options = {}) {
    if (!state.apiKey) throw new Error('Clé manquante');
    const res = await fetch(`/api${url}`, {
      ...options,
      headers: { 'Authorization': `Bearer ${state.apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!res.ok) { 
      const e = await res.json().catch(()=>({error:'Erreur API'})); 
      throw new Error(e.error || 'Erreur API'); 
    }
    return res;
  }

  // ==========================================
  // LOGIQUE DE GÉNÉRATION VIDÉO (Générique)
  // ==========================================
  async function generateVideoScene(arr, idx, renderFunc, containerId, type) {
    const scene = arr[idx];
    if(!scene.prompt) return alert('Écris un prompt.');
    
    scene.status = 'loading';
    renderFunc(containerId, arr, type);
    
    try {
      const body = { prompt: scene.prompt, seconds: String(scene.seconds), size: scene.size || '720P', aspect_ratio: scene.ratio };
      
      // Si une image de référence (first_frame) est jointe, on l'envoie
      if (scene.imageBase64) { 
        body.mode = 'img2video'; 
        body.first_frame = scene.imageBase64; 
      }
      
      const res = await api('/video', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.video_id) throw new Error('Erreur création ID');
      
      let attempts = 0;
      while (attempts < 90) {
        attempts++;
        await new Promise(r => setTimeout(r, 3000));
        const pRes = await api(`/video/status?video_id=${data.video_id}&model=${data.model}`);
        const pData = await pRes.json();
        
        if (pData.status === 'completed' && pData.video_url) { 
          scene.status = 'success'; 
          scene.videoUrl = pData.video_url; 
          break; 
        }
        if (pData.status === 'failed') throw new Error('Échec génération');
      }
      if (attempts >= 90) throw new Error('Timeout');
    } catch (e) { 
      scene.status = 'error'; 
      console.error(e);
    }
    
    save();
    renderFunc(containerId, arr, type);
  }

  // ==========================================
  // ONGLET IMAGE
  // ==========================================
  function renderImages(containerId, scenes, type) {
    const c = $('#image-scenes');
    if (!c) return;
    c.innerHTML = scenes.map((scene, index) => `
      <div class="scene">
        <div class="scene-head">
          <span>IMAGE ${index + 1}</span>
          <span>${scene.status === 'loading' ? '⏳' : (scene.status === 'error' ? '❌' : (scene.status === 'success' ? '✅' : '⏸'))}</span>
        </div>
        
        <textarea placeholder="Décris l'image..." data-idx="${index}" class="img-prompt">${scene.prompt || ''}</textarea>
        
        <input type="file" accept="image/*" hidden id="img-ref-${index}">
        <label for="img-ref-${index}" class="btn-upload" style="display:block; padding:10px; background:var(--bg); border-radius:8px; text-align:center; font-size:12px; margin-bottom:12px; cursor:pointer;">
          ${scene.imageBase64 ? '✅ Image de référence jointe' : '📷 Joindre une image (Optionnel)'}
        </label>

        <div class="row">
          <select data-idx="${index}" class="img-size">
            <option value="1K" ${scene.size==='1K'?'selected':''}>1K</option>
            <option value="2K" ${scene.size==='2K'?'selected':''}>2K</option>
            <option value="4K" ${scene.size==='4K'?'selected':''}>4K</option>
          </select>
          <select data-idx="${index}" class="img-ratio">
            <option value="16:9" ${scene.ratio==='16:9'?'selected':''}>16:9</option>
            <option value="9:16" ${scene.ratio==='9:16'?'selected':''}>9:16</option>
            <option value="1:1" ${scene.ratio==='1:1'?'selected':''}>1:1</option>
          </select>
        </div>
        
        <button class="btn-gen" data-idx="${index}">Générer cette image</button>
      </div>
    `).join('');

    c.querySelectorAll('.img-prompt').forEach(el => el.oninput = e => { scenes[e.target.dataset.idx].prompt = e.target.value; save(); });
    c.querySelectorAll('.img-size').forEach(el => el.onchange = e => { scenes[e.target.dataset.idx].size = e.target.value; save(); });
    c.querySelectorAll('.img-ratio').forEach(el => el.onchange = e => { scenes[e.target.dataset.idx].ratio = e.target.value; save(); });
    
    c.querySelectorAll('.btn-upload').forEach((el, i) => {
      const input = c.querySelector(`#img-ref-${i}`);
      if(input) input.onchange = (e) => {
        const f = e.target.files[0]; if(!f) return;
        const r = new FileReader();
        r.onload = (ev) => { scenes[i].imageBase64 = ev.target.result; renderImages(containerId, scenes, type); save(); };
        r.readAsDataURL(f);
      };
    });

    c.querySelectorAll('.btn-gen').forEach(el => el.onclick = async e => {
      const btn = e.target; const idx = btn.dataset.idx; const s = scenes[idx];
      btn.textContent = 'Génération...'; btn.disabled = true;
      try {
        const body = { prompt: s.prompt, size: s.size, ratio: s.ratio, n: 1 };
        if (s.imageBase64) { body.mode = 'img2img'; body.referenceImages = [s.imageBase64]; }
        
        const res = await api('/image', { method: 'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (data.images?.[0]) {
          state.imageHistory.unshift({ url: data.images[0].url, size: s.size, ratio: s.ratio });
          renderImages(containerId, scenes, type); save();
        }
      } catch(err) { alert(err.message); }
      btn.textContent = 'Générer cette image'; btn.disabled = false;
    });

    const hist = $('#image-history');
    if (hist) {
      hist.innerHTML = state.imageHistory.map(img => `
        <div class="item">
          <img src="${img.url}" onclick="window.open('${img.url}','_blank')">
          <a href="${img.url}" download class="item-btn">⬇ Télécharger</a>
        </div>
      `).join('');
    }
  }

  // ==========================================
  // ONGLET VIDÉO (Ajout de l'upload d'image)
  // ==========================================
  function renderVideos(containerId, scenes, type) {
    const c = $('#video-scenes');
    if (!c) return;
    c.innerHTML = scenes.map((scene, index) => `
      <div class="scene">
        <div class="scene-head">
          <span>SCÈNE ${index + 1}</span>
          <span>${scene.status === 'loading' ? '⏳' : (scene.status === 'error' ? '❌' : (scene.status === 'success' ? '✅' : '⏸'))}</span>
        </div>
        
        <textarea placeholder="Décris cette scène..." data-idx="${index}" class="vid-prompt">${scene.prompt || ''}</textarea>
        
        <input type="file" accept="image/*" hidden id="vid-ref-${index}">
        <label for="vid-ref-${index}" class="btn-upload" style="display:block; padding:10px; background:var(--bg); border-radius:8px; text-align:center; font-size:12px; margin-bottom:12px; cursor:pointer;">
          ${scene.imageBase64 ? '✅ Image de départ jointe (img2video)' : '📷 Joindre une image de départ (Optionnel)'}
        </label>
        
        <div class="row">
          <select data-idx="${index}" class="vid-ratio">
            <option value="9:16" ${scene.ratio==='9:16'?'selected':''}>9:16</option>
            <option value="16:9" ${scene.ratio==='16:9'?'selected':''}>16:9</option>
          </select>
          <select data-idx="${index}" class="vid-sec">
            ${[4,5,6,8,10,12].map(n => `<option value="${n}" ${scene.seconds==n?'selected':''}>${n}s</option>`).join('')}
          </select>
          <select data-idx="${index}" class="vid-size">
            <option value="720P" ${scene.size==='720P'?'selected':''}>720P</option>
            <option value="1080P" ${scene.size==='1080P'?'selected':''}>1080P</option>
          </select>
        </div>
        
        <button class="btn-gen" data-idx="${index}">Générer cette scène</button>
      </div>
    `).join('');

    c.querySelectorAll('.vid-prompt').forEach(el => el.oninput = e => { scenes[e.target.dataset.idx].prompt = e.target.value; save(); });
    c.querySelectorAll('.vid-ratio').forEach(el => el.onchange = e => { scenes[e.target.dataset.idx].ratio = e.target.value; save(); });
    c.querySelectorAll('.vid-sec').forEach(el => el.onchange = e => { scenes[e.target.dataset.idx].seconds = e.target.value; save(); });
    c.querySelectorAll('.vid-size').forEach(el => el.onchange = e => { scenes[e.target.dataset.idx].size = e.target.value; save(); });
    
    // Upload d'image pour la vidéo
    c.querySelectorAll('.btn-upload').forEach((el, i) => {
      const input = c.querySelector(`#vid-ref-${i}`);
      if(input) input.onchange = (e) => {
        const f = e.target.files[0]; if(!f) return;
        const r = new FileReader();
        r.onload = (ev) => { scenes[i].imageBase64 = ev.target.result; renderVideos(containerId, scenes, type); save(); };
        r.readAsDataURL(f);
      };
    });

    c.querySelectorAll('.btn-gen').forEach(el => el.onclick = (e) => {
      generateVideoScene(scenes, e.target.dataset.idx, renderVideos, containerId, type);
    });

    const hist = $('#video-history');
    if (hist) {
      hist.innerHTML = state.videoHistory.map(v => `
        <div class="item">
          <video controls src="${v.url}"></video>
          <a href="${v.url}" download class="item-btn">⬇ Télécharger</a>
        </div>
      `).join('');
    }
  }

  // ==========================================
  // ONGLET HISTOIRE (Ajout de l'upload d'image)
  // ==========================================
  function renderStory(containerId, scenes, type) {
    state.storyChars.forEach((c, i) => {
      const btn = $(`#char-btn-${i}`);
      if (btn) btn.innerHTML = c.img ? '✅' : '📷';
    });

    const c = $('#story-scenes');
    if (!c) return;
    c.innerHTML = scenes.map((scene, index) => `
      <div class="scene">
        <div class="scene-head">
          <span>PROMPT ${index + 1}</span>
          <span>${scene.status === 'loading' ? '⏳' : (scene.status === 'error' ? '❌' : (scene.status === 'success' ? '✅' : '⏸'))}</span>
        </div>
        
        <textarea placeholder="Décris cette scène (l'IA connaît le synopsis)..." data-idx="${index}" class="story-prompt">${scene.prompt || ''}</textarea>
        
        <input type="file" accept="image/*" hidden id="story-ref-${index}">
        <label for="story-ref-${index}" class="btn-upload" style="display:block; padding:10px; background:var(--bg); border-radius:8px; text-align:center; font-size:12px; margin-bottom:12px; cursor:pointer;">
          ${scene.imageBase64 ? '✅ Image de scène jointe (img2video)' : '📷 Joindre une image de scène (Optionnel)'}
        </label>
        
        <div class="row">
          <select data-idx="${index}" class="story-ratio">
            <option value="9:16" ${scene.ratio==='9:16'?'selected':''}>9:16</option>
            <option value="16:9" ${scene.ratio==='16:9'?'selected':''}>16:9</option>
          </select>
          <select data-idx="${index}" class="story-sec">
            ${[4,5,6,8,10,12].map(n => `<option value="${n}" ${scene.seconds==n?'selected':''}>${n}s</option>`).join('')}
          </select>
        </div>
        
        <button class="btn-gen" data-idx="${index}">Générer cette scène</button>
      </div>
    `).join('');

    c.querySelectorAll('.story-prompt').forEach(el => el.oninput = e => { scenes[e.target.dataset.idx].prompt = e.target.value; save(); });
    c.querySelectorAll('.story-ratio').forEach(el => el.onchange = e => { scenes[e.target.dataset.idx].ratio = e.target.value; save(); });
    c.querySelectorAll('.story-sec').forEach(el => el.onchange = e => { scenes[e.target.dataset.idx].seconds = e.target.value; save(); });
    
    // Upload d'image pour l'histoire
    c.querySelectorAll('.btn-upload').forEach((el, i) => {
      const input = c.querySelector(`#story-ref-${i}`);
      if(input) input.onchange = (e) => {
        const f = e.target.files[0]; if(!f) return;
        const r = new FileReader();
        r.onload = (ev) => { scenes[i].imageBase64 = ev.target.result; renderStory(containerId, scenes, type); save(); };
        r.readAsDataURL(f);
      };
    });

    c.querySelectorAll('.btn-gen').forEach(el => el.onclick = (e) => {
      generateVideoScene(scenes, e.target.dataset.idx, renderStory, containerId, type);
    });

    const hist = $('#story-history');
    if (hist) {
      hist.innerHTML = state.storyHistory.map(v => `
        <div class="item">
          <video controls src="${v.url}"></video>
          <a href="${v.url}" download class="item-btn">⬇ Télécharger</a>
        </div>
      `).join('');
    }
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
    
    // Noms et photos des personnages (menu de gauche de l'histoire)
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
