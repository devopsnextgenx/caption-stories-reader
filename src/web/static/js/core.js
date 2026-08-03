/**
 * Core utilities and slideshow – used by all pages
 */

// ── utilities ──
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtmlAttribute(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function highlightNavLinks() {
  const currentPath = window.location.pathname;
  const browse = getQueryParam('browse');
  document.querySelectorAll('.nav-link').forEach((link) => {
    const url = new URL(link.href, window.location.origin);
    link.classList.remove('active');
    if (url.pathname !== currentPath) return;
    if (currentPath === '/captions-studio') {
      const linkBrowse = url.searchParams.get('browse');
      if (browse) {
        if (linkBrowse === browse) link.classList.add('active');
      } else if (!linkBrowse) {
        link.classList.add('active');
      }
      return;
    }
    link.classList.add('active');
  });
}

// ── syntax highlighting for YAML ──
function highlightYaml(text) {
  return escapeHtml(text)
    .split('\n')
    .map(line => {
      const m = line.match(/^(\s*)([^:#]+):(.*)$/);
      if (!m) return line;
      return `${m[1]}<span class="yaml-key">${m[2]}</span><span class="yaml-punctuation">:</span>${highlightYamlValue(m[3])}`;
    })
    .join('\n');
}

function highlightYamlValue(value) {
  return value
    .replace(/"(.*?)"|'(.*?)'/g, '<span class="yaml-string">$&</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="yaml-boolean">$1</span>')
    .replace(/\b-?\d+(\.\d+)?\b/g, '<span class="yaml-number">$&</span>');
}

// ── Slideshow ──
(function() {
  let ss = {
    paths: [],
    index: 0,
    browserType: 'xos',
    playing: false,
    random: false,
    intervalSecs: 7,
    _timer: null,
    _progressRaf: null,
    _progressStart: null,
    _nativeSize: false,
    overlay: null,
    isResizing: false
  };

  document.addEventListener('keydown', function(e) {
    if (!ss.overlay) return;
    handleKey(e);
  });

  window.openSlideshow = function(paths, startIndex, browserType) {
    if (!paths || !paths.length) return;
    ss.paths        = paths;
    ss.index        = Math.max(0, Math.min(startIndex, paths.length - 1));
    ss.browserType  = browserType || 'xos';
    ss.playing      = false;
    ss.random       = false;
    ss.intervalSecs = 7;
    ss._nativeSize  = false;
    buildOverlay();
    loadImage(ss.index, null);
    document.body.style.overflow = 'hidden';
  };

  function imgUrl(path) {
    let cleanPath = path.replace(/^\/+/, '').replace(/\\/g, '/');
    if (cleanPath.startsWith('data/captions/')) {
      cleanPath = cleanPath.substring('data/'.length);
    }
    if (cleanPath.startsWith('captions/') || cleanPath.startsWith('xos/')) {
      return '/' + encodeURIComponent(cleanPath).replace(/%2F/g, '/');
    }
    const prefix = ss.browserType === 'xos' ? 'xos' : 'captions';
    return `/${prefix}/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}`;
  }

  function buildOverlay() {
    closeSlideshow(false);
    const o = document.createElement('div');
    o.className  = 'slideshow-overlay Unified-ss-shell-viewport';
    o.tabIndex   = -1;
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-label', 'Image slideshow and metadata viewer');
    o.id = 'slideshow-overlay';
    o.innerHTML = `
      <div class="ss-topbar">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <span class="ss-title" id="ss-title"></span>
          <span class="ss-counter" id="ss-counter"></span>
        </div>
        <div class="ss-topbar-center">
          <button class="ss-ctrl-btn" id="ss-random-btn" title="Toggle random order">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
              <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
            </svg>
            Shuffle
          </button>
          <button class="ss-ctrl-btn" id="ss-play-btn" title="Play / Pause slideshow (Space)">
            <svg id="ss-play-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
            Play
          </button>
          <div class="ss-timer-wrap" title="Auto-advance interval">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-dim)">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <input type="range" class="ss-timer-slider" id="ss-timer-slider" min="3" max="30" step="1" value="7">
            <span class="ss-timer-label" id="ss-timer-label">7s</span>
          </div>
        </div>
        <div class="ss-topbar-right">
          <button class="ss-close-btn" id="ss-close-btn" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="caption-viewer-body ss-split-stage-layout">
        <div class="caption-viewer-image-pane ss-stage-pane" id="ss-stage">
          <button class="ss-nav-btn ss-prev" id="ss-prev-btn" aria-label="Previous image">&#8249;</button>
          <div class="ss-img-wrap fit" id="ss-img-wrap">
            <div class="ss-spinner" id="ss-spinner"></div>
          </div>
          <button class="ss-nav-btn ss-next" id="ss-next-btn" aria-label="Next image">&#8250;</button>
          <div class="ss-progress-track" id="ss-progress-track">
            <div class="ss-progress-fill" id="ss-progress-fill"></div>
          </div>
        </div>
        <div class="caption-viewer-divider hidden" id="ss-pane-divider"></div>
        <div class="caption-viewer-yaml-pane hidden" id="ss-yaml-pane">
          <div class="caption-viewer-pane-header">YAML metadata</div>
          <pre class="caption-viewer-code yaml-syntax" id="ss-yaml-code">Loading YAML…</pre>
        </div>
      </div>
      <div class="ss-filmstrip" id="ss-filmstrip"></div>
    `;
    document.body.appendChild(o);
    ss.overlay = o;
    buildFilmstrip();
    wireControls();
    o.focus();
  }

  function buildFilmstrip() {
    const strip = ss.overlay.querySelector('#ss-filmstrip');
    strip.innerHTML = ss.paths.map((p, i) => `
      <img class="ss-film-thumb${i === ss.index ? ' active' : ''}" src="${imgUrl(p)}" alt="" loading="lazy" data-index="${i}" draggable="false">
    `).join('');
    strip.querySelectorAll('.ss-film-thumb').forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(parseInt(thumb.dataset.index), 'left');
      });
    });
  }

  function syncFilmstrip(index) {
    const strip  = ss.overlay.querySelector('#ss-filmstrip');
    const thumbs = strip.querySelectorAll('.ss-film-thumb');
    thumbs.forEach((t, i) => t.classList.toggle('active', i === index));
    const active = strip.querySelector('.ss-film-thumb.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  function wireControls() {
    const o = ss.overlay;
    o.querySelector('#ss-stage').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeSlideshow(true);
    });
    o.querySelector('#ss-prev-btn').addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
    o.querySelector('#ss-next-btn').addEventListener('click', (e) => { e.stopPropagation(); step(+1); });
    const wrap = o.querySelector('#ss-img-wrap');
    wrap.addEventListener('click', (e) => e.stopPropagation());
    wrap.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      ss._nativeSize = !ss._nativeSize;
      wrap.classList.toggle('native', ss._nativeSize);
      wrap.classList.toggle('fit', !ss._nativeSize);
    });
    o.querySelector('#ss-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlay();
    });
    o.querySelector('#ss-random-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      ss.random = !ss.random;
      e.currentTarget.classList.toggle('active', ss.random);
    });
    const slider = o.querySelector('#ss-timer-slider');
    const timerLbl = o.querySelector('#ss-timer-label');
    slider.addEventListener('input', () => {
      ss.intervalSecs = parseInt(slider.value);
      timerLbl.textContent = `${ss.intervalSecs}s`;
      if (ss.playing) { stopPlay(); startPlay(); }
    });
    o.querySelector('#ss-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      closeSlideshow(true);
    });
    // Divider drag
    const divider = o.querySelector('#ss-pane-divider');
    const yamlPane = o.querySelector('#ss-yaml-pane');
    divider.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      ss.isResizing = true;
      divider.setPointerCapture(event.pointerId);
    });
    o.addEventListener('pointermove', (event) => {
      if (!ss.isResizing) return;
      const container = o.querySelector('.ss-split-stage-layout');
      const rect = container.getBoundingClientRect();
      const dividerX = event.clientX - rect.left;
      const width = rect.width - dividerX;
      const minWidth = 350, maxWidth = rect.width - 350;
      const targetWidth = Math.max(minWidth, Math.min(maxWidth, width));
      container.style.setProperty('--yaml-width', `${targetWidth}px`);
    });
    const stopResizing = () => { ss.isResizing = false; };
    o.addEventListener('pointerup', stopResizing);
    o.addEventListener('pointercancel', stopResizing);
    o.addEventListener('keydown', handleKey);
  }

  function handleKey(e) {
    if (!ss.overlay) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown':  e.preventDefault(); step(+1); break;
      case 'ArrowLeft':  case 'ArrowUp':    e.preventDefault(); step(-1); break;
      case ' ':          e.preventDefault(); togglePlay(); break;
      case 'Escape':     e.preventDefault(); closeSlideshow(true); break;
      case 'r': case 'R':
        ss.random = !ss.random;
        ss.overlay.querySelector('#ss-random-btn').classList.toggle('active', ss.random);
        break;
    }
  }

  function step(delta) {
    let next;
    if (ss.random) {
      do { next = Math.floor(Math.random() * ss.paths.length); } while (ss.paths.length > 1 && next === ss.index);
    } else {
      next = (ss.index + delta + ss.paths.length) % ss.paths.length;
    }
    navigate(next, delta >= 0 ? 'left' : 'right');
  }

  function navigate(index, dir) {
    if (index === ss.index && ss.paths.length > 1) return;
    ss.index = Math.max(0, Math.min(index, ss.paths.length - 1));
    loadImage(ss.index, dir);
    if (ss.playing) { stopPlay(); startPlay(); }
  }

  async function loadImage(index, animDir) {
    const o = ss.overlay;
    const wrap = o.querySelector('#ss-img-wrap');
    const titleEl = o.querySelector('#ss-title');
    const cntEl = o.querySelector('#ss-counter');
    const divider = o.querySelector('#ss-pane-divider');
    const yamlPane = o.querySelector('#ss-yaml-pane');
    const codeEl = o.querySelector('#ss-yaml-code');
    const path = ss.paths[index];
    titleEl.textContent = path.split('/').pop();
    cntEl.textContent = `${index + 1} / ${ss.paths.length}`;
    syncFilmstrip(index);
    ss._nativeSize = false;
    wrap.classList.add('fit');
    wrap.classList.remove('native');
    wrap.innerHTML = '<div class="ss-spinner" id="ss-spinner"></div>';
    const img = new Image();
    img.alt = path.split('/').pop();
    img.draggable = false;
    img.onload = () => {
      if (ss.paths[ss.index] !== path) return;
      wrap.innerHTML = '';
      wrap.classList.remove('anim-left', 'anim-right');
      wrap.appendChild(img);
      void wrap.offsetWidth;
      if (animDir) wrap.classList.add(animDir === 'left' ? 'anim-left' : 'anim-right');
    };
    img.onerror = () => {
      wrap.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:2rem;">Failed to load image</div>`;
    };
    img.src = imgUrl(path);
    // YAML metadata loading (if available)
    let item = null;
    if (Array.isArray(window.captionGalleryItems)) {
      item = window.captionGalleryItems.find(c => c.image_path === path || c.image_filename === path || c.yml_path === path);
    }
    if (item && item.yml_path) {
      divider.classList.remove('hidden');
      yamlPane.classList.remove('hidden');
      codeEl.textContent = 'Loading Metadata…';
      try {
        const response = await fetch(`/api/captions/details?yml_path=${encodeURIComponent(item.yml_path)}`);
        const payload = await response.json();
        const yamlText = payload.yaml_text || JSON.stringify(payload.data || payload, null, 2);
        codeEl.innerHTML = highlightYaml(yamlText);
      } catch (err) {
        codeEl.textContent = `Unable to load details.\n${err.message}`;
      }
    } else {
      divider.classList.add('hidden');
      yamlPane.classList.add('hidden');
    }
  }

  function togglePlay() {
    if (ss.playing) { stopPlay(); } else { startPlay(); }
  }

  function startPlay() {
    ss.playing = true;
    updatePlayButton();
    scheduleNext();
    startProgressBar();
  }

  function stopPlay() {
    ss.playing = false;
    clearTimeout(ss._timer);
    cancelAnimationFrame(ss._progressRaf);
    resetProgressBar();
    updatePlayButton();
  }

  function scheduleNext() {
    clearTimeout(ss._timer);
    ss._timer = setTimeout(() => {
      if (!ss.playing || !ss.overlay) return;
      step(+1);
    }, ss.intervalSecs * 1000);
  }

  function startProgressBar() {
    cancelAnimationFrame(ss._progressRaf);
    const fill = ss.overlay.querySelector('#ss-progress-fill');
    const duration = ss.intervalSecs * 1000;
    ss._progressStart = performance.now();
    function tick(now) {
      if (!ss.playing || !ss.overlay) return;
      const elapsed = now - ss._progressStart;
      const pct = Math.min((elapsed / duration) * 100, 100);
      fill.style.width = `${pct}%`;
      if (pct < 100) {
        ss._progressRaf = requestAnimationFrame(tick);
      }
    }
    ss._progressRaf = requestAnimationFrame(tick);
  }

  function resetProgressBar() {
    if (!ss.overlay) return;
    const fill = ss.overlay.querySelector('#ss-progress-fill');
    if (fill) fill.style.width = '0%';
  }

  function updatePlayButton() {
    if (!ss.overlay) return;
    const btn = ss.overlay.querySelector('#ss-play-btn');
    const iconHtml = ss.playing
      ? `<svg id="ss-play-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : `<svg id="ss-play-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
    btn.classList.toggle('active', ss.playing);
    btn.innerHTML = `${iconHtml} ${ss.playing ? 'Pause' : 'Play'}`;
  }

  function closeSlideshow(restoreScroll) {
    stopPlay();
    if (ss.overlay && ss.overlay.parentNode) {
      ss.overlay.remove();
    }
    ss.overlay = null;
    if (restoreScroll) document.body.style.overflow = '';
  }
})();

// ── auto-run nav highlight ──
document.addEventListener('DOMContentLoaded', highlightNavLinks);