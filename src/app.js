/**
 * Imagen - Internal AI Image Generation Tool
 * Supports multiple models via OpenRouter API
 */

// ===== IndexedDB Storage =====
const ImagenDB = {
  dbName: 'ImagenDB',
  storeName: 'images',
  db: null,

  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  },

  async saveImage(imageData) {
    await this.ensureOpen();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(imageData);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getAllImages() {
    await this.ensureOpen();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        // Sort by createdAt descending (newest first)
        const images = request.result.sort((a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
        );
        resolve(images);
      };
      request.onerror = () => reject(request.error);
    });
  },

  async deleteImage(id) {
    await this.ensureOpen();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async clearAll() {
    await this.ensureOpen();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async ensureOpen() {
    if (!this.db) {
      await this.open();
    }
  }
};

// ===== State Management =====
const state = {
  apiKey: localStorage.getItem('imagen_api_key') || '',
  selectedModel: localStorage.getItem('imagen_model') || 'google/gemini-2.5-flash-image',
  imageSize: localStorage.getItem('imagen_size') || '1024x1024',
  imageQuality: localStorage.getItem('imagen_quality') || '1K',
  aspectRatio: localStorage.getItem('imagen_aspect_ratio') || '1:1',
  imageCount: parseInt(localStorage.getItem('imagen_count')) || 1,

  // Moved Shot Deck properties here:
  shotDeckSelections: {
    movement: null,
    framing: null,
    lens: null,
    lighting: null
  },
  stagingSelections: {}, // Populated dynamically when the modal opens

  // New Casting Array
  casting: [], // e.g., [{ id: 1, name: 'Donald Duck', weight: 70, focus: 'overall' }]
  stagingCasting: [],

  references: [],
  images: [],
  currentImage: null,
  pendingBatches: []
};

// ===== Model Configurations =====
const MODEL_CONFIGS = {
  'google/gemini-2.5-flash-image': {
    name: 'Gemini 2.5 Flash Image',
    supportsImageSize: true,
    supportsAspectRatio: true,
    supportsImageInput: true,
    maxReferences: 3
  },
  'google/gemini-2.5-flash-image-preview': {
    name: 'Gemini 2.5 Flash Image (Preview)',
    supportsImageSize: true,
    supportsAspectRatio: true,
    supportsImageInput: true,
    maxReferences: 3
  },
  'google/gemini-3.1-flash-image-preview': {
    name: 'Gemini 3.1 Flash Image (Preview)',
    supportsImageSize: true,
    supportsAspectRatio: true,
    supportsImageInput: true,
    maxReferences: 3
  },
  'google/gemini-3-pro-image-preview': {
    name: 'Gemini 3 Pro Image (Preview)',
    supportsImageSize: true,
    supportsAspectRatio: true,
    supportsImageInput: true,
    maxReferences: 14
  },
  'openai/gpt-5-image': {
    name: 'GPT-5 Image',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: true,
    maxReferences: 1
  },
  'openai/gpt-5-image-mini': {
    name: 'GPT-5 Image Mini',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: true,
    maxReferences: 1
  },
  'black-forest-labs/flux.2-pro': {
    name: 'Flux 2 Pro',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: false,
    maxReferences: 0
  },
  'black-forest-labs/flux.2-max': {
    name: 'Flux 2 Max',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: false,
    maxReferences: 0
  },
  'black-forest-labs/flux.2-flex': {
    name: 'Flux 2 Flex',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: false,
    maxReferences: 0
  },
  'black-forest-labs/flux.2-klein-4b': {
    name: 'Flux 2 Klein 4B',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: false,
    maxReferences: 0
  },
  'bytedance-seed/seedream-4.5': {
    name: 'Seedream 4.5',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: false,
    maxReferences: 0
  },
  'sourceful/riverflow-v2-fast-preview': {
    name: 'Riverflow V2 Fast',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: false,
    maxReferences: 0
  },
  'sourceful/riverflow-v2-standard-preview': {
    name: 'Riverflow V2 Standard',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: false,
    maxReferences: 0
  },
  'sourceful/riverflow-v2-max-preview': {
    name: 'Riverflow V2 Max',
    supportsImageSize: false,
    supportsAspectRatio: true,
    supportsImageInput: false,
    maxReferences: 0
  }
};

// ===== Shot Deck Data =====
const shotDeckData = [
  {
    categoryId: "movement",
    categoryName: "Camera Movement",
    icon: "🎥",
    terms: [
      {
        id: "static_tripod",
        label: "Locked-off Tripod",
        promptText: "locked-off tripod, static shot, zero camera movement",
        definition: "The camera is completely fixed in place on a tripod, eliminating all drift and wobble."
      },
      {
        id: "dolly_in",
        label: "Dolly In",
        promptText: "slow cinematic dolly-in, moving forward",
        definition: "The camera physically rolls forward through the space, creating natural background parallax."
      },
      {
        id: "dolly_out",
        label: "Dolly Out",
        promptText: "slow cinematic dolly-out, moving backward",
        definition: "The camera rolls backward away from the subject, revealing more of the surrounding environment."
      },
      {
        id: "pan",
        label: "Pan (Left/Right)",
        promptText: "slow pan shot, panning camera",
        definition: "The camera stays in one place but rotates horizontally on its axis to survey the scene."
      },
      {
        id: "crane_jib",
        label: "Crane / Jib",
        promptText: "crane shot, vertical camera movement",
        definition: "The camera swoops vertically up or down through the air to establish scale or transition heights."
      },
      {
        id: "steadicam",
        label: "Steadicam Follow",
        promptText: "steadicam follow shot, smooth tracking",
        definition: "A smooth, floating camera movement that seamlessly tracks alongside or behind a moving subject."
      }
    ]
  },
  {
    categoryId: "framing",
    categoryName: "Framing & Angle",
    icon: "📐",
    terms: [
      {
        id: "wide_establishing",
        label: "Wide Establishing Shot",
        promptText: "wide establishing shot, full body, expansive environment",
        definition: "Captures the subject entirely while prioritizing the surrounding landscape or architecture."
      },
      {
        id: "medium_shot",
        label: "Medium Shot",
        promptText: "medium shot, waist up framing",
        definition: "Frames the subject from the waist up, balancing facial expression with body language."
      },
      {
        id: "extreme_closeup",
        label: "Extreme Close-Up",
        promptText: "extreme close-up, macro detail shot",
        definition: "Focuses intensely on a single detail, such as an eye, a twitching finger, or an object's texture."
      },
      {
        id: "ots",
        label: "Over-The-Shoulder",
        promptText: "over-the-shoulder shot, OTS reverse angle",
        definition: "Looks past the shoulder of a foreground character to focus on the subject they are interacting with."
      },
      {
        id: "low_angle",
        label: "Low Angle",
        promptText: "low angle heroic shot, looking up",
        definition: "The camera is placed below eye level looking up, making the subject appear powerful or imposing."
      },
      {
        id: "high_angle",
        label: "High Angle",
        promptText: "high angle shot, looking down",
        definition: "The camera looks down from above, making the subject appear vulnerable, isolated, or small."
      }
    ]
  },
  {
    categoryId: "lens",
    categoryName: "Lens & Optics",
    icon: "🔍",
    terms: [
      {
        id: "lens_24mm",
        label: "24mm Wide-Angle",
        promptText: "24mm wide-angle lens, deep depth of field",
        definition: "Provides an expansive field of view with slight edge distortion, keeping the environment sharply in focus."
      },
      {
        id: "lens_35mm",
        label: "35mm Prime",
        promptText: "35mm prime lens, street photography aesthetic",
        definition: "Matches natural human perspective, ideal for documentary-style narrative realism."
      },
      {
        id: "lens_85mm",
        label: "85mm Telephoto",
        promptText: "85mm telephoto portrait lens, extreme shallow depth of field, blurred background",
        definition: "Compresses space and heavily blurs the background (bokeh) to isolate a subject's face flatteringly."
      },
      {
        id: "anamorphic",
        label: "Anamorphic Cine",
        promptText: "anamorphic lens, cinematic widescreen aspect ratio, horizontal blue flares, oval bokeh",
        definition: "Delivers a classic Hollywood widescreen aesthetic with distinct stretched background lights and light flares."
      },
      {
        id: "macro",
        label: "Macro Lens",
        promptText: "macro photography, extreme microscopic detail",
        definition: "Allows extreme close-up focus on tiny subjects to capture fine textures invisible to the naked eye."
      }
    ]
  },
  {
    categoryId: "lighting",
    categoryName: "Lighting & Mood",
    icon: "💡",
    terms: [
      {
        id: "chiaroscuro",
        label: "Low-Key / Chiaroscuro",
        promptText: "low-key chiaroscuro lighting, high contrast, deep oppressive shadows",
        definition: "High-contrast lighting utilizing deep shadows and minimal fill light for a moody, dramatic atmosphere."
      },
      {
        id: "practical",
        label: "Practical Lighting",
        promptText: "practical lighting, illuminated solely by in-scene light sources",
        definition: "The scene is illuminated entirely by visible objects like desk lamps, neon signs, or streetlights."
      },
      {
        id: "volumetric",
        label: "Volumetric Fog",
        promptText: "dense volumetric fog, crepuscular light rays, atmospheric haze",
        definition: "Beams of light made visible by cutting through atmospheric haze, mist, dust, or smoke."
      },
      {
        id: "rembrandt",
        label: "Rembrandt",
        promptText: "Rembrandt lighting, directional key light, cinematic shadow triangle",
        definition: "A classic portrait lighting setup that creates a distinctive illuminated triangle on the shadowed side of a face."
      },
      {
        id: "golden_hour",
        label: "Golden Hour",
        promptText: "golden hour natural lighting, warm directional sunlight, long shadows",
        definition: "Soft, warm, highly directional sunlight captured shortly after sunrise or right before sunset."
      }
    ]
  }
];

// ===== DOM Elements =====
const elements = {
  // Sidebar
  modelSelectContainer: document.getElementById('modelSelectContainer'),
  modelSelectTrigger: document.getElementById('modelSelectTrigger'),
  modelSelectValue: document.getElementById('modelSelectValue'),
  modelSelectOptions: document.getElementById('modelSelectOptions'),
  geminiOptions: document.getElementById('geminiOptions'),
  apiKey: document.getElementById('apiKey'),
  saveApiKey: document.getElementById('saveApiKey'),
  imageCount: document.getElementById('imageCount'),
  decreaseCount: document.getElementById('decreaseCount'),
  increaseCount: document.getElementById('increaseCount'),
  clearReferences: document.getElementById('clearReferences'),
  referenceSlots: document.getElementById('referenceSlots'),

  // Main Content
  enhanceBtn: document.getElementById("btn-enhance"),
  rawInput: document.getElementById("raw-prompt"),
  enhancedInput: document.getElementById("enhanced-prompt"),
  clearDeckBtn: document.getElementById("btnClearDeck"),
  charCount: document.getElementById('charCount'),
  generateBtn: document.getElementById('generateBtn'),
  gallery: document.getElementById('gallery'),
  galleryEmpty: document.getElementById('galleryEmpty'),
  clearGallery: document.getElementById('clearGallery'),

  // Modal
  imageModal: document.getElementById('imageModal'),
  modalOverlay: document.getElementById('modalOverlay'),
  modalClose: document.getElementById('modalClose'),
  modalImage: document.getElementById('modalImage'),
  modalMetadata: document.getElementById('modalMetadata'),
  useAsReference: document.getElementById('useAsReference'),
  recreateImage: document.getElementById('recreateImage'),
  downloadImage: document.getElementById('downloadImage')
};

// ===== Initialization =====
async function init() {
  // Load saved API key
  if (state.apiKey) {
    elements.apiKey.value = state.apiKey;
  }

  // Render reference slots
  renderReferenceSlots();

  // Restore saved model selection
  if (state.selectedModel) {
    const savedOption = document.querySelector(`.custom-select-option[data-value="${state.selectedModel}"]`);
    if (savedOption) {
      document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
      savedOption.classList.add('selected');
      elements.modelSelectValue.textContent = savedOption.textContent;
    }
  }

  // Restore saved image quality/size
  document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.quality === state.imageQuality) {
      btn.classList.add('active');
    }
  });

  // Restore saved aspect ratio
  document.querySelectorAll('.btn-aspect').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.ratio === state.aspectRatio) {
      btn.classList.add('active');
    }
  });

  // Restore saved image count
  if (elements.imageCount) {
    elements.imageCount.value = state.imageCount;
  }

  // Load images from IndexedDB
  try {
    state.images = await ImagenDB.getAllImages();
  } catch (error) {
    console.error('Failed to load images from IndexedDB:', error);
    state.images = [];
  }

  // Render gallery
  renderGallery();

  // Set up event listeners
  setupEventListeners();

  // Initialize UI state
  updateGeminiOptionsVisibility();

  // Initialize Shoct Deck
  initShotDeck();

  // Initialize Casting Deck
  initCastingDeck();
}

