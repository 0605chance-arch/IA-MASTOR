(function () {
  'use strict';

  const state = {
    apiKey: null, chatSessions: [], currentChatId: null, imageHistory: [],
    videoScenes: [], storyScenes: [], imageScenes: [], storyChars: [{name:'', img:null},{name:'', img:null},{name:'', img:null}]
  };

  const $ = s => document.querySelector(s);

  function save() {
    try { localStorage.setItem('iamastor_v12', JSON.stringify({
      chatSessions: state.chatSessions, imageHistory: state.imageHistory.slice(0, 30),
      videoScenes: state.videoScenes, storyScenes: state.storyScenes, imageScenes: state.imageScenes,
      storyChars: state.storyChars
    })); } catch(e){}
  }

  function load() {
    try {
      const s = localStorage.getItem('iamastor_v12');
      if (s) {
        const p = JSON.parse(s);
        state.chatSessions = p.chatSessions || []; state.imageHistory = p.imageHistory || [];
        state.videoScenes = p.videoScenes || []; state.storyScenes = p.storyScenes || [];
        state.imageScenes = p.imageScenes || []; state.storyChars = p.storyChars || [{name:'', img:null},{name:'', img:null},{name:'', img:null}];
      }
    } catch(e){}
  }

  async function api(url, options = {}) {
    if (!state.apiKey) throw new Error('Clé manquante');
    const res = await fetch(`/api${url}`, {
      ...options,
      headers: { 'Authorization': `Bearer ${state.apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!res.ok) { const e = await res.json().catch(()=>({error:'Erreur'})); throw new Error(e.error || 'Erreur API'); }
    return res;
  }

  // ==========================================
  // RENDU DES SCÈNES
  // ==========================================
  function renderScenes(type) {
    const isImg = type === 'image', isVid = type === 'video', isStory = type === 'story';
    const c = $(`#${type}-scenes`);
    if (!c) return;
    const arr = isImg ? state.imageScenes : (isVid ? state.videoScenes : state.storyScenes);

    if (!arr || arr.length === 0) {
      c.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Aucune scène. Clique sur +.</p>';
      return;
    }

    c.innerHTML = arr.map((s, i) => {
      const status = s.status === 'loading' ? '⏳ En cours...' : s.status === 'error' ? '❌ Erreur' : s.status === 'success' ? '✅ Prêt' : '⏸ En attente';
      return `
        <div class="scene">
          <div class="scene-head"><span>SCÈNE ${i+1}</span><span>${status}</span></div>
          <textarea placeholder="Décris cette scène..." data-type="${type}" data-idx="${i}">${s.prompt || ''}</textarea>
          
          ${!isImg ? `
          <input type="file" accept="image/*" hidden id="${type}-ref-${i}">
          <label for="${type}-ref-${i}" class="btn-upload" style="display:block;padding:10px;background:var(--bg);border-radius:8px;text-align:center;font-size:12px;margin-bottom:12px;cursor:pointer;">
            ${s.imageBase64 ? '✅ Image de référence jointe' : '📷 Joindre une image (Optionnel)'}
          </label>
          ` : ''}

          <div class="row">
            <select data-type="${type}" data-idx="${i}" data-key="ratio">
              <option value="9:16" ${s.ratio === '9:16' ? 'selected' : ''}>9:16</option>
              <option value="16:9" ${s.ratio === '16:9' ? 'selected' : ''}>16:9</option>
              ${isImg ? `<option value="1:1" ${s.ratio === '1:1' ? 'selected' : ''}>1:1</option>` : ''}
            </select>
            ${isImg ? `
            <select data-type="${type}" data-idx="${i}" data-key="size">
              <option value="1K" ${s.size === '1K' ? 'selected' : ''}>1K</option>
              <option value="2K" ${s.size === '2K' ? 'selected' : ''}>2K</option>
              <option value="4K" ${s.size === '4K' ? 'selected' : ''}>4K</option>
            </select>` : `
            <select data-type="${type}" data-idx="${i}" data-key="seconds">
              ${[4,5,6,8,10,12].map(n => `<option value="${n}" ${s.seconds == n ? 'selected' : ''}>${n}s</option>`).join('')}
            </select>
            <select data-type="${type}" data-idx="${i}" data-key="size">
              <option value="720P" ${s.size === '720P' ? 'selected' : ''}>720P</option>
              <option value="1080P" ${s.size === '1080P' ? 'selected' : ''}>1080P</option>
            </select>`}
          </div>

          <button class="btn-gen" data-type="${type}" data-idx="${i}">Générer cette ${isImg ? 'image' : 'scène'}</button>
          ${s.videoUrl ? `<video controls src="${s.videoUrl}"></video>` : ''}
        </div>
      `;
    }).join('');

    c.querySelectorAll('textarea').forEach(el => el.addEventListener('input', e => {
      const t = e.target.dataset.type, idx = e.target.dataset.idx;
      const a = t === 'image' ? state.imageScenes : t === 'video' ? state.videoScenes : state.storyScenes;
      a[idx].prompt = e.target.value; save();
    }));
    c.querySelectorAll('select').forEach(el => el.addEventListener('change', e => {
      const t = e.target.dataset.type, idx = e.target.dataset.idx, key = e.target.dataset.key;
      const a = t === 'image' ? state.imageScenes : t === 'video' ? state.videoScenes : state.storyScenes;
      a[idx][key] = e.target.value; save();
    }));
    c.querySelectorAll('.btn-upload').forEach((el, i) => {
      const input = c.querySelector(`#${type}-ref-${i}`);
      if (input) input.addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = ev => { 
          const a = type === 'image' ? state.imageScenes : type === 'video' ? state.videoScenes : state.storyScenes;
          a[i].imageBase64 = ev.target.result; renderScenes(type); save(); 
        };
        r.readAsDataURL(f);
      });
    });
    c.querySelectorAll('.btn-gen').forEach(el => el.addEventListener('click', e => {
      const t = e.target.dataset.type, idx = e.target.dataset.idx;
      generate(t, idx);
    }));
  }

  // ==========================================
  // LOGIQUE DE GÉNÉRATION
  // ==========================================
  async function generate(type, idx) {
    const a = type === 'image' ? state.imageScenes : type === 'video' ? state.videoScenes : state.storyScenes;
    const s = a[idx];
    if (!s.prompt) return alert('Écris un prompt.');
    
    s.status = 'loading'; renderScenes(type);

    try {
      if (type === 'image') {
        const body = { prompt: s.prompt, size: s.size || '2K', ratio: s.ratio, n: 1 };
        if (s.imageBase64) { body.mode = 'img2img'; body.referenceImages = [s.imageBase64]; }
        const res = await api('/image', { method: 'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (data.images?.[0]) {
          state.imageHistory.unshift({ url: data.images[0].url, size: s.size, ratio: s.ratio });
          s.status = 'success';
        }
      } else {
        const body = { prompt: s.prompt, seconds: String(s.seconds || 8), size: s.size || '720P', aspect_ratio: s.ratio };
        if (s.imageBase64) { body.mode = 'img2video'; body.first_frame = s.imageBase64; }
        const res = await api('/video', { method: 'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (!data.video_id) throw new Error('Erreur ID');
        
        let attempts = 0;
        while (attempts < 90) {
          attempts++; await new Promise(r => setTimeout(r, 3000));
          const pRes = await api(`/video/status?video_id=${data.video_id}&model=${data.model}`);
          const pData = await pRes.json();
          if (pData.status === 'completed') { s.status = 'success'; s.videoUrl = pData.video_url; break; }
          if (pData.status === 'failed') throw new Error('Échec');
        }
        if (attempts >= 90) throw new Error('Timeout');
      }
    } catch(e) { s.status = 'error'; alert(e.message); }
    
    save(); renderScenes(type);
    renderHistory();
  }// ==========================================
  // LOGIQUE CHAT
  // ==========================================
  function newChat(welcome = null) {
    const c = { id: Date.now().toString(), title: 'Discussion', messages: [] };
    if (welcome) c.messages.push({ role: 'assistant', content: welcome });
    state.chatSessions.unshift(c); state.currentChatId = c.id;
    renderChatList(); renderChatMessages(); save();
  }

  function renderChatList() {
    const l = $('#chat-history-list'); if (!l) return;
    l.innerHTML = state.chatSessions.map(s => `
      <div class="history-chip ${s.id === state.currentChatId ? 'active' : ''}" data-id="${s.id}">${s.title}</div>
    `).join('');
    l.querySelectorAll('.history-chip').forEach(el => {
      el.onclick = () => { state.currentChatId = el.dataset.id; renderChatList(); renderChatMessages(); };
    });
  }

  function renderChatMessages() {
    const box = $('#chat-messages'); const sess = state.chatSessions.find(s => s.id === state.currentChatId);
    if (!box || !sess) return;
    box.innerHTML = sess.messages.map(m => {
      let content = typeof m.content === 'string' ? m.content : '';
      if (Array.isArray(m.content)) m.content.forEach(c => { if (c.type === 'text') content += c.text; });
      return `<div class="msg ${m.role}">${content.replace(/\n/g, '<br>')}</div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat(text) {
    const sess = state.chatSessions.find(s => s.id === state.currentChatId); if (!sess) return;
    sess.messages.push({ role: 'user', content: text });
    if (sess.title === 'Discussion') sess.title = text.substring(0, 20);
    renderChatList(); renderChatMessages();
    
    const box = $('#chat-messages'); const placeholder = document.createElement('div');
    placeholder.className = 'msg assistant'; placeholder.textContent = '...'; box.appendChild(placeholder);

    try {
      const res = await api('/chat', { method: 'POST', body: JSON.stringify({ messages: sess.messages.slice(-15), stream: true }) });
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let full = '', buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim(); if (data === '[DONE]') continue;
            try { 
              const p = JSON.parse(data); const delta = p.choices?.[0]?.delta?.content || '';
              if (delta) { full += delta; placeholder.innerHTML = full.replace(/\n/g, '<br>'); box.scrollTop = box.scrollHeight; }
            } catch(e) {}
          }
        }
      }
      sess.messages.push({ role: 'assistant', content: full }); save();
    } catch(err) { placeholder.textContent = `❌ ${err.message}`; }
  }

  // ==========================================
  // HISTORIQUES (Images & Vidéos)
  // ==========================================
  function renderHistory() {
    const hi = $('#image-history');
    if (hi) hi.innerHTML = state.imageHistory.map(img => `
      <div class="item"><img src="${img.url}"><a href="${img.url}" download class="item-btn">⬇ Télécharger</a></div>
    `).join('');
    
    const hv = $('#video-history');
    if (hv) hv.innerHTML = state.videoScenes.filter(s => s.videoUrl).map(v => `
      <div class="item"><video controls src="${v.videoUrl}"></video><a href="${v.videoUrl}" download class="item-btn">⬇ Télécharger</a></div>
    `).join('');

    const hs = $('#story-history');
    if (hs) hs.innerHTML = state.storyScenes.filter(s => s.videoUrl).map(v => `
      <div class="item"><video controls src="${v.videoUrl}"></video><a href="${v.videoUrl}" download class="item-btn">⬇ Télécharger</a></div>
    `).join('');
  }

  // ==========================================
  // INITIALISATION
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    load();
    
    // Login
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const key = $('#api-key').value.trim();
      const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = '...';
      try {
        const res = await fetch('/api/validate-key', { method: 'POST', headers: { 'Authorization': `Bearer ${key}` } });
        const d = await res.json(); if (!res.ok || !d.valid) throw new Error();
        state.apiKey = key;
        $('#welcome').classList.add('hidden'); $('#app').classList.remove('hidden');
        
        if (state.chatSessions.length === 0) {
          newChat(`Bienvenue sur IA MASTOR 🚀\n\nJe suis ton mentor créatif. Voici ce que je peux faire :\n\n💬 Chat : Idées et scripts.\n🖼️ Image : Visuels (1K/2K/4K).\n🎬 Vidéo : Scènes virales.\n📖 Histoire : Récits complets.\n\n*Conseil : Sois régulier sur TikTok/Insta, c'est la clé.*`);
        } else { renderChatList(); renderChatMessages(); }

        if (!state.imageScenes || state.imageScenes.length === 0) state.imageScenes = [{ prompt: '', size: '2K', ratio: '16:9', status: 'pending' }];
        if (!state.videoScenes || state.videoScenes.length === 0) state.videoScenes = [{ prompt: '', seconds: '8', ratio: '9:16', size: '720P', status: 'pending' }];
        if (!state.storyScenes || state.storyScenes.length === 0) state.storyScenes = [{ prompt: '', seconds: '8', ratio: '9:16', size: '720P', status: 'pending' }];
        
        renderScenes('image'); renderScenes('video'); renderScenes('story'); renderHistory();
      } catch(err) { $('#login-error').textContent = 'Clé invalide'; btn.disabled = false; btn.textContent = 'Démarrer'; }
    };

    // Navigation
    document.querySelectorAll('.nav-btn, .mob-btn').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.nav-btn, .mob-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll(`[data-tab="${b.dataset.tab}"]`).forEach(x => x.classList.add('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`#tab-${b.dataset.tab}`).classList.add('active');
      };
    });

    // Chat
    $('#new-chat-btn').onclick = () => newChat();
    $('#chat-form').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#chat-input').value.trim(); if (!v) return;
      $('#chat-input').value = ''; sendChat(v);
    };
    $('#chat-file-btn').onclick = () => $('#chat-file').click();
    $('#chat-file').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => { state.chatImageBase64 = ev.target.result; $('#chat-input').placeholder = '📷 Image jointe'; };
      r.readAsDataURL(f);
    };

    // Ajouter des prompts
    $('#add-image-prompt').onclick = () => {
      state.imageScenes.push({ prompt: '', size: '2K', ratio: '16:9', status: 'pending' });
      renderScenes('image'); save();
    };
    $('#add-scene-video').onclick = () => {
      state.videoScenes.push({ prompt: '', seconds: '8', ratio: '9:16', size: '720P', status: 'pending' });
      renderScenes('video'); save();
    };
    $('#add-story-scene').onclick = () => {
      state.storyScenes.push({ prompt: '', seconds: '8', ratio: '9:16', size: '720P', status: 'pending' });
      renderScenes('story'); save();
    };
    
    // Champs du mode Histoire
    $('#story-synopsis').oninput = e => { save(); };
    document.querySelectorAll('.char-row input[type="text"]').forEach((el, i) => {
      el.oninput = e => { state.storyChars[i].name = e.target.value; save(); };
    });
    document.querySelectorAll('.char-row input[type="file"]').forEach((el, i) => {
      el.onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = (ev) => { 
          state.storyChars[i].img = ev.target.result; 
          const btn = document.querySelector(`#char-btn-${i}`);
          if(btn) btn.innerHTML = '✅';
          save(); 
        };
        r.readAsDataURL(f);
      };
    });
  });

})();
