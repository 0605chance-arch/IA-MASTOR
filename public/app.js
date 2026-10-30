/**
 * IA MASTOR - Frontend Application Logic
 * BYOK (Bring Your Own Key) - Agnes Starter Plan optimized
 * 
 * Features:
 * - Key validation with welcome message
 * - Chat with streaming SSE
 * - Image generation (1K/2K/3K/4K) with 10 prompts + history
 * - Video generation (720P only on Flash) with async polling
 * - Story mode with context memory + 15 themes
 * - French UI (English toggle ready if free)
 * - Anti-resale footer notice
 */

(function () {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    apiKey: null,
    isKeyValid: false,
    currentTab: 'chat',
    language: 'fr',

    // Chat
    chatMessages: [],

    // Image
    imageHistory: [],
    imagePresets: [
      'Portrait cinématographique, éclairage dramatique, ultra détaillé, 8K, photoréaliste',
      'Paysage futuriste, ville cyberpunk sous la pluie, néons, réflexions, cinéma',
      'Produit de luxe sur fond noir, éclairage studio, macro, publicité haut de gamme',
      'Créature fantastique dans une forêt enchantée, brume, lumière divine, épique',
      'Architecture moderne minimaliste, lumière naturelle, design épuré, magazine',
      'Scène de rue animée à Tokyo, nightlife, bokeh, style documentaire',
      'Nature morte florale, peinture à l\'huile, clair-obscur, musée',
      'Astronaute dans une station spatiale, Terre visible, réalisme NASA',
      'Mode streetwear urbain, graffiti, attitude, flash direct, argentique',
      'Univers sous-marin, bioluminescence, créatures étranges, profondeur',
    ],

    // Video
    videoHistory: [],
    videoPresets: [
      'Travelling avant dans une rue futuriste, néons roses et bleus, pluie fine, réflexions au sol, cinéma 4K',
      'Gros plan sur un visage humain, émotion intense, larmes aux yeux, éclairage Rembrandt, slow motion',
      'Drone au-dessus d\'une forêt tropicale, cascade, rayons de soleil à travers les feuilles, nature sauvage',
      'Produit tech en rotation lente sur fond noir, éclairage studio, reflets métalliques, publicité',
      'Créature mythique survolant des montagnes enneigées, ailes déployées, vent, épopée',
      'Scène de couple dans un restaurant étoilé, bougies, regards amoureux, luxe discret',
      'Sneakers en apesanteur, rotation, éclairage néon, culture urbaine, hype',
      'Animal humanisé portant un costume, bureau, ambiance corporate humoristique',
      'Vue aérienne d\'une mégalopole la nuit, circulation, lumières, time-lapse',
      'Transformation avant/après d\'une pièce, design intérieur, révélation, satisfaction',
    ],

    // Story
    storyMessages: [],
    storyState: {
      synopsis: '',
      characters: [
        { name: '', description: '' },
        { name: '', description: '' },
        { name: '', description: '' },
      ],
      prompts: [],
      theme: null,
    },

    // UI
    isLoading: false,
    videoPolling: null, // { videoId, model, intervalId }
  };

  // ============================================================
  // 15 STORY THEMES (from user specification)
  // ============================================================
  const STORY_THEMES = [
    'Histoires de fruits IA (Fruit Story)',
    'Business automatisé avec l\'IA',
    'UGC IA et influenceurs virtuels',
    'Luxe, richesse et vie de millionnaire',
    'Couples toxiques et trahisons',
    'Animaux humanisés et histoires virales',
    'Influenceurs IA et célébrité virtuelle',
    'Transformation avant / après avec l\'IA',
    'Histoires Reddit et secrets inavouables',
    'Mini-séries dramatiques TikTok',
    'Streetwear, sneakers et culture urbaine',
    'Food IA et recettes impossibles',
    'Motivation, discipline et réussite financière',
    'Univers futuristes et intelligence artificielle',
    'Business e-commerce et revenus passifs',
  ];

  // ============================================================
  // DOM HELPERS
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
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================
  // API LAYER (BYOK - all requests include user's key)
  // ============================================================
  async function apiRequest(endpoint, options = {}) {
    if (!state.apiKey) {
      throw new Error('NO_API_KEY');
    }

    const url = `/api${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${state.apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      const error = new Error(errBody.error || `Request failed: ${res.status}`);
      error.status = res.status;
      error.details = errBody;
      throw error;
    }

    return res;
  }

  // ============================================================
  // KEY VALIDATION
  // ============================================================
  async function validateKey(key) {
    const res = await fetch('/api/validate-key', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    if (!res.ok || !data.valid) {
      throw new Error(data.error || 'Clé invalide');
    }
    return data;
  }

  // ============================================================
  // CHAT
  // ============================================================
  async function sendChatMessage(userContent) {
    state.chatMessages.push({ role: 'user', content: userContent });

    // Add UI placeholder
    const assistantDiv = addChatMessageToUI('assistant', '');
    assistantDiv.classList.add('typing');

    try {
      const res = await apiRequest('/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: state.chatMessages.slice(-20),
          stream: true,
        }),
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
            } catch (e) {
              // Skip malformed SSE
            }
          }
        }
      }

      assistantDiv.classList.remove('typing');
      state.chatMessages.push({ role: 'assistant', content: fullContent });

      // Check for image generation intent in chat (bonus: generate image inline if requested)
      if (shouldGenerateImageFromChat(userContent)) {
        addChatMessageToUI('system', '💡 Astuce : utilise l\'onglet **Image** pour générer ce visuel en haute résolution (jusqu\'à 4K).');
      }
    } catch (err) {
      assistantDiv.classList.remove('typing');
      assistantDiv.textContent = `❌ Erreur : ${err.message}`;
      state.chatMessages.pop(); // remove user message on failure
    }
  }

  function shouldGenerateImageFromChat(text) {
    const lower = text.toLowerCase();
    return (lower.includes('image') || lower.includes('photo') || lower.includes('dessine') || lower.includes('génère')) &&
           (lower.includes('montre') || lower.includes('fais') || lower.includes('crée'));
  }

  function addChatMessageToUI(role, content) {
    const container = $('#chat-messages');
    if (!container) return null;

    const div = el('div', { className: `chat-message ${role}` });
    div.innerHTML = `<div class="bubble">${role === 'assistant' ? '' : escapeHtml(content)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function updateChatMessageUI(div, content) {
    if (!div) return;
    const bubble = div.querySelector('.bubble');
    if (bubble) bubble.textContent = content;
    const container = $('#chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  // ============================================================
  // IMAGE GENERATION
  // ============================================================
  async function generateImage(prompt, size, ratio) {
    const res = await apiRequest('/image', {
      method: 'POST',
      body: JSON.stringify({
        prompt: prompt.trim(),
        size: size || '2K',
        ratio: ratio || '16:9',
        n: 1,
      }),
    });

    const data = await res.json();
    if (!data.success || !data.images || data.images.length === 0) {
      throw new Error('Aucune image générée');
    }

    const image = data.images[0];
    const entry = {
      id: Date.now(),
      prompt: prompt.trim(),
      size: data.size,
      ratio: data.ratio,
      url: image.url || image.b64,
      timestamp: new Date().toISOString(),
    };

    state.imageHistory.unshift(entry);
    if (state.imageHistory.length > 20) state.imageHistory.pop();

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
        <img src="${entry.url}" alt="${escapeHtml(entry.prompt)}" loading="lazy">
        <div class="history-meta">
          <span class="history-size">${entry.size} · ${entry.ratio}</span>
          <span class="history-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
        </div>
        <p class="history-prompt">${escapeHtml(entry.prompt.substring(0, 80))}${entry.prompt.length > 80 ? '…' : ''}</p>
        <div class="history-actions">
          <button class="btn-icon download-btn" data-url="${entry.url}" title="Télécharger">⬇</button>
          <button class="btn-icon reuse-btn" data-prompt="${escapeHtml(entry.prompt)}" title="Réutiliser">↻</button>
        </div>
      </div>
    `).join('');

    // Wire actions
    container.querySelectorAll('.download-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = btn.dataset.url;
        a.download = `ia-mastor-${Date.now()}.png`;
        a.target = '_blank';
        a.click();
      });
    });

    container.querySelectorAll('.reuse-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $('#image-prompt');
        if (input) input.value = btn.dataset.prompt;
      });
    });
  }

  // ============================================================
  // VIDEO GENERATION (ASYNC + POLLING)
  // ============================================================
  async function createVideoTask(prompt, seconds, aspectRatio) {
    // Starter Flash: size fixed 720P, seconds string "4"-"12"
    const res = await apiRequest('/video', {
      method: 'POST',
      body: JSON.stringify({
        prompt: prompt.trim(),
        seconds: String(Math.min(12, Math.max(4, parseInt(seconds) || 5))),
        size: '720P', // Flash only
        aspect_ratio: aspectRatio || '16:9',
        mode: 'text',
      }),
    });

    const data = await res.json();
    if (!data.success || !data.video_id) {
      throw new Error('Impossible de créer la tâche vidéo');
    }

    return data;
  }

  async function pollVideoStatus(videoId, model) {
    const res = await apiRequest(`/video/status?video_id=${encodeURIComponent(videoId)}&model=${encodeURIComponent(model)}`, {
      method: 'GET',
    });

    return res.json();
  }

  async function generateVideo(prompt, seconds, aspectRatio) {
    const task = await createVideoTask(prompt, seconds, aspectRatio);

    // Start UI polling indicator
    const statusEl = $('#video-status');
    if (statusEl) statusEl.textContent = '⏳ Génération en cours… (cela peut prendre 1–3 min)';

    // Poll with interval (2s as recommended)
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 90; // ~3 min at 2s
      const interval = 2000;

      const check = async () => {
        attempts++;
        try {
          const status = await pollVideoStatus(task.video_id, task.model);

          if (statusEl) {
            if (status.progress != null) {
              statusEl.textContent = `⏳ Génération : ${status.progress}%`;
            }
          }

          if (status.status === 'completed' && status.video_url) {
            if (statusEl) statusEl.textContent = '✅ Vidéo prête !';

            const entry = {
              id: Date.now(),
              prompt: prompt.trim(),
              seconds: String(seconds),
              aspectRatio: aspectRatio || '16:9',
              size: '720P',
              url: status.video_url,
              timestamp: new Date().toISOString(),
            };

            state.videoHistory.unshift(entry);
            if (state.videoHistory.length > 10) state.videoHistory.pop();

            renderVideoHistory();
            resolve(entry);
            return;
          }

          if (status.status === 'failed') {
            reject(new Error(status.error?.message || 'La génération vidéo a échoué.'));
            return;
          }

          if (attempts >= maxAttempts) {
            reject(new Error('Délai dépassé. La vidéo prend trop de temps, réessaie avec une durée plus courte.'));
            return;
          }

          setTimeout(check, interval);
        } catch (err) {
          if (attempts >= maxAttempts) {
            reject(err);
          } else {
            setTimeout(check, interval * 2); // backoff on error
          }
        }
      };

      setTimeout(check, interval);
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
        <div class="video-meta">
          <span>${entry.seconds}s · ${entry.aspectRatio} · ${entry.size}</span>
          <span>${new Date(entry.timestamp).toLocaleTimeString()}</span>
        </div>
        <p class="video-prompt">${escapeHtml(entry.prompt.substring(0, 100))}${entry.prompt.length > 100 ? '…' : ''}</p>
        <a href="${entry.url}" download class="btn-secondary" target="_blank">⬇ Télécharger</a>
      </div>
    `).join('');
  }

  // ============================================================
  // STORY MODE
  // ============================================================
  async function sendStoryMessage(userContent) {
    state.storyMessages.push({ role: 'user', content: userContent });

    const assistantDiv = addStoryMessageToUI('assistant', '');
    assistantDiv.classList.add('typing');

    try {
      const res = await apiRequest('/story', {
        method: 'POST',
        body: JSON.stringify({
          messages: state.storyMessages.slice(-20),
          storyState: state.storyState,
          theme: state.storyState.theme,
        }),
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
                updateStoryMessageUI(assistantDiv, fullContent);
              }
            } catch (e) {}
          }
        }
      }

      assistantDiv.classList.remove('typing');
      state.storyMessages.push({ role: 'assistant', content: fullContent });

      // Extract potential video prompts from response (lines starting with "PROMPT:")
      extractStoryPrompts(fullContent);
      updateStoryStateUI();
    } catch (err) {
      assistantDiv.classList.remove('typing');
      assistantDiv.textContent = `❌ Erreur : ${err.message}`;
      state.storyMessages.pop();
    }
  }

  function addStoryMessageToUI(role, content) {
    const container = $('#story-messages');
    if (!container) return null;

    const div = el('div', { className: `chat-message ${role}` });
    div.innerHTML = `<div class="bubble">${role === 'assistant' ? '' : escapeHtml(content)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function updateStoryMessageUI(div, content) {
    if (!div) return;
    const bubble = div.querySelector('.bubble');
    if (bubble) bubble.textContent = content;
    const container = $('#story-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  function extractStoryPrompts(text) {
    // Look for lines that look like video prompts (heuristic)
    const lines = text.split('\n');
    const newPrompts = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Detect "PROMPT:", "Prompt vidéo:", "Vidéo:" followed by content
      if (/^(PROMPT|Prompt vidéo|Vidéo|Video prompt)\s*[:：]/i.test(trimmed)) {
        const promptText = trimmed.replace(/^[^:：]+[:：]\s*/, '');
        if (promptText.length > 20) {
          newPrompts.push({ prompt: promptText, timestamp: new Date().toISOString() });
        }
      }
    }

    if (newPrompts.length > 0) {
      state.storyState.prompts.push(...newPrompts);
      if (state.storyState.prompts.length > 20) {
        state.storyState.prompts = state.storyState.prompts.slice(-20);
      }
    }
  }

  function updateStoryStateUI() {
    const synopsisEl = $('#story-synopsis');
    if (synopsisEl) synopsisEl.value = state.storyState.synopsis;

    const charEls = $$('.story-character-input');
    state.storyState.characters.forEach((c, i) => {
      if (charEls[i]) {
        charEls[i].value = c.name || '';
      }
    });

    const promptsEl = $('#story-prompts-list');
    if (promptsEl) {
      promptsEl.innerHTML = state.storyState.prompts.slice(-5).map((p, i) => `
        <div class="story-prompt-item">
          <span class="prompt-index">${i + 1}</span>
          <span class="prompt-text">${escapeHtml(typeof p === 'string' ? p : p.prompt)}</span>
        </div>
      `).join('');
    }
  }

  // ============================================================
  // TAB NAVIGATION
  // ============================================================
  function switchTab(tab) {
    state.currentTab = tab;

    // Update active nav
    $$('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update visible panel
    $$('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${tab}`);
    });

    // Lazy render
    if (tab === 'image') renderImageHistory();
    if (tab === 'video') renderVideoHistory();
    if (tab === 'story') {
      renderStoryThemes();
      updateStoryStateUI();
    }
  }

  function renderStoryThemes() {
    const select = $('#story-theme-select');
    if (!select || select.options.length > 1) return;

    STORY_THEMES.forEach(theme => {
      const opt = document.createElement('option');
      opt.value = theme;
      opt.textContent = theme;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => {
      state.storyState.theme = select.value || null;
    });
  }

  // ============================================================
  // INIT UI
  // ============================================================
  function showWelcomeScreen() {
    $('#welcome-screen').classList.remove('hidden');
    $('#main-app').classList.add('hidden');
  }

  function showMainApp(userName) {
    $('#welcome-screen').classList.add('hidden');
    $('#main-app').classList.remove('hidden');

    // Welcome message in chat
    addChatMessageToUI('assistant',
      `Bienvenue ${userName ? userName + ' ' : ''}sur **IA MASTOR** 🚀\n\nJe suis ton assistant créatif propulsé par Agnes. Je peux :\n\n• 💬 Discuter et t'aider sur tous les sujets\n• 🖼️ Générer des images jusqu'en **4K**\n• 🎬 Créer des vidéos réalistes en **720P**\n• 📖 Écrire des histoires complètes avec continuité\n\nTa clé est validée. Tout est prêt.\n\n*Après achat, cette application est interdite à la revente.*`
    );
  }

  function setupEventListeners() {
    // Welcome / key validation
    const keyForm = $('#key-form');
    if (keyForm) {
      keyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const keyInput = $('#api-key-input');
        const errorEl = $('#key-error');
        const submitBtn = $('#key-submit');

        const key = keyInput.value.trim();
        if (!key) {
          errorEl.textContent = 'Colle ta clé Agnes.';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Validation…';
        errorEl.textContent = '';

        try {
          const result = await validateKey(key);
          state.apiKey = key;
          state.isKeyValid = true;

          // Extract name from message if available
          const match = result.message?.match(/Bienvenue sur IA MASTOR/);
          showMainApp();
        } catch (err) {
          errorEl.textContent = err.message || 'Clé invalide. Vérifie et réessaie.';
          state.apiKey = null;
          state.isKeyValid = false;
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Accéder à IA MASTOR';
        }
      });
    }

    // Tab navigation
    $$('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Chat send
    const chatForm = $('#chat-form');
    if (chatForm) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('#chat-input');
        const msg = input.value.trim();
        if (!msg || state.isLoading) return;

        input.value = '';
        state.isLoading = true;
        try {
          await sendChatMessage(msg);
        } finally {
          state.isLoading = false;
        }
      });
    }

    // Chat enter key (shift+enter for newline)
    const chatInput = $('#chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          chatForm.dispatchEvent(new Event('submit'));
        }
      });
    }

    // Image preset buttons
    $$('.preset-btn[data-target="image"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $('#image-prompt');
        if (input) input.value = btn.dataset.prompt;
      });
    });

    // Image generate
    const imageForm = $('#image-form');
    if (imageForm) {
      imageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const prompt = $('#image-prompt').value.trim();
        const size = $('#image-size').value;
        const ratio = $('#image-ratio').value;

        if (!prompt) return;

        const btn = imageForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Génération…';

        try {
          const entry = await generateImage(prompt, size, ratio);
          // Show result preview
          const preview = $('#image-preview');
          if (preview) {
            preview.innerHTML = `<img src="${entry.url}" alt="Résultat">`;
          }
        } catch (err) {
          alert(`Erreur image : ${err.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Générer l\'image';
        }
      });
    }

    // Video preset buttons
    $$('.preset-btn[data-target="video"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $('#video-prompt');
        if (input) input.value = btn.dataset.prompt;
      });
    });

    // Video generate
    const videoForm = $('#video-form');
    if (videoForm) {
      videoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const prompt = $('#video-prompt').value.trim();
        const seconds = $('#video-seconds').value;
        const ratio = $('#video-ratio').value;

        if (!prompt) return;

        const btn = videoForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Création de la tâche…';

        try {
          const entry = await generateVideo(prompt, seconds, ratio);
          const preview = $('#video-preview');
          if (preview) {
            preview.innerHTML = `<video controls autoplay src="${entry.url}" style="max-width:100%;border-radius:12px;"></video>`;
          }
        } catch (err) {
          alert(`Erreur vidéo : ${err.message}`);
          const statusEl = $('#video-status');
          if (statusEl) statusEl.textContent = `❌ ${err.message}`;
        } finally {
          btn.disabled = false;
          btn.textContent = 'Générer la vidéo';
        }
      });
    }

    // Story send
    const storyForm = $('#story-form');
    if (storyForm) {
      storyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('#story-input');
        const msg = input.value.trim();
        if (!msg || state.isLoading) return;

        input.value = '';
        state.isLoading = true;
        try {
          await sendStoryMessage(msg);
        } finally {
          state.isLoading = false;
        }
      });
    }

    // Story state inputs
    const synopsisInput = $('#story-synopsis');
    if (synopsisInput) {
      synopsisInput.addEventListener('input', () => {
        state.storyState.synopsis = synopsisInput.value;
      });
    }

    $$('.story-character-input').forEach((input, i) => {
      input.addEventListener('input', () => {
        if (state.storyState.characters[i]) {
          state.storyState.characters[i].name = input.value;
        }
      });
    });
  }

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    showWelcomeScreen();

    // Anti-resale footer is static in HTML; ensure it exists
    if (!document.querySelector('.anti-resale-footer')) {
      const footer = el('p', {
        className: 'anti-resale-footer',
        textContent: 'Après achat, cette application est interdite à la vente.',
      });
      document.body.appendChild(footer);
    }
  });

  // Expose for debugging (optional)
  window.__IA_MASTOR__ = { state, STORY_THEMES };
})();