// ===== Initialize the UI =====
function initShotDeck() {
  renderQuickChips();
  renderActiveDeckBar();
  setupShotDeckListeners();
}

function initCastingDeck() {
  const modal = document.getElementById('castingModal');
  const overlay = document.getElementById('castingOverlay');
  const closeBtn = document.getElementById('castingClose');
  const openBtn = document.getElementById('btn-open-casting');
  const addRowBtn = document.getElementById('btnAddCastingRow');
  const applyBtn = document.getElementById('btn-apply-casting');

  const closeModal = () => modal.classList.remove('active');

  if (openBtn) {
    openBtn.onclick = () => {
      // Clone active state into staging
      stagingCasting = JSON.parse(JSON.stringify(state.casting));
      renderCastingRows();
      modal.classList.add('active');
    };
  }
  
  if (closeBtn) closeBtn.onclick = closeModal;
  if (overlay) overlay.onclick = closeModal;

  if (addRowBtn) {
    addRowBtn.onclick = () => {
      stagingCasting.push({ id: Date.now(), name: '', weight: 50, focus: 'overall' });
      renderCastingRows();
    };
  }

  if (applyBtn) {
    applyBtn.onclick = () => {
      // Commit non-empty rows to state
      state.casting = stagingCasting.filter(p => p.name.trim() !== '');
      closeModal();
      showToast(`Saved ${state.casting.length} reference personas.`, 'success');
    };
  }
}

