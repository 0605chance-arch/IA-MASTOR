<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>🚀 SPEED IA ♾️ — Studio Premium</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <div id="api-modal" class="modal" hidden>
    <div class="modal-card">
      <h2>🔑 Clé API Agnès</h2>
      <p class="modal-desc">Votre token est stocké uniquement en <strong>sessionStorage</strong>.</p>
      <p class="modal-wakeup">☕️ <strong>Premier démarrage :</strong> l'app peut mettre jusqu'à <strong>1 minute</strong> à se réveiller (serveur Render). Merci de patienter, ne cliquez pas plusieurs fois.</p>
      <input type="password" id="api-key-input" class="input-field" placeholder="Collez votre token Agnès…" autocomplete="off">
      <div id="api-key-status" class="api-status"></div>
      <div class="modal-actions">
        <button id="api-key-save" class="btn-primary">Valider &amp; continuer</button>
      </div>
    </div>
  </div>

  <div class="app">
    <header class="header">
      <div class="header-top">
        <div class="logo">🚀 SPEED IA ♾️</div>
        <button id="api-key-btn" class="api-btn" title="Changer la clé API">
          <span class="api-dot" id="api-dot"></span> 🔑
        </button>
      </div>
      <p class="tagline">Chat • Image • Vidéo • Studio</p>
      <div class="wakeup-banner" id="wakeup-banner">
        <span>☕️</span>
        <span>Le serveur peut mettre jusqu'à <strong>1 minute</strong> à se réveiller au premier démarrage. Laissez l'app se réveiller, ne cliquez pas plusieurs fois.</span>
        <button id="wakeup-banner-close" aria-label="Fermer">×</button>
      </div>
    </header>

    <div class="tabs">
      <button id="tab-chat"  class="tab-btn active">💬 Chat</button>
      <button id="tab-image" class="tab-btn">🖼️ Image</button>
      <button id="tab-video" class="tab-btn">🎬 Vidéo</button>
      <button id="tab-studio" class="tab-btn">🎥 Studio</button>
    </div>

    <main class="main">
      <section id="section-chat" class="section active">
        <div class="chat-layout">
          <aside class="chat-sidebar" id="chat-sidebar">
            <button id="new-chat-btn" class="btn-secondary" style="width:100%; margin-bottom:10px;">+ Nouvelle conversation</button>
            <div id="chat-sessions-list" class="sessions-list"></div>
          </aside>
          <div class="chat-main">
            <div id="chat-history" class="chat-history"></div>
            <div class="chat-input-area">
              <input type="file" id="chat-image-upload" accept="image/*" hidden>
              <button id="chat-image-btn" class="btn-secondary" style="padding: 10px 14px; border-radius: 50%;">📷</button>
              <textarea id="chat-input" placeholder="Envoyez un message…" rows="1"></textarea>
              <button id="chat-send" class="btn-primary">⬆️</button>
            </div>
          </div>
        </div>
      </section>

      <section id="section-image" class="section">
        <div class="info-banner info-banner-warning">
          <span class="info-icon">⚠️</span>
          <p>
            <strong>Ne spammez pas le bouton « Générer ».</strong> En cas de message d'erreur, ne recliquez pas.
            Faites dans cet ordre : <strong>1)</strong> Actualisez la page (Render / App),
            <strong>2)</strong> Attendez <strong>1 minute</strong>,
            <strong>3)</strong> Relancez une génération.
          </p>
        </div>
        <div class="card">
          <textarea id="image-prompt" class="input-field" rows="3" placeholder="Décrivez l'image à générer…"></textarea>
          <div class="upload-area">
            <input type="file" id="image-upload" accept="image/*" hidden>
            <button id="image-upload-btn" class="btn-secondary">📷 Image de référence</button>
            <div id="image-preview" class="preview"></div>
          </div>
          <select id="image-format" class="input-field">
            <option value="9:16">Portrait (9:16)</option>
            <option value="16:9">Large (16:9)</option>
            <option value="1:1">Carré (1:1)</option>
          </select>
          
          <select id="image-quality" class="input-field">
            <option value="1K">Qualité Standard (1K)</option>
            <option value="2K">Haute Définition (2K)</option>
            <option value="4K">Ultra HD (4K)</option>
          </select>
          
          <button id="image-generate" class="btn-primary">Générer l'image</button>
        </div>
        <div id="image-result-area" class="result-area" hidden>
          <img id="image-result" src="" alt="Résultat">
          <a id="image-download" class="btn-download" download>Télécharger</a>
        </div>
        <div class="history-section">
          <h3>Historique des images</h3>
          <div id="image-history" class="history-grid"></div>
        </div>
      </section>

      <section id="section-video" class="section">
        <div class="info-banner">
          <span class="info-icon">💡</span>
          <p>
            <strong>Astuce :</strong> Utilisez les prompts du <strong>Studio</strong> pour créer vos vidéos ici.<br>
            <strong>Note :</strong> L'API Agnès autorise <strong>5 requêtes par minute</strong> (5 clics). Si vous dépassez, l'app attendra automatiquement la minute suivante.
          </p>
        </div>
        <div class="video-slots" id="video-slots"></div>
        <div class="history-section">
          <h3>Bibliothèque vidéo</h3>
          <div id="video-history" class="history-grid"></div>
        </div>
      </section>

      <section id="section-studio" class="section">
        <div id="studio-home" class="studio-view">
          <div class="studio-hero">
            <h1>Votre Superviseur IA.</h1>
            <p>Transformez une idée floue en une histoire structurée, avec une bible de personnages et des prompts vidéo prêts à l'emploi.</p>
          </div>
          <div class="studio-actions-grid">
            <button class="studio-action-card card" id="studio-btn-new">
              <span class="action-icon">✨</span>
              <h3>Créer une histoire</h3>
              <p>Laissez l'IA vous guider pour structurer votre projet.</p>
            </button>
            <button class="studio-action-card card" id="studio-btn-continue">
              <span class="action-icon">📂</span>
              <h3>Reprendre un projet</h3>
              <p>Retrouvez votre storyboard et vos prompts sauvegardés.</p>
            </button>
          </div>
        </div>

        <div id="studio-wizard" class="studio-view" hidden>
          <div class="wizard-header">
            <button class="btn-secondary btn-small" id="wizard-back-to-home">← Retour</button>
          </div>
          <div class="wizard-container card">
            <h2 style="margin-bottom: 20px;">Créer votre storyboard</h2>
            
            <div class="input-group" style="margin-bottom: 15px;">
              <label>Quelle est votre idée de départ ? (Incluez les noms et les dialogues !)</label>
              <textarea id="wizard-idea" class="input-field" rows="5" placeholder="Ex: Marc et Léa se disputent sur un toit. Marc dit : 'Tu m'as menti !'. Léa répond : 'Je n'avais pas le choix.'"></textarea>
            </div>

            <div class="wizard-params" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
              <div class="input-group">
                <label>Nombre de scènes</label>
                <select id="wizard-scene-count" class="input-field">
                  <option value="5">5 clips (~1 min)</option>
                  <option value="10">10 clips (~2 min)</option>
                </select>
              </div>
              <div class="input-group">
                <label>Format</label>
                <select id="wizard-format" class="input-field">
                  <option value="16:9">16:9 (Cinéma)</option>
                  <option value="9:16">9:16 (Mobile)</option>
                  <option value="1:1">1:1 (Carré)</option>
                </select>
              </div>
            </div>

            <button id="wizard-generate-btn" class="btn-primary" style="width: 100%; padding: 15px; font-size: 16px;">🎬 Générer le Storyboard</button>
            
            <div id="wizard-loading" hidden style="text-align: center; padding: 30px 0;">
              <div class="spinner" style="border: 4px solid rgba(255,255,255,0.1); border-top: 4px solid var(--accent); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 15px auto;"></div>
              <p style="color: var(--accent); font-weight: bold;">L'IA écrit votre histoire...</p>
            </div>
          </div>
        </div>

        <div id="studio-workspace" class="studio-view" hidden>
          <div class="workspace-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
            <div>
              <h2 id="workspace-title" style="margin:0;">Titre du projet</h2>
              <p id="workspace-synopsis" class="text-dim" style="margin:0; font-size:14px; max-width: 600px;">Synopsis...</p>
            </div>
            <button class="btn-secondary btn-small" id="workspace-back-btn">← Accueil Studio</button>
          </div>

          <div class="workspace-nav-tabs">
            <button class="ws-tab-btn active" data-target="ws-tab-scenes">🎬 Scènes & Prompts</button>
            <button class="ws-tab-btn" data-target="ws-tab-script">📖 Synopsis</button>
          </div>

          <div class="workspace-content">
            <div id="ws-tab-scenes" class="ws-tab-content active">
              <p style="color:var(--text-dim); font-size: 14px; margin-bottom: 15px;">Ajoutez une ou plusieurs photos de référence (Max 5) pour chaque scène, puis générez l'image.</p>
              <div id="ws-scenes-container" class="scenes-list"></div>
            </div>

            <div id="ws-tab-script" class="ws-tab-content" hidden>
              <div class="card">
                <h3>Synopsis complet</h3>
                <p id="ws-script-synopsis" style="white-space: pre-wrap; line-height: 1.6; font-size: 15px;"></p>
                <h3 style="margin-top:20px;">Direction Artistique</h3>
                <div id="ws-script-da" style="font-size: 14px; line-height: 1.6;"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <template id="slot-template">
    <div class="slot card">
      <div class="slot-header">
        <span class="slot-num">#1</span>
        <span class="slot-status" data-state="idle"><span class="dot"></span> En attente</span>
      </div>
      <textarea class="slot-prompt input-field" rows="3" placeholder="Prompt vidéo…"></textarea>
      <div class="slot-image-area" style="display: flex; gap: 10px; align-items: center; margin: 10px 0;">
        <input type="file" class="slot-img-input" accept="image/*" hidden>
        <button class="slot-img-btn btn-secondary btn-small" type="button">📷 Ajouter une image</button>
        <div class="slot-img-preview-container" style="display: none; width: 40px; height: 40px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border);">
          <img class="slot-img-preview" src="" style="width: 100%; height: 100%; object-fit: cover;">
        </div>
      </div>
      <div class="slot-options">
        <select class="slot-format input-field"><option value="9:16">9:16</option><option value="16:9" selected>16:9</option><option value="1:1">1:1</option></select>
        <select class="slot-duration input-field"><option value="4">4s</option><option value="8">8s</option><option value="12" selected>12s</option></select>
      </div>
      <div class="slot-actions" style="margin-top: 10px;">
        <button class="slot-gen-btn btn-primary" type="button">Générer</button>
        <button class="slot-dl-btn btn-download" type="button" disabled>Télécharger</button>
      </div>
      <div class="slot-player" hidden style="margin-top: 10px;"><video controls playsinline style="width: 100%; border-radius: 8px;"></video></div>
    </div>
  </template>

  <template id="studio-scene-template">
    <div class="studio-scene-card card" style="margin-bottom: 15px;">
      <div class="studio-scene-header">
        <h3 class="studio-scene-title" style="font-size: 16px;">Scène 1</h3>
        <span class="studio-scene-badge" style="background: var(--accent); color: white; padding: 2px 8px; border-radius: 10px; font-size: 12px;">12s</span>
      </div>
      <p class="studio-scene-action" style="font-size: 13px; color: var(--text-dim); margin: 10px 0;"></p>
      
      <div class="studio-scene-image-container" style="background: var(--bg); padding: 10px; border-radius: 12px; text-align: center; border: 1px dashed var(--border);">
        
        <div style="display:flex; gap:10px; margin-bottom:10px; align-items:center; justify-content:center; flex-direction:column;">
            <input type="file" class="studio-scene-upload-input" accept="image/*" multiple hidden>
            <button class="btn-secondary btn-small studio-scene-upload-btn" style="width:100%;">📷 Ajouter des photos (Max 5)</button>
            <div class="studio-scene-upload-preview-container" style="display: none; gap: 5px; flex-wrap: wrap; justify-content: center;"></div>
        </div>
        
        <div class="studio-scene-img-placeholder" style="color: var(--text-dim); font-size: 13px; padding: 20px 0;">🖼️ Aucune image générée</div>
        <img class="studio-scene-img" src="" alt="" hidden style="width: 100%; border-radius: 8px; margin-bottom: 10px;">
        <button class="btn-primary btn-small studio-scene-img-btn" style="width:100%;">✨ Générer l'image</button>
      </div>
      
      <div class="studio-scene-prompt-container" style="margin-top: 15px;">
        <label style="font-size: 12px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 4px; display: block;">Prompt Image/Vidéo (Modifiable)</label>
        <textarea class="studio-scene-prompt input-field" rows="4" style="font-size: 13px; background: rgba(0,0,0,0.2);"></textarea>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button class="btn-secondary btn-small studio-scene-copy-btn" style="flex: 1;">📋 Copier</button>
          <button class="btn-primary btn-small studio-scene-send-btn" style="flex: 2;">🚀 Envoyer vers Vidéo</button>
        </div>
      </div>
    </div>
  </template>

  <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
  
  <!-- AJOUT : Librairies pour un rendu Markdown parfait -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.8/purify.min.js"></script>
  
  <script src="app.js"></script>
</body>
</html>
