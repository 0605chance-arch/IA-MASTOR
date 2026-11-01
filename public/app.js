(function () {
  'use strict';

  const state = {
    apiKey: null, chatSessions: [], currentChatId: null, imageHistory: [],
    videoScenes: [], storyScenes: [], imageScenes: [], storyChars: [{name:'', img:null},{name:'', img:null},{name:'', img:null}],
    chatImageBase64: null 
  };

  const $ = s => document.querySelector(s);

  function save() {
    try { localStorage.setItem('iamastor_final_v24', JSON.stringify({
      chatSessions: state.chatSessions, imageHistory: state.imageHistory.slice(0, 30),
      videoScenes: state.videoScenes, storyScenes: state.storyScenes, imageScenes: state.imageScenes, storyChars: state.storyChars
    })); } catch(e){}
  }

  function load() {
    try {
      const s = localStorage.getItem('iamastor_final_v24');
      if (s) { const p = JSON.parse(s); Object.assign(state, p); }
      if (!state.imageScenes?.length) state.imageScenes = [{ prompt: '', size: '4K', ratio: '16:9', status: 'pending' }];
      if (!state.videoScenes?.length) state.videoScenes = Array.from({length: 10}, () => ({ prompt: '', seconds: '8', ratio: '9:16', status: 'pending' }));
      if (!state.storyScenes?.length) state.storyScenes = Array.from({length: 10}, () => ({ prompt: '', seconds: '8', ratio: '9:16', status: 'pending' }));
    } catch(e){}
  }

  async function api(url, options = {}) {
    if (!state.apiKey) throw new Error('Clé manquante');
    const res = await fetch(`/api${url}`, { ...options, headers: { 'Authorization': `Bearer ${state.apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
    if (!res.ok) { const e = await res.json().catch(()=>({error:'Erreur API'})); throw new Error(e.error || 'Erreur API'); }
    return res;
  }

  function downloadFile(url, id) { 
    if (!url && !id) return; 
    window.location.href = `/api/download/${id || 'media'}?url=${encodeURIComponent(url || '')}`;
  }

  // --- SCENES RENDERING ---
  function renderScenes(type) {
    const isImg = type === 'image';
    const c = $(`#${type}-scenes`); if (!c) return;
    const arr = isImg ? state.imageScenes : (type === 'video' ? state.videoScenes : state.storyScenes);
    if (!arr?.length) { c.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Aucune scène.</p>'; return; }

    c.innerHTML = arr.map((s, i) => {
      let status = '';
      if (s.status === 'loading') status = '⏳ En cours...';
      else if (s.status === 'error') status = '❌ Erreur';
      else if (s.status === 'success') status = '✅ Prêt';
      else status = '⏸ En attente';

      return `
        <div class="scene">
          <div class="scene-head"><span>SCÈNE ${i+1}</span><span>${status}</span></div>
          <textarea placeholder="Décris cette scène..." data-type="${type}" data-idx="${i}">${s.prompt || ''}</textarea>
          <input type="file" accept="image/*" hidden id="${type}-ref-${i}">
          <label for="${type}-ref-${i}" class="btn-upload" style="display:block;padding:10px;background:var(--bg);border-radius:8px;text-align:center;font-size:12px;margin-bottom:12px;cursor:pointer;">
            ${s.imageBase64 ? '✅ Image de référence jointe' : '📷 Joindre une image (Optionnel)'}
          </label>
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
            <select disabled><option>720P</option></select>`}
          </div>
          <button class="btn-gen" data-type="${type}" data-idx="${i}">Générer cette ${isImg ? 'image' : 'scène'}</button>
          ${s.videoUrl ? `<div style="margin-top:12px;"><video controls src="${s.videoUrl}" style="width:100%;border-radius:8px;margin-bottom:8px;"></video><button onclick="downloadFile('${s.videoUrl}', '${s.mediaId}')" style="width:100%;padding:10px;background:var(--surface-hover);border:1px solid var(--border);border-radius:8px;color:#fff;cursor:pointer;">⬇ Télécharger</button></div>` : ''}
        </div>
      `;
    }).join('');

    c.querySelectorAll('textarea').forEach(el => el.oninput = e => { const t = e.target.dataset.type, idx = e.target.dataset.idx; const a = t === 'image' ? state.imageScenes : t === 'video' ? state.videoScenes : state.storyScenes; a[idx].prompt = e.target.value; save(); });
    c.querySelectorAll('select[data-key]').forEach(el => el.onchange = e => { const t = e.target.dataset.type, idx = e.target.dataset.idx, key = e.target.dataset.key; const a = t === 'image' ? state.imageScenes : t === 'video' ? state.videoScenes : state.storyScenes; a[idx][key] = e.target.value; save(); });
    c.querySelectorAll('.btn-upload').forEach((el, i) => { const input = c.querySelector(`#${type}-ref-${i}`); if (input) input.onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { const a = type === 'image' ? state.imageScenes : type === 'video' ? state.videoScenes : state.storyScenes; a[i].imageBase64 = ev.target.result; renderScenes(type); save(); }; r.readAsDataURL(f); }; });
    c.querySelectorAll('.btn-gen').forEach(el => el.onclick = e => generate(e.target.dataset.type, e.target.dataset.idx));
  }

  // --- GENERATION ---
  async function generate(type, idx) {
    const a = type === 'image' ? state.imageScenes : type === 'video' ? state.videoScenes : state.storyScenes;
    const s = a[idx]; if (!s.prompt) return alert('Écris un prompt.');
    
    s.status = 'loading'; s.videoUrl = null;
    renderScenes(type);
    
    try {
      if (type === 'image') {
        const res = await api('/generate-image', { method: 'POST', body: JSON.stringify({ prompt: s.prompt, format: s.ratio, imageBase64: s.imageBase64 }) });
        const data = await res.json();
        if (data.url) {
          state.imageHistory.unshift({ url: data.url, size: '4K', ratio: s.ratio, id: data.id });
          s.status = 'success'; s.videoUrl = data.url; s.mediaId = data.id;
        } else throw new Error('Erreur image');
      } else {
        const body = { prompt: s.prompt, format: s.ratio, duration: s.seconds };
        if (s.imageBase64) body.imageBase64 = s.imageBase64;
        if (type === 'story') body.storyCharacters = state.storyChars;

        const res = await api('/generate-video', { method: 'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (!data.id) throw new Error('Erreur ID');

        const submittedAt = Date.now();
        
        // POLLING INTELLIGENT (délai initial de 25s géré côté serveur)
        const poll = setInterval(async () => {
          try {
            const pRes = await api(`/status/${data.id}?t=${submittedAt}`);
            const pData = await pRes.json();
            
            if (pData.status === 'completed' && pData.url) {
              clearInterval(poll);
              s.status = 'success'; s.videoUrl = pData.url; s.mediaId = data.id;
              renderScenes(type); renderHistory(); save();
            } else if (pData.status === 'failed') {
              clearInterval(poll);
              s.status = 'error'; renderScenes(type); save();
            }
          } catch (err) { 
            console.warn('Polling erreur:', err.message); 
          }
        }, 3000);
        return;
      }
    } catch (e) { 
      s.status = 'error'; 
      console.error("Erreur generation:", e); 
    }
    save(); renderScenes(type); renderHistory();
  }

  // --- CHAT ---
  function newChat(welcome = null) {
    const c = { id: Date.now().toString(), title: 'Discussion', messages: [] };
    if (welcome) c.messages.push({ role: 'assistant', content: welcome });
    state.chatSessions.unshift(c); state.currentChatId = c.id; renderChatList(); renderChatMessages(); save();
  }

  function deleteChat(id) {
    state.chatSessions = state.chatSessions.filter(s => s.id !== id);
    if (state.currentChatId === id) state.currentChatId = state.chatSessions[0]?.id || null;
    renderChatList(); renderChatMessages(); save();
  }

  function renderChatList() {
    const l = $('#chat-history-list'); if (!l) return;
    l.innerHTML = state.chatSessions.map(s => `
      <div class="history-chip ${s.id === state.currentChatId ? 'active' : ''}" data-id="${s.id}">
        ${s.title}
        <span class="delete-chat" data-id="${s.id}" style="margin-left:8px;color:#ef4444;cursor:pointer;">✕</span>
      </div>
    `).join('');
    l.querySelectorAll('.history-chip').forEach(el => el.onclick = (e) => { 
      if (e.target.classList.contains('delete-chat')) { deleteChat(e.target.dataset.id); return; }
      state.currentChatId = el.dataset.id; renderChatList(); renderChatMessages(); 
    });
  }

  function renderChatMessages() {
    const box = $('#chat-messages'); const sess = state.chatSessions.find(s => s.id === state.currentChatId);
    if (!box || !sess) { if(box) box.innerHTML = ''; return; }
    box.innerHTML = sess.messages.map(m => `<div class="msg ${m.role}">${(typeof m.content === 'string' ? m.content : '').replace(/\n/g, '<br>')}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat(text) {
    const sess = state.chatSessions.find(s => s.id === state.currentChatId); if (!sess) return;
    sess.messages.push({ role: 'user', content: text });
    if (sess.title === 'Discussion') sess.title = text.substring(0, 20);
    renderChatList(); renderChatMessages();
    const box = $('#chat-messages'); const ph = document.createElement('div'); ph.className = 'msg assistant'; ph.textContent = '...'; box.appendChild(ph);
    
    try {
      const body = { messages: sess.messages.slice(-15), stream: true };
      if (state.chatImageBase64) body.imageBase64 = state.chatImageBase64;

      const res = await api('/chat', { method: 'POST', body: JSON.stringify(body) });
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let full = '', buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim(); if (data === '[DONE]') continue;
            try { const p = JSON.parse(data); const delta = p.choices?.[0]?.delta?.content || ''; if (delta) { full += delta; ph.innerHTML = full.replace(/\n/g, '<br>'); box.scrollTop = box.scrollHeight; } } catch(e) {}
          }
        }
      }
      sess.messages.push({ role: 'assistant', content: full }); save();
    } catch(err) { ph.textContent = `❌ ${err.message}`; }
    
    state.chatImageBase64 = null;
    $('#chat-input').placeholder = 'Écris ton message...';
  }

  function renderHistory() {
    const hi = $('#image-history'); if (hi) hi.innerHTML = state.imageHistory.map(img => `<div class="item"><img src="${img.url}"><button onclick="downloadFile('${img.url}', '${img.id}')" class="item-btn" style="cursor:pointer;border:none;width:100%;">⬇ Télécharger</button></div>`).join('');
    const hv = $('#video-history'); if (hv) hv.innerHTML = state.videoScenes.filter(s => s.videoUrl).map(v => `<div class="item"><video controls src="${v.videoUrl}"></video><button onclick="downloadFile('${v.videoUrl}', '${v.mediaId}')" class="item-btn" style="cursor:pointer;border:none;width:100%;">⬇ Télécharger</button></div>`).join('');
    const hs = $('#story-history'); if (hs) hs.innerHTML = state.storyScenes.filter(s => s.videoUrl).map(v => `<div class="item"><video controls src="${v.videoUrl}"></video><button onclick="downloadFile('${v.videoUrl}', '${v.mediaId}')" class="item-btn" style="cursor:pointer;border:none;width:100%;">⬇ Télécharger</button></div>`).join('');
  }

  window.downloadFile = downloadFile;

  // --- INITIALISATION ---
  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault(); const key = $('#api-key').value.trim(); const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = '...';
      try {
        const res = await fetch('/api/validate-key', { method: 'POST', headers: { 'Authorization': `Bearer ${key}` } });
        const d = await res.json(); if (!res.ok || !d.valid) throw new Error();
        state.apiKey = key; $('#welcome').classList.add('hidden'); $('#app').classList.remove('hidden');
        
        if (state.chatSessions.length === 0) {
          newChat(`Bienvenue sur IA MASTOR 🚀\n\nJe suis ton mentor IA. Voici ce que je peux générer :\n\n🎬 Vidéos IA : 500 sec/jour.\n🖼️ Images HD : 4000/jour.\n💬 Textes & Scripts.\n\n*Conseil : Sois régulier sur TikTok/Insta.*`);
        } else { renderChatList(); renderChatMessages(); }
        
        renderScenes('image'); renderScenes('video'); renderScenes('story'); renderHistory();
      } catch(err) { $('#login-error').textContent = 'Clé invalide'; btn.disabled = false; btn.textContent = 'Démarrer'; }
    };

    document.querySelectorAll('.nav-btn, .mob-btn').forEach(b => b.onclick = () => { document.querySelectorAll('.nav-btn, .mob-btn').forEach(x => x.classList.remove('active')); document.querySelectorAll(`[data-tab="${b.dataset.tab}"]`).forEach(x => x.classList.add('active')); document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); document.querySelector(`#tab-${b.dataset.tab}`).classList.add('active'); });

    $('#new-chat-btn').onclick = () => newChat();
    $('#chat-form').onsubmit = (e) => { e.preventDefault(); const v = $('#chat-input').value.trim(); if (!v) return; $('#chat-input').value = ''; sendChat(v); };
    $('#chat-file-btn').onclick = () => $('#chat-file').click();
    $('#chat-file').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => { state.chatImageBase64 = ev.target.result; $('#chat-input').placeholder = '📷 Image jointe'; }; r.readAsDataURL(f); };

    $('#add-image-prompt').onclick = () => { state.imageScenes.push({ prompt: '', size: '4K', ratio: '16:9', status: 'pending' }); renderScenes('image'); save(); };

    $('#story-synopsis').oninput = () => save();
    document.querySelectorAll('.char-row input[type="text"]').forEach((el, i) => el.oninput = e => { state.storyChars[i].name = e.target.value; save(); });
    document.querySelectorAll('.char-row input[type="file"]').forEach((el, i) => el.onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => { state.storyChars[i].img = ev.target.result; const btn = document.querySelector(`#char-btn-${i}`); if(btn) btn.innerHTML = '✅'; save(); }; r.readAsDataURL(f); });
  });
})();