function renderCastingRows() {
  const container = document.getElementById('castingRowsContainer');
  if (!container) return;
  container.innerHTML = '';

  if (stagingCasting.length === 0) {
    container.innerHTML = '<span class="staging-placeholder">No references added yet.</span>';
    return;
  }

  stagingCasting.forEach(persona => {
    const row = document.createElement('div');
    row.className = 'casting-row';
    
    row.innerHTML = `
      <input type="text" class="text-input casting-input-name" placeholder="Name (e.g. Mads Mikkelsen)" value="${escapeHtml(persona.name)}" data-id="${persona.id}">
      
      <div class="casting-slider-group">
        <label><span>Influence:</span> <span class="weight-val">${persona.weight}%</span></label>
        <input type="range" min="5" max="100" step="5" value="${persona.weight}" data-id="${persona.id}">
      </div>
      
      <select class="casting-select-focus" data-id="${persona.id}">
        <option value="overall" ${persona.focus === 'overall' ? 'selected' : ''}>Overall Features</option>
        <option value="bone structure and jawline" ${persona.focus === 'bone structure and jawline' ? 'selected' : ''}>Bone Structure & Jaw</option>
        <option value="eyes and gaze" ${persona.focus === 'eyes and gaze' ? 'selected' : ''}>Eyes & Gaze</option>
        <option value="hair and styling" ${persona.focus === 'hair and styling' ? 'selected' : ''}>Hair & Styling</option>
      </select>
      
      <button class="casting-btn-remove" data-id="${persona.id}" title="Remove">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;
    container.appendChild(row);
  });

  // Attach live listeners for this render pass
  container.querySelectorAll('.casting-input-name').forEach(input => {
    input.oninput = (e) => {
      const p = stagingCasting.find(x => x.id == e.target.dataset.id);
      if (p) p.name = e.target.value;
    };
  });

  container.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.oninput = (e) => {
      const p = stagingCasting.find(x => x.id == e.target.dataset.id);
      if (p) {
        p.weight = parseInt(e.target.value);
        e.target.previousElementSibling.querySelector('.weight-val').textContent = `${p.weight}%`;
      }
    };
  });

  container.querySelectorAll('.casting-select-focus').forEach(select => {
    select.onchange = (e) => {
      const p = stagingCasting.find(x => x.id == e.target.dataset.id);
      if (p) p.focus = e.target.value;
    };
  });

  container.querySelectorAll('.casting-btn-remove').forEach(btn => {
    btn.onclick = (e) => {
      stagingCasting = stagingCasting.filter(x => x.id != e.currentTarget.dataset.id);
      renderCastingRows();
    };
  });
}

// ===== Quick Chips (Single Select Injection) =====
function renderQuickChips() {
  const container = document.getElementById('quick-chips');
  if (!container) return;
  container.innerHTML = '';

  const quickHits = ['static_tripod', 'dolly_in', 'lens_35mm', 'chiaroscuro'];
  quickHits.forEach(termId => {
    const cat = findCategoryByTermId(termId);
    if (!cat) return;
    const termObj = cat.terms.find(t => t.id === termId);
    if (!termObj) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-btn';
    btn.textContent = `+ ${termObj.label}`;
    btn.onclick = () => {
      // Toggle category selection
      state.shotDeckSelections[cat.categoryId] =
        state.shotDeckSelections[cat.categoryId] === termId ? null : termId;
      renderActiveDeckBar();
    };
    container.appendChild(btn);
  });
}

// ===== Modal Grid (Single Selection per Category) =====
function renderShotDeckModal() {
  const body = document.getElementById('shotDeckBody');
  if (!body) return;
  body.innerHTML = '';

  shotDeckData.forEach(category => {
    const section = document.createElement('div');
    section.className = 'category-section';

    const title = document.createElement('h3');
    title.textContent = `${category.icon} ${category.categoryName}`;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'cards-grid';

    category.terms.forEach(term => {
      const card = document.createElement('div');
      card.className = 'shot-card';
      card.dataset.categoryId = category.categoryId;
      card.dataset.termId = term.id;

      if (state.stagingSelections[category.categoryId] === term.id) {
        card.classList.add('selected');
      }

      card.innerHTML = `
        <div class="shot-card-title">${term.label}</div>
        <div class="shot-card-def">${term.definition}</div>
      `;

      card.onclick = () => toggleModalCard(category.categoryId, term.id);
      grid.appendChild(card);
    });

    section.appendChild(grid);
    body.appendChild(section);
  });
}

function toggleModalCard(categoryId, termId) {
  // Radio toggle: click same card = deselect; click other = overwrite category
  if (state.stagingSelections[categoryId] === termId) {
    state.stagingSelections[categoryId] = null;
  } else {
    state.stagingSelections[categoryId] = termId;
  }

  // Update card visuals in this category
  document.querySelectorAll(`.shot-card[data-category-id="${categoryId}"]`).forEach(card => {
    card.classList.toggle('selected', card.dataset.termId === state.stagingSelections[categoryId]);
  });

  updateStagingDock();
}

function updateStagingDock() {
  const dock = document.getElementById('stagingDock');
  const applyBtn = document.getElementById('btn-apply-shots');
  if (!dock) return;

  dock.innerHTML = '';
  const activeEntries = Object.entries(state.stagingSelections).filter(([_, termId]) => Boolean(termId));

  if (activeEntries.length === 0) {
    dock.innerHTML = '<span class="staging-placeholder">Select one card per category...</span>';
    applyBtn.disabled = false; // Allow applying an empty state to clear
    return;
  }

  activeEntries.forEach(([catId, termId]) => {
    const term = findTerm(catId, termId);
    if (!term) return;

    const pill = document.createElement('div');
    pill.className = 'staged-pill';
    pill.innerHTML = `
      ${term.label}
      <span class="staged-pill-remove" data-cat="${catId}">×</span>
    `;
    dock.appendChild(pill);
  });

  dock.querySelectorAll('.staged-pill-remove').forEach(xBtn => {
    xBtn.onclick = (e) => {
      e.stopPropagation();
      const catId = e.target.dataset.cat;
      toggleModalCard(catId, state.stagingSelections[catId]);
    };
  });
}

// ===== Active Bar on Main UI =====
function renderActiveDeckBar() {
  const bar = document.getElementById('activeDeckBar');
  const container = document.getElementById('activeDeckBadges');
  if (!bar || !container) return;

  container.innerHTML = '';
  const activeEntries = Object.entries(state.shotDeckSelections).filter(([_, termId]) => Boolean(termId));

  if (activeEntries.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';

  // Render in stable cinematographic order: movement -> framing -> lens -> lighting
  shotDeckData.forEach(cat => {
    const termId = state.shotDeckSelections[cat.categoryId];
    if (!termId) return;
    const term = cat.terms.find(t => t.id === termId);
    if (!term) return;

    const badge = document.createElement('span');
    badge.className = 'category-badge';
    badge.innerHTML = `
      ${cat.icon} ${term.label}
      <span class="category-badge-close" data-cat="${cat.categoryId}">×</span>
    `;
    container.appendChild(badge);
  });

  container.querySelectorAll('.category-badge-close').forEach(btn => {
    btn.onclick = () => {
      state.shotDeckSelections[btn.dataset.cat] = null;
      renderActiveDeckBar();
    };
  });
}

// ===== Assemble Full Cinematographic Prompt =====
function getAssembledPrompt() {
  const technicalTags = [];

  // Append selections in proper sequence
  shotDeckData.forEach(cat => {
    const termId = state.shotDeckSelections[cat.categoryId];
    if (termId) {
      const term = cat.terms.find(t => t.id === termId);
      if (term) technicalTags.push(term.promptText);
    }
  });

  const rawUserText = elements.rawInput.value.trim();
  const techString = technicalTags.join(', ');

  if (techString && rawUserText) {
    return `${techString}. ${rawUserText}`;
  }
  return rawUserText || techString;
}

// ===== Wire Up Shot Deck Modal Controls =====
function setupShotDeckListeners() {
  const modal = document.getElementById('shotDeckModal');
  const btnOpen = document.getElementById('btn-open-deck');
  const btnClose = document.getElementById('shotDeckClose');
  const overlay = document.getElementById('shotDeckOverlay');
  const btnApply = document.getElementById('btn-apply-shots');

  const openModal = () => {
    // Sync staging state with currently applied selections
    state.stagingSelections = { ...state.shotDeckSelections };
    renderShotDeckModal();
    updateStagingDock();
    modal.classList.add('active');
  };

  const closeModal = () => modal.classList.remove('active');

  if (btnOpen) btnOpen.onclick = openModal;
  if (btnClose) btnClose.onclick = closeModal;
  if (overlay) overlay.onclick = closeModal;

  if (btnApply) {
    btnApply.onclick = () => {
      // Commit staging changes to active state
      state.shotDeckSelections = { ...state.stagingSelections };
      renderActiveDeckBar();
      closeModal();
    };
  }
}

function findTerm(categoryId, termId) {
  const cat = shotDeckData.find(c => c.categoryId === categoryId);
  return cat ? cat.terms.find(t => t.id === termId) : null;
}

function findCategoryByTermId(termId) {
  return shotDeckData.find(c => c.terms.some(t => t.id === termId));
}

// Utility Helpers
function findTermById(id) {
  for (const cat of shotDeckData) {
    const term = cat.terms.find(t => t.id === id);
    if (term) return term;
  }
  return null;
}

function insertIntoPrompt(textToInsert) {
  const rawInput = elements.rawInput; // using the existing elements mapping from earlier
  const currentText = rawInput.value.trim();

  if (currentText === '') {
    rawInput.value = textToInsert;
  } else {
    rawInput.value = currentText + ', ' + textToInsert;
  }

  // Trigger the character counter update
  rawInput.dispatchEvent(new Event('input'));
}

// ===== Event Listeners =====
function setupEventListeners() {
  // Custom dropdown - toggle
  elements.modelSelectTrigger.addEventListener('click', () => {
    elements.modelSelectContainer.classList.toggle('open');
  });

  // Custom dropdown - option selection
  document.querySelectorAll('.custom-select-option').forEach(option => {
    option.addEventListener('click', () => {
      state.selectedModel = option.dataset.value;
      localStorage.setItem('imagen_model', state.selectedModel);
      elements.modelSelectValue.textContent = option.textContent;
      document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      elements.modelSelectContainer.classList.remove('open');
      updateGeminiOptionsVisibility();
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!elements.modelSelectContainer.contains(e.target)) {
      elements.modelSelectContainer.classList.remove('open');
    }
  });

  // Size toggle buttons
  document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.imageSize = btn.dataset.size;
      state.imageQuality = btn.dataset.quality;
      localStorage.setItem('imagen_size', state.imageSize);
      localStorage.setItem('imagen_quality', state.imageQuality);
    });
  });

  // Aspect ratio buttons
  document.querySelectorAll('.btn-aspect').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-aspect').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.aspectRatio = btn.dataset.ratio;
      localStorage.setItem('imagen_aspect_ratio', state.aspectRatio);
    });
  });

  // Image count
  if (elements.decreaseCount) {
    elements.decreaseCount.addEventListener('click', () => {
      if (state.imageCount > 1) {
        state.imageCount--;
        elements.imageCount.value = state.imageCount;
        localStorage.setItem('imagen_count', state.imageCount);
      }
    });
  }

  if (elements.increaseCount) {
    elements.increaseCount.addEventListener('click', () => {
      if (state.imageCount < 8) {
        state.imageCount++;
        elements.imageCount.value = state.imageCount;
        localStorage.setItem('imagen_count', state.imageCount);
      }
    });
  }

  if (elements.imageCount) {
    elements.imageCount.addEventListener('change', (e) => {
      let val = parseInt(e.target.value);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 8) val = 8;
      state.imageCount = val;
      elements.imageCount.value = val;
      localStorage.setItem('imagen_count', state.imageCount);
    });
  }

  // API Key
  elements.saveApiKey.addEventListener('click', () => {
    state.apiKey = elements.apiKey.value.trim();
    localStorage.setItem('imagen_api_key', state.apiKey);
    showToast('API key saved!', 'success');
  });

  // Reference images are handled by renderReferenceSlots()
  elements.clearReferences.addEventListener('click', clearAllReferences);

  // Drag & Drop for reference images
  setupDragAndDrop();

  // Prompt character count tracking
  const updateCharCount = () => {
    const text = elements.enhancedInput.value || elements.rawInput.value;
    elements.charCount.textContent = `${text.length} chars`;
  };
  elements.rawInput.addEventListener('input', updateCharCount);
  elements.enhancedInput.addEventListener('input', updateCharCount);

  // Enhance Button Handler
  elements.enhanceBtn.addEventListener("click", async () => {
    const assembledText = getAssembledPrompt();
    if (!assembledText) {
      showToast('Please enter an idea or pick Shot Deck parameters first', 'warning');
      return;
    }

    const apiKey = state.apiKey || localStorage.getItem('imagen_api_key');
    if (!apiKey) {
      showToast('Please save your OpenRouter API key first', 'error');
      return;
    }

    elements.enhanceBtn.disabled = true;
    elements.enhanceBtn.textContent = "Enhancing...";

    try {
      const polished = await expandPromptWithLLM(assembledText, apiKey);
      elements.enhancedInput.value = polished;
      updateCharCount();
      showToast('Prompt polished by Director AI!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not enhance prompt. Check console/API key.', 'error');
    } finally {
      elements.enhanceBtn.disabled = false;
      elements.enhanceBtn.textContent = "✨ Polish with Director AI";
    }
  });

  // Clear Deck Button
  elements.clearDeckBtn.addEventListener('click', () => {
    // Clear all active settings
    Object.keys(state.shotDeckSelections).forEach(k => state.shotDeckSelections[k] = null);
    renderActiveDeckBar();
  });

  // Generate button
  elements.generateBtn.addEventListener('click', generateImages);

  // Clear gallery
  elements.clearGallery.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all generated images?')) {
      state.images = [];
      try {
        await ImagenDB.clearAll();
      } catch (e) {
        console.warn('Could not clear IndexedDB:', e);
      }
      renderGallery();
      showToast('Gallery cleared', 'success');
    }
  });

  // Modal
  elements.modalOverlay.addEventListener('click', closeModal);
  elements.modalClose.addEventListener('click', closeModal);
  elements.useAsReference.addEventListener('click', useImageAsReference);
  elements.recreateImage.addEventListener('click', recreateImage);
  elements.downloadImage.addEventListener('click', downloadCurrentImage);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.ctrlKey) generateImages();
  });

  // Paste images from clipboard
  document.addEventListener('paste', handlePaste);

  // Warn user before leaving if there are pending generations
  window.addEventListener('beforeunload', (e) => {
    if (state.pendingBatches.length > 0) {
      const pendingCount = state.pendingBatches.reduce((sum, batch) => {
        return sum + (batch.count - batch.completed - batch.failed);
      }, 0);
      if (pendingCount > 0) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but we need to return something
        e.returnValue = `You have ${pendingCount} image(s) still generating. If you leave, they will be lost.`;
        return e.returnValue;
      }
    }
  });
}

// ===== Paste Handler =====
function handlePaste(e) {
  // Don't intercept paste if user is typing in an input field (except prompt)
  const activeEl = document.activeElement;
  if (activeEl && activeEl.tagName === 'INPUT' && activeEl.type !== 'text') {
    return;
  }

  const items = e.clipboardData?.items;
  if (!items) return;

  let imageCount = 0;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          state.references.push(event.target.result);
          renderReferenceSlots();
        };
        reader.readAsDataURL(file);
        imageCount++;
      }
    }
  }

  if (imageCount > 0) {
    showToast(`${imageCount} image(s) pasted as reference`, 'success');
  }
}

// ===== Drag & Drop =====
function setupDragAndDrop() {
  const dropZone = elements.referenceSlots;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('drag-over');
    }, false);
  });

  dropZone.addEventListener('drop', handleDrop, false);
}

function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;

  [...files].forEach(file => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        state.references.push(event.target.result);
        renderReferenceSlots();
      };
      reader.readAsDataURL(file);
    }
  });

  if (files.length > 0) {
    showToast(`${files.length} image(s) added as reference`, 'success');
  }
}

// ===== Reference Image Handling =====
function handleReferenceUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    state.references.push(event.target.result);
    renderReferenceSlots();
  };
  reader.readAsDataURL(file);

  // Reset the input so the same file can be selected again
  e.target.value = '';
}

function renderReferenceSlots() {
  const container = document.getElementById('referenceSlots');
  container.innerHTML = '';

  // Render existing references
  state.references.forEach((ref, index) => {
    const slot = document.createElement('div');
    slot.className = 'reference-slot filled';
    slot.dataset.slot = index;
    slot.innerHTML = `
            <img src="${ref}" alt="Reference ${index + 1}">
            <button class="remove-ref" data-index="${index}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;
    container.appendChild(slot);
  });

  // Add "Add new" slot
  const addSlot = document.createElement('div');
  addSlot.className = 'reference-slot empty add-new';
  addSlot.innerHTML = `
        <span class="slot-label">+ Add</span>
        <input type="file" accept="image/*" class="reference-input" id="addReferenceInput">
    `;
  container.appendChild(addSlot);

  // Attach event listeners
  container.querySelectorAll('.remove-ref').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      removeReference(index);
    });
  });

  const addInput = container.querySelector('#addReferenceInput');
  if (addInput) {
    addInput.addEventListener('change', handleReferenceUpload);
  }
}

function removeReference(index) {
  state.references.splice(index, 1);
  renderReferenceSlots();
}

function clearAllReferences() {
  state.references = [];
  renderReferenceSlots();
  showToast('References cleared', 'success');
}


// ===== Prompt Enhancement =====
async function expandPromptWithLLM(draftText, apiKey) {
  // 1. Build the Casting Instructions if personas exist
  let castingInstructions = "";
  if (state.casting && state.casting.length > 0) {
    const blendDetails = state.casting.map(p => 
      `${p.weight}% ${p.name} (focusing on: ${p.focus})`
    ).join(", ");
    
    castingInstructions = `
CRITICAL CASTING INSTRUCTIONS:
The user has requested a specific character blend: [${blendDetails}].
You MUST translate these celebrities into pure, vivid anatomical descriptions (e.g., bone structure, eye shape, vibe) based on their assigned weights and focus areas. 
DO NOT use the actual celebrity names in the final prompt. Describe their physical traits instead to avoid AI safety filters.`;
  }

  // 2. The upgraded System Prompt
  const systemPrompt = `You are an expert Director of Photography, Concept Artist, and prompt engineer for FLUX.
Rewrite the user's idea into a concise 2-3 sentence cinematic scene description.
Include: Subject & wardrobe, setting & background, key light source & atmosphere, and camera/lens (e.g., 35mm/85mm).
${castingInstructions}
Output ONLY the raw description. No conversational filler, no quotes.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Custom FLUX Studio"
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash", // Fast compiler
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: draftText }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) throw new Error("Prompt enhancement failed");
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// ===== Image Generation =====
async function generateImages() {
  const prompt = elements.enhancedInput.value.trim() || getAssembledPrompt();

  if (!prompt) {
    showToast('Please enter a prompt', 'warning');
    return;
  }

  if (!state.apiKey) {
    showToast('Please enter your OpenRouter API key', 'error');
    return;
  }

  const modelConfig = MODEL_CONFIGS[state.selectedModel];
  const currentReferences = state.references.length > 0 ? [...state.references] : [];
  const currentModel = state.selectedModel;
  const currentSize = state.imageSize;
  const currentQuality = state.imageQuality;
  const currentAspectRatio = state.aspectRatio;
  const imageCount = state.imageCount;

  // Create a batch to track this generation request
  const batchId = Date.now() + Math.random();
  const batch = {
    id: batchId,
    prompt: prompt,
    model: currentModel,
    modelName: modelConfig.name,
    count: imageCount,
    completed: 0,
    failed: 0
  };
  state.pendingBatches.push(batch);

  // Add loading placeholders without full re-render
  addLoadingPlaceholders(batch, imageCount);

  showToast(`Queued ${imageCount} image(s) for generation`, 'success');

  // Generate images and display each one as it completes
  const generateAndDisplay = async (index) => {
    try {
      const result = await generateSingleImage(prompt, modelConfig);
      if (result) {
        const imageData = {
          id: Date.now() + index + Math.random(),
          url: result,
          prompt: prompt,
          model: currentModel,
          modelName: modelConfig.name,
          size: currentSize,
          quality: currentQuality,
          aspectRatio: currentAspectRatio,
          references: currentReferences,
          createdAt: new Date().toISOString()
        };
        state.images.unshift(imageData);
        batch.completed++;

        // Remove one placeholder and add the new image
        removeOnePlaceholder(batchId);
        prependImageCard(imageData, 0);

        // Save to IndexedDB in background
        ImagenDB.saveImage(imageData).catch(e => console.error('Failed to save to IndexedDB:', e));
      } else {
        batch.failed++;
        removeOnePlaceholder(batchId);
      }
    } catch (error) {
      console.error('Failed to generate image:', error);
      batch.failed++;
      removeOnePlaceholder(batchId);
    }
  };

  // Start all generations in parallel, each will render when done
  const promises = [];
  for (let i = 0; i < imageCount; i++) {
    promises.push(generateAndDisplay(i));
  }

  // Wait for all to complete to update final UI state
  await Promise.allSettled(promises);

  // Remove this batch from pending
  const batchIndex = state.pendingBatches.findIndex(b => b.id === batchId);
  if (batchIndex !== -1) {
    state.pendingBatches.splice(batchIndex, 1);
  }

  if (batch.completed > 0) {
    showToast(`${batch.completed} image(s) generated!`, 'success');
  } else {
    showToast('Failed to generate images. Check console for details.', 'error');
  }
}

async function generateSingleImage(prompt, modelConfig) {
  // Build message content
  const content = [];

  // Add reference images if supported
  if (modelConfig.supportsImageInput) {
    state.references.forEach((ref, index) => {
      if (ref) {
        content.push({
          type: 'image_url',
          image_url: {
            url: ref,
            detail: 'high'
          }
        });
      }
    });
  }

  // Add text prompt
  content.push({
    type: 'text',
    text: prompt
  });

  // Build request body
  const requestBody = {
    model: state.selectedModel,
    messages: [
      {
        role: 'user',
        content: content.length === 1 ? prompt : content
      }
    ],
    modalities: modelConfig.modalities
  };

  // Add Gemini-specific options
  if (modelConfig.supportsImageSize && state.selectedModel.includes('gemini')) {
    requestBody.image_config = {
      image_size: state.imageQuality.toLowerCase(),
      aspect_ratio: state.aspectRatio
    };
  }

  // Add aspect ratio for other models
  if (modelConfig.supportsAspectRatio && !state.selectedModel.includes('gemini')) {
    requestBody.aspect_ratio = state.aspectRatio;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${state.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Imagen Internal Tool'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();

  // Extract image from response
  // OpenRouter returns images in different formats depending on the model
  const message = data.choices?.[0]?.message;

  if (!message) {
    throw new Error('No response from model');
  }

  // Log full response for debugging
  console.log('API Response:', JSON.stringify(data, null, 2));

  // Check for images array in message (OpenRouter SDK format)
  // According to OpenRouter docs: message.images[].image_url.url
  if (message.images && message.images.length > 0) {
    const img = message.images[0];
    // OpenRouter SDK format: { image_url: { url: "data:image/..." } }
    if (img.image_url?.url) {
      return img.image_url.url;
    }
    // Alternative formats
    if (typeof img === 'string') {
      if (img.startsWith('data:') || img.startsWith('http')) {
        return img;
      }
      return `data:image/png;base64,${img}`;
    }
    if (img.url) return img.url;
    if (img.b64_json) return `data:image/png;base64,${img.b64_json}`;
  }

  // Check for image in content parts (different models may use this format)
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      // OpenAI-style image_url part
      if (part.type === 'image_url' && part.image_url?.url) {
        return part.image_url.url;
      }
      // Gemini-style inlineData part
      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType || 'image/png';
        return `data:${mimeType};base64,${part.inlineData.data}`;
      }
      // Generic image part
      if (part.type === 'image' && part.image) {
        if (part.image.startsWith('data:')) {
          return part.image;
        }
        return `data:image/png;base64,${part.image}`;
      }
    }
  }

  // Check if content itself is the image data (some models return this way)
  if (typeof message.content === 'string' && message.content.startsWith('data:image')) {
    return message.content;
  }

  throw new Error('No image in response. Check console for full API response.');
}

// ===== Gallery =====
function renderGallery() {
  const hasPending = state.pendingBatches.length > 0;
  const hasImages = state.images.length > 0;

  if (!hasImages && !hasPending) {
    elements.galleryEmpty.style.display = 'flex';
    elements.gallery.innerHTML = '';
    elements.gallery.appendChild(elements.galleryEmpty);
    return;
  }

  elements.gallery.innerHTML = '';

  // Render loading placeholders for pending batches at the top
  state.pendingBatches.forEach((batch) => {
    const pendingCount = batch.count - batch.completed - batch.failed;
    for (let i = 0; i < pendingCount; i++) {
      const placeholder = document.createElement('div');
      placeholder.className = 'image-card loading-placeholder';
      const safePrompt = escapeHtml(batch.prompt);
      const truncatedPrompt = batch.prompt.length > 60 ? batch.prompt.substring(0, 60) + '...' : batch.prompt;
      placeholder.innerHTML = `
                <div class="loading-placeholder-content">
                    <div class="loading-spinner"></div>
                    <span class="loading-placeholder-text">Generating...</span>
                </div>
                <div class="image-card-overlay" style="opacity: 1;">
                    <p class="image-card-prompt">${escapeHtml(truncatedPrompt)}</p>
                    <div class="image-card-meta">
                        <span class="meta-tag">${escapeHtml(batch.modelName)}</span>
                        <span class="meta-tag loading-tag">
                            <svg class="spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="12" y1="2" x2="12" y2="6"></line>
                                <line x1="12" y1="18" x2="12" y2="22"></line>
                                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                                <line x1="2" y1="12" x2="6" y2="12"></line>
                                <line x1="18" y1="12" x2="22" y2="12"></line>
                                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                            </svg>
                            Pending
                        </span>
                    </div>
                </div>
            `;
      elements.gallery.appendChild(placeholder);
    }
  });

  // Render existing images
  state.images.forEach((image, index) => {
    const card = document.createElement('div');
    card.className = 'image-card';

    // Sanitize URL - only allow data URIs and https URLs
    const safeUrl = sanitizeImageUrl(image.url);
    const safePrompt = escapeHtml(image.prompt);

    card.innerHTML = `
            <div class="image-card-actions image-card-actions-top">
                <button class="image-card-btn image-card-download" data-index="${index}" title="Download image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </button>
                <button class="image-card-btn image-card-delete" data-index="${index}" title="Delete image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                </button>
            </div>
            <div class="image-card-actions image-card-actions-bottom">
                <button class="image-card-btn image-card-reference" data-index="${index}" title="Use as reference">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                </button>
                <button class="image-card-btn image-card-recreate" data-index="${index}" title="Recreate with same settings">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                </button>
            </div>
            <img src="${safeUrl}" alt="${safePrompt}" loading="lazy">
            <div class="image-card-overlay">
                <p class="image-card-prompt">${safePrompt}</p>
                <div class="image-card-meta">
                    <span class="meta-tag">${escapeHtml(image.modelName || image.model)}</span>
                    <span class="meta-tag">${escapeHtml(image.quality || image.size)}</span>
                    <span class="meta-tag">${escapeHtml(image.aspectRatio)}</span>
                </div>
            </div>
        `;

    // Download button handler
    const downloadBtn = card.querySelector('.image-card-download');
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadImageByIndex(index);
    });

    // Delete button handler
    const deleteBtn = card.querySelector('.image-card-delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteImage(index);
    });

    // Reference button handler
    const referenceBtn = card.querySelector('.image-card-reference');
    referenceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addImageAsReference(index);
    });

    // Recreate button handler
    const recreateBtn = card.querySelector('.image-card-recreate');
    recreateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      recreateImageByIndex(index);
    });

    // Open modal on card click
    card.addEventListener('click', () => openModal(image));
    elements.gallery.appendChild(card);
  });
}

// ===== Incremental Gallery Updates =====
function addLoadingPlaceholders(batch, count) {
  // Hide empty state if showing
  elements.galleryEmpty.style.display = 'none';

  for (let i = 0; i < count; i++) {
    const placeholder = createPlaceholderElement(batch);
    elements.gallery.insertBefore(placeholder, elements.gallery.firstChild);
  }
}

function createPlaceholderElement(batch) {
  const placeholder = document.createElement('div');
  placeholder.className = 'image-card loading-placeholder';
  placeholder.dataset.batchId = batch.id;
  const truncatedPrompt = batch.prompt.length > 60 ? batch.prompt.substring(0, 60) + '...' : batch.prompt;
  placeholder.innerHTML = `
        <div class="loading-placeholder-content">
            <div class="loading-spinner"></div>
            <span class="loading-placeholder-text">Generating...</span>
        </div>
        <div class="image-card-overlay" style="opacity: 1;">
            <p class="image-card-prompt">${escapeHtml(truncatedPrompt)}</p>
            <div class="image-card-meta">
                <span class="meta-tag">${escapeHtml(batch.modelName)}</span>
                <span class="meta-tag loading-tag">
                    <svg class="spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="2" x2="12" y2="6"></line>
                        <line x1="12" y1="18" x2="12" y2="22"></line>
                        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                        <line x1="2" y1="12" x2="6" y2="12"></line>
                        <line x1="18" y1="12" x2="22" y2="12"></line>
                        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                    </svg>
                    Pending
                </span>
            </div>
        </div>
    `;
  return placeholder;
}

function removeOnePlaceholder(batchId) {
  const placeholder = elements.gallery.querySelector(`.loading-placeholder[data-batch-id="${batchId}"]`);
  if (placeholder) {
    placeholder.remove();
  }

  // Show empty state if gallery is now empty
  if (elements.gallery.children.length === 0 ||
    (elements.gallery.children.length === 1 && elements.gallery.contains(elements.galleryEmpty))) {
    elements.galleryEmpty.style.display = 'flex';
    if (!elements.gallery.contains(elements.galleryEmpty)) {
      elements.gallery.appendChild(elements.galleryEmpty);
    }
  }
}

function prependImageCard(image, index) {
  const card = createImageCardElement(image, index);

  // Insert after any remaining placeholders
  const firstNonPlaceholder = elements.gallery.querySelector('.image-card:not(.loading-placeholder)');
  if (firstNonPlaceholder) {
    elements.gallery.insertBefore(card, firstNonPlaceholder);
  } else {
    elements.gallery.appendChild(card);
  }

  // Update indices on existing cards since we prepended
  updateCardIndices();
}

function createImageCardElement(image, index) {
  const card = document.createElement('div');
  card.className = 'image-card';
  card.dataset.imageId = image.id;

  const safeUrl = sanitizeImageUrl(image.url);
  const safePrompt = escapeHtml(image.prompt);

  card.innerHTML = `
        <div class="image-card-actions image-card-actions-top">
            <button class="image-card-btn image-card-download" title="Download image">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            </button>
            <button class="image-card-btn image-card-delete" title="Delete image">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            </button>
        </div>
        <div class="image-card-actions image-card-actions-bottom">
            <button class="image-card-btn image-card-reference" title="Use as reference">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                </svg>
            </button>
            <button class="image-card-btn image-card-recreate" title="Recreate with same settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
            </button>
        </div>
        <img src="${safeUrl}" alt="${safePrompt}" loading="lazy">
        <div class="image-card-overlay">
            <p class="image-card-prompt">${safePrompt}</p>
            <div class="image-card-meta">
                <span class="meta-tag">${escapeHtml(image.modelName || image.model)}</span>
                <span class="meta-tag">${escapeHtml(image.quality || image.size)}</span>
                <span class="meta-tag">${escapeHtml(image.aspectRatio)}</span>
            </div>
        </div>
    `;

  // Attach event handlers
  attachImageCardHandlers(card, image);

  return card;
}

function attachImageCardHandlers(card, image) {
  const imageId = image.id;

  card.querySelector('.image-card-download').addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = state.images.findIndex(img => img.id === imageId);
    if (idx !== -1) downloadImageByIndex(idx);
  });

  card.querySelector('.image-card-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = state.images.findIndex(img => img.id === imageId);
    if (idx !== -1) deleteImage(idx);
  });

  card.querySelector('.image-card-reference').addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = state.images.findIndex(img => img.id === imageId);
    if (idx !== -1) addImageAsReference(idx);
  });

  card.querySelector('.image-card-recreate').addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = state.images.findIndex(img => img.id === imageId);
    if (idx !== -1) recreateImageByIndex(idx);
  });

  card.addEventListener('click', () => {
    const idx = state.images.findIndex(img => img.id === imageId);
    if (idx !== -1) openModal(state.images[idx]);
  });
}

function updateCardIndices() {
  // No longer needed since we use image IDs instead of indices
}

async function deleteImage(index) {
  const imageToDelete = state.images[index];
  state.images.splice(index, 1);

  try {
    await ImagenDB.deleteImage(imageToDelete.id);
  } catch (e) {
    console.warn('Could not delete from IndexedDB:', e);
  }

  // Remove card from DOM without full re-render
  const card = elements.gallery.querySelector(`.image-card[data-image-id="${imageToDelete.id}"]`);
  if (card) {
    card.remove();
  }

  // Show empty state if gallery is now empty
  if (state.images.length === 0 && state.pendingBatches.length === 0) {
    elements.galleryEmpty.style.display = 'flex';
    if (!elements.gallery.contains(elements.galleryEmpty)) {
      elements.gallery.appendChild(elements.galleryEmpty);
    }
  }

  showToast('Image deleted', 'success');
}

function downloadImageByIndex(index) {
  const image = state.images[index];
  if (!image) return;

  const link = document.createElement('a');
  link.href = image.url;
  const timestamp = new Date(image.createdAt).toISOString().replace(/[:.]/g, '-');
  const ext = getImageExtension(image.url);
  link.download = `imagen-${timestamp}.${ext}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Image downloaded', 'success');
}

function addImageAsReference(index) {
  const image = state.images[index];
  if (!image) return;

  state.references.push(image.url);
  renderReferenceSlots();
  showToast('Image added as reference', 'success');
}

function recreateImageByIndex(index) {
  const image = state.images[index];
  if (!image) return;

  // Restore prompt
  elements.rawInput.value = image.prompt;
  elements.enhancedInput.value = '';
  elements.charCount.textContent = `${image.prompt.length} chars`;

  // Restore model using custom select
  state.selectedModel = image.model;
  localStorage.setItem('imagen_model', state.selectedModel);
  const modelOption = document.querySelector(`.custom-select-option[data-value="${image.model}"]`);
  if (modelOption) {
    document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
    modelOption.classList.add('selected');
    elements.modelSelectValue.textContent = modelOption.textContent;
  }
  updateGeminiOptionsVisibility();

  // Restore quality/size
  document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.quality === image.quality) {
      btn.classList.add('active');
    }
  });

  // Restore aspect ratio
  document.querySelectorAll('.btn-aspect').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.ratio === image.aspectRatio) {
      btn.classList.add('active');
    }
  });

  // Restore references
  if (image.references && image.references.length > 0) {
    state.references = [...image.references];
  } else {
    state.references = [];
  }
  renderReferenceSlots();

  showToast('Settings restored. Click Generate to recreate.', 'success');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Modal =====
function openModal(image) {
  state.currentImage = image;
  elements.modalImage.src = sanitizeImageUrl(image.url);
  elements.modalMetadata.innerHTML = `
        <p><strong>Prompt:</strong> ${escapeHtml(image.prompt)}</p>
        <p><strong>Model:</strong> ${escapeHtml(image.modelName || image.model)}</p>
        <p><strong>Size/Quality:</strong> ${escapeHtml(image.quality || image.size)}</p>
        <p><strong>Aspect Ratio:</strong> ${escapeHtml(image.aspectRatio)}</p>
        <p><strong>Created:</strong> ${escapeHtml(new Date(image.createdAt).toLocaleString())}</p>
        ${image.references?.length > 0 ? `<p><strong>References Used:</strong> ${escapeHtml(image.references.length)}</p>` : ''}
    `;
  elements.imageModal.classList.add('active');
}

function closeModal() {
  elements.imageModal.classList.remove('active');
  state.currentImage = null;
}

function useImageAsReference() {
  if (!state.currentImage) return;

  state.references.push(state.currentImage.url);
  renderReferenceSlots();
  closeModal();
  showToast('Image added as reference', 'success');
}

function recreateImage() {
  if (!state.currentImage) return;

  // Restore prompt
  elements.rawInput.value = state.currentImage.prompt;
  elements.enhancedInput.value = '';
  elements.charCount.textContent = `${state.currentImage.prompt.length} chars`;

  // Restore model using custom select
  state.selectedModel = state.currentImage.model;
  localStorage.setItem('imagen_model', state.selectedModel);
  const modelOption = document.querySelector(`.custom-select-option[data-value="${state.currentImage.model}"]`);
  if (modelOption) {
    document.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
    modelOption.classList.add('selected');
    elements.modelSelectValue.textContent = modelOption.textContent;
  }
  updateGeminiOptionsVisibility();

  // Restore quality/size
  document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.quality === state.currentImage.quality) {
      btn.classList.add('active');
      state.imageSize = btn.dataset.size;
      state.imageQuality = btn.dataset.quality;
    }
  });

  // Restore aspect ratio
  document.querySelectorAll('.btn-aspect').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.ratio === state.currentImage.aspectRatio) {
      btn.classList.add('active');
      state.aspectRatio = state.currentImage.aspectRatio;
    }
  });

  // Restore references (always update the UI, even if empty to clear previous refs)
  if (state.currentImage.references && state.currentImage.references.length > 0) {
    state.references = [...state.currentImage.references];
  } else {
    state.references = [];
  }
  renderReferenceSlots();

  closeModal();
  showToast('Settings restored. Click Generate to recreate.', 'success');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function downloadCurrentImage() {
  if (!state.currentImage) return;

  const link = document.createElement('a');
  link.href = state.currentImage.url;
  const ext = getImageExtension(state.currentImage.url);
  link.download = `imagen_${state.currentImage.id}.${ext}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Download started', 'success');
}

// ===== UI Helpers =====
function updateGeminiOptionsVisibility() {
  const isGemini = state.selectedModel.includes('gemini');
  elements.geminiOptions.style.display = isGemini ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function getImageExtension(url) {
  if (!url) return 'png';

  // Check for data URL with mime type
  if (url.startsWith('data:image/')) {
    const mimeMatch = url.match(/^data:image\/(\w+)/);
    if (mimeMatch) {
      const mime = mimeMatch[1].toLowerCase();
      // Map common mime types to extensions
      if (mime === 'jpeg') return 'jpg';
      if (mime === 'png') return 'png';
      if (mime === 'gif') return 'gif';
      if (mime === 'webp') return 'webp';
      if (mime === 'svg+xml') return 'svg';
      return mime;
    }
  }

  // Check URL extension
  if (url.startsWith('http')) {
    const urlPath = url.split('?')[0];
    const ext = urlPath.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  }

  // Default to png
  return 'png';
}

function sanitizeImageUrl(url) {
  if (!url) return '';
  // Only allow data URIs and HTTPS URLs
  if (url.startsWith('data:image/')) {
    return url;
  }
  if (url.startsWith('https://')) {
    // Escape any potential attribute-breaking characters
    return url.replace(/"/g, '%22').replace(/'/g, '%27');
  }
  // Block everything else (http, javascript:, etc.)
  console.warn('Blocked unsafe image URL:', url);
  return '';
}

// ===== Global functions for inline handlers =====
window.removeReference = removeReference;

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', init);
