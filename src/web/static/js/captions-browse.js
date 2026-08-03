/**
 * Shared logic for /browse/* and /captions-studio
 */

// ── Global state ──
window.currentBrowser = 'captions';
window.captionGalleryItems = [];

// ── Folder browsing ──
async function loadXosFolder(path = '') {
  window.currentBrowser = 'xos';
  localStorage.setItem('last_active_tab', 'xos');
  localStorage.setItem('last_browse_path_xos', path);
  const browserGrid = document.getElementById('xos-browser-grid');
  const breadcrumb = document.getElementById('xos-breadcrumb');
  const currentPath = document.getElementById('xos-current-path');
  const albumView = document.getElementById('xos-album-view');
  const albumTitle = document.getElementById('xos-album-title');
  if (!browserGrid || !breadcrumb || !currentPath) return;
  browserGrid.innerHTML = '<div class="placeholder-message">Loading folder contents...</div>';
  try {
    const resp = await fetch(`/api/captions/xos/list?path=${encodeURIComponent(path)}`);
    const data = await resp.json();
    if (!resp.ok) {
      browserGrid.innerHTML = `<div class="placeholder-message">Failed to load XOS folder: ${data.detail || 'unknown error'}</div>`;
      return;
    }
    currentPath.textContent = `/${data.path}`.replace(/\/\//g, '/');
    breadcrumb.innerHTML = renderFolderBreadcrumb(data.path, 'xos');
    const content = [];
    if (data.parent !== null) {
      content.push(renderBrowserTile({ type: 'parent', name: '..', path: data.parent || '' }));
    }
    data.directories.forEach((entry) => content.push(renderBrowserTile(entry)));
    browserGrid.innerHTML = content.join('') || '<div class="placeholder-message">No subfolders found here.</div>';
    bindBrowserTiles('#xos-browser-grid', '#xos-breadcrumb', loadXosFolder, openXosAlbum);
    populateFolderThumbnails('#xos-browser-grid', 'xos');
    applyTileSize(localStorage.getItem('xos_tile_size') || '128', '#xos-browser-grid');
    renderAndBindFolderAlbum(data.files, data.path, 'xos', {
      albumView: albumView,
      albumTitle: albumTitle,
      albumContent: document.getElementById('xos-album-content')
    });
  } catch (err) {
    browserGrid.innerHTML = `<div class="placeholder-message">Failed to load XOS folder: ${err.message}</div>`;
  }
}

async function loadCaptionsFolder(path = '') {
  const browserGrid = document.getElementById('captions-browser-grid');
  const breadcrumb = document.getElementById('captions-breadcrumb');
  const currentPath = document.getElementById('captions-current-path');
  const albumView = document.getElementById('captions-album-view');
  const albumTitle = document.getElementById('captions-album-title');
  if (!browserGrid || !breadcrumb || !currentPath) return;
  browserGrid.innerHTML = '<div class="placeholder-message">Loading captions folder contents...</div>';
  try {
    const resp = await fetch(`/api/captions/folder/list?path=${encodeURIComponent(path)}`);
    const data = await resp.json();
    if (!resp.ok) {
      browserGrid.innerHTML = `<div class="placeholder-message">Failed to load Captions folder: ${data.detail || 'unknown error'}</div>`;
      return;
    }
    window.currentBrowser = 'captions';
    localStorage.setItem('last_browse_path_captions', path);
    currentPath.textContent = `/${data.path}`.replace(/\/\//g, '/');
    breadcrumb.innerHTML = renderFolderBreadcrumb(data.path, 'captions');
    const content = [];
    if (data.parent !== null) {
      content.push(renderBrowserTile({ type: 'parent', name: '..', path: data.parent || '' }));
    }
    data.directories.forEach((entry) => content.push(renderBrowserTile(entry)));
    browserGrid.innerHTML = content.join('') || '<div class="placeholder-message">No subfolders found here.</div>';
    bindBrowserTiles('#captions-browser-grid', '#captions-breadcrumb', loadCaptionsFolder, openCaptionsAlbum);
    populateFolderThumbnails('#captions-browser-grid', 'captions');
    applyTileSize(localStorage.getItem('captions_tile_size') || '128', '#captions-browser-grid');
    renderAndBindFolderAlbum(data.files, data.path, 'captions', {
      albumView: albumView,
      albumTitle: albumTitle,
      albumContent: document.getElementById('captions-album-content')
    });
  } catch (err) {
    browserGrid.innerHTML = `<div class="placeholder-message">Failed to load Captions folder: ${err.message}</div>`;
  }
}

function renderAndBindFolderAlbum(files, path, browserType, viewElements) {
  const { albumView, albumTitle, albumContent } = viewElements;
  if (!albumView || !albumTitle || !albumContent) return;
  if (files && files.length) {
    albumView.classList.remove('hidden');
    albumTitle.textContent = path.split('/').pop() || '/';
    const prefix = browserType === 'xos' ? '/xos/' : '/captions/';
    const tileSizePref = localStorage.getItem(`${browserType}_tile_size`) || '128';
    albumContent.innerHTML = files.map((f, index) => {
      const url = `${prefix}${encodeURIComponent(f.path).replace(/%2F/g, '/')}`;
      const dimensions = f.width && f.height ? `${f.width}×${f.height}` : '';
      return `
        <div class="xos-file-tile album-preview-tile" data-path="${escapeHtml(f.path)}" data-type="file" data-index="${index}">
          <div class="xos-thumb-wrap">
            <img src="${url}" class="xos-album-thumb" alt="${escapeHtml(f.name)}">
            ${dimensions ? `<span class="tile-dimension-badge">${dimensions}</span>` : ''}
            <span class="tile-index-badge">${index + 1}</span>
          </div>
          <div class="xos-file-meta-bar">
            <span class="xos-file-name">${escapeHtml(f.name)}</span>
            <div class="album-tile-actions">
              <i class="icon-copy action-btn-inline" data-action="copy" title="Copy Path" style="cursor:pointer; margin-right:6px;">📋</i>
              <a href="${url}" download class="icon-download action-btn-inline" title="Download">⬇️</a>
            </div>
          </div>
        </div>
      `;
    }).join('');
    applyTileSize(tileSizePref, `#${browserType}-album-content`);
    // bind clicks for slideshow
    albumContent.querySelectorAll('.album-preview-tile').forEach((tile, idx) => {
      tile.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn-inline')) return;
        const path = tile.getAttribute('data-path');
        const paths = files.map(f => f.path);
        const startIndex = paths.indexOf(path);
        if (typeof openSlideshow === 'function') {
          openSlideshow(paths, startIndex < 0 ? 0 : startIndex, browserType);
        }
      });
    });
  } else {
    albumView.classList.add('hidden');
    albumTitle.textContent = '';
  }
}

function renderFolderBreadcrumb(path, rootLabel) {
  const segments = path ? path.split('/').filter(Boolean) : [];
  const crumbs = [
    `<button type="button" class="breadcrumb-button" data-path="">${escapeHtml(rootLabel)}</button>`
  ];
  let current = '';
  segments.forEach((segment) => {
    current = current ? `${current}/${segment}` : segment;
    crumbs.push(`<span class="breadcrumb-separator">/</span>`);
    crumbs.push(`<button type="button" class="breadcrumb-button" data-path="${escapeHtmlAttribute(current)}">${escapeHtml(segment)}</button>`);
  });
  return crumbs.join('');
}

function renderTileActions(actions = []) {
  return actions.map(a => `
    <button class="tile-action-btn" data-action="${escapeHtmlAttribute(a.action)}" data-tooltip="${escapeHtmlAttribute(a.tooltip)}" title="${escapeHtmlAttribute(a.tooltip)}">
      ${a.icon}
    </button>
  `).join('');
}

function renderCheckbox() {
  return `
    <div class="tile-select-check" data-role="select-check" title="Select">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 6L5 9L10 3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  `;
}

function renderBrowserTile(entry) {
  if (entry.type === 'directory' || entry.type === 'parent') {
    const displayName = entry.name || (entry.path || '').split('/').pop() || 'folder';
    const isParent = entry.type === 'parent';
    return `
      <div class="xos-folder-tile" data-path="${escapeHtmlAttribute(entry.path || '')}" data-type="directory">
        <div class="xos-thumb-wrap">
          <img class="xos-thumb" src="/static/folder-placeholder.png" alt="folder thumb" loading="lazy" />
          <div class="tile-overlay">${renderTileActions([])}</div>
          ${renderCheckbox()}
          <div class="xos-folder-count">0 images</div>
        </div>
        <div class="xos-folder-label" title="${escapeHtmlAttribute(displayName)}">
          <div class="xos-folder-name">${escapeHtml(displayName)}</div>
          ${isParent ? '<div class="xos-folder-meta">Parent folder</div>' : '<div class="xos-folder-meta"></div>'}
        </div>
      </div>
    `;
  }
  const isImage = entry.extension && entry.extension.match(/\.(jpg|jpeg|png|bmp|webp|tiff)$/i);
  const url = (window.currentBrowser === 'xos')
    ? `/xos/${encodeURIComponent(entry.path).replace(/%2F/g, '/')}`
    : `/captions/${encodeURIComponent(entry.path).replace(/%2F/g, '/')}`;
  const dimensionsStr = (entry.width && entry.height) ? `${entry.width}x${entry.height}` : (entry.dimensions ? entry.dimensions : '');
  const sizeStr = entry.size_bytes ? formatFileSize(entry.size_bytes) : (entry.extension || '').replace(/^\./, '').toUpperCase();
  const meta = dimensionsStr ? `${dimensionsStr} • ${sizeStr}` : sizeStr;
  const sizeBadge = entry.size_bytes ? `<div class="xos-file-size-badge">${escapeHtml(sizeStr)}</div>` : '';
  const indexLabel = entry.index || entry.name?.split?.('.')?.shift?.() || '1';
  const thumbHtml = isImage
    ? `<img class="xos-thumb" src="${url}" alt="${escapeHtml(entry.name)}" loading="lazy">`
    : `<div class="xos-file-icon">${entry.extension === '.mp4' ? '🎬' : '📄'}</div>`;
  return `
    <div class="xos-file-tile" data-path="${escapeHtmlAttribute(entry.path)}" data-type="file" data-extension="${escapeHtmlAttribute(entry.extension || '')}">
      <div class="xos-thumb-wrap">
        ${thumbHtml}
        <div class="tile-overlay">${renderTileActions([])}</div>
        ${renderCheckbox()}
        <div class="xos-file-index">${escapeHtml(String(indexLabel))}</div>
        ${sizeBadge}
      </div>
      <div class="xos-file-label" title="${escapeHtmlAttribute(entry.name)}">
        <div class="xos-file-name">${escapeHtml(entry.name)}</div>
        <div class="xos-file-meta">${escapeHtml(meta)}</div>
      </div>
    </div>
  `;
}

function bindBrowserTiles(containerSelector, breadcrumbSelector, onDirectory, onFile) {
  const grid = document.querySelector(containerSelector);
  if (!grid) return;
  grid.querySelectorAll('.xos-folder-tile, .xos-file-tile').forEach((tile) => {
    tile.addEventListener('click', (e) => {
      const isSelectionModeActive = document.getElementById('selection-mode-checkbox')?.checked;
      const checkEl = e.target.closest('[data-role="select-check"]');
      if (checkEl) {
        e.stopPropagation();
        if (tile.classList.contains('xos-folder-tile') && !isSelectionModeActive) {
          const path = tile.getAttribute('data-path') || '';
          const tab = window.currentBrowser || 'captions';
          localStorage.setItem(`last_browse_path_${tab}`, path);
          onDirectory(path);
          return;
        }
        tile.classList.toggle('selected');
        checkEl.classList.toggle('checked', tile.classList.contains('selected'));
        return;
      }
      const actionBtn = e.target.closest('.tile-action-btn');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const path = tile.getAttribute('data-path') || '';
        const type = tile.getAttribute('data-type');
        handleTileAction(action, path, type, tile);
        return;
      }
      const currentTile = e.currentTarget;
      const path = currentTile.getAttribute('data-path') || '';
      const type = currentTile.getAttribute('data-type');
      if (type === 'directory') {
        const tab = window.currentBrowser || 'captions';
        localStorage.setItem(`last_browse_path_${tab}`, path);
        onDirectory(path);
      } else if (type === 'file') {
        onFile(path);
      }
    });
  });
  document.querySelectorAll(`${breadcrumbSelector} .breadcrumb-button`).forEach((crumb) => {
    crumb.addEventListener('click', (e) => {
      const path = e.currentTarget.getAttribute('data-path') || '';
      const tab = window.currentBrowser || 'captions';
      localStorage.setItem(`last_browse_path_${tab}`, path);
      onDirectory(path);
    });
  });
}

function openCaptionsAlbum(path) {
  if (!path) return;
  const ext = path.split('.').pop().toLowerCase();
  const isImage = ['jpg','jpeg','png','bmp','webp','tiff'].includes(ext);
  if (isImage) {
    const allTiles = Array.from(document.querySelectorAll('#captions-browser-grid .xos-file-tile'));
    const imagePaths = allTiles
      .map(t => t.dataset.path)
      .filter(p => ['jpg','jpeg','png','bmp','webp','tiff'].includes(p.split('.').pop().toLowerCase()));
    const startIndex = imagePaths.indexOf(path);
    openSlideshow(imagePaths, startIndex < 0 ? 0 : startIndex, 'captions');
    return;
  }
  // fallback for non‑image files
  const albumView = document.getElementById('captions-album-view');
  const albumTitle = document.getElementById('captions-album-title');
  const albumContent = document.getElementById('captions-album-content');
  if (!albumView || !albumTitle || !albumContent) return;
  const url = `/captions/${encodeURIComponent(path).replace(/%2F/g, '/').replace(/%5C/g, '/')}`;
  const preview = ext === 'mp4'
    ? `<video controls class="xos-album-preview"><source src="${url}" type="video/mp4">Your browser does not support MP4 video.</video>`
    : `<div class="file-preview-message">Preview not available for this file type.<br><strong>${escapeHtml(path)}</strong></div>`;
  albumTitle.textContent = path.split('/').pop();
  albumContent.innerHTML = preview;
  albumView.classList.remove('hidden');
}

function openXosAlbum(path) {
  // same as openCaptionsAlbum but for xos
  if (!path) return;
  const ext = path.split('.').pop().toLowerCase();
  const isImage = ['jpg','jpeg','png','bmp','webp','tiff'].includes(ext);
  if (isImage) {
    const allTiles = Array.from(document.querySelectorAll('#xos-browser-grid .xos-file-tile'));
    const imagePaths = allTiles
      .map(t => t.dataset.path)
      .filter(p => ['jpg','jpeg','png','bmp','webp','tiff'].includes(p.split('.').pop().toLowerCase()));
    const startIndex = imagePaths.indexOf(path);
    openSlideshow(imagePaths, startIndex < 0 ? 0 : startIndex, 'xos');
    return;
  }
  const albumView = document.getElementById('xos-album-view');
  const albumTitle = document.getElementById('xos-album-title');
  const albumContent = document.getElementById('xos-album-content');
  if (!albumView || !albumTitle || !albumContent) return;
  const url = `/xos/${encodeURIComponent(path).replace(/%2F/g, '/').replace(/%5C/g, '/')}`;
  const preview = ext === 'mp4'
    ? `<video controls class="xos-album-preview"><source src="${url}" type="video/mp4">Your browser does not support MP4 video.</video>`
    : `<img src="${url}" class="xos-album-preview" alt="${escapeHtml(path)}">`;
  albumTitle.textContent = path.split('/').pop();
  albumContent.innerHTML = preview;
  albumView.classList.remove('hidden');
}

function handleTileAction(action, path, type, tile) {
  // placeholder for custom actions
  console.debug('[tile-action]', action, path);
}

async function populateFolderThumbnails(containerSelector, apiType) {
  document.querySelectorAll(`${containerSelector} .xos-folder-tile`).forEach(async (tile) => {
    const path = tile.dataset.path || '';
    const thumbImg = tile.querySelector('.xos-thumb');
    const countEl = tile.querySelector('.xos-folder-count');
    if (!path) return;
    const result = await findFirstImageInFolder(apiType, path);
    if (result && result.url) {
      if (thumbImg) thumbImg.src = result.url;
      if (countEl) countEl.textContent = `${result.count || 0} images`;
    } else {
      if (thumbImg) thumbImg.src = '/static/folder-placeholder.png';
      if (countEl) countEl.textContent = `${result?.count || 0} images`;
    }
  });
}

async function findFirstImageInFolder(apiType, path) {
  const listUrl = apiType === 'xos' ? `/api/captions/xos/list?path=${encodeURIComponent(path)}` : `/api/captions/folder/list?path=${encodeURIComponent(path)}`;
  try {
    const resp = await fetch(listUrl);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data.files)) {
      const image = data.files.find(f => /\.(jpg|jpeg|png|bmp|webp|tiff)$/i.test(f.name || f.path || ''));
      if (image) return { path: image.path || image.name, url: apiType === 'xos' ? `/xos/${encodeURIComponent(image.path || image.name).replace(/%2F/g, '/')}` : `/captions/${encodeURIComponent(image.path || image.name).replace(/%2F/g, '/')}`, count: data.files.length };
    }
    if (Array.isArray(data.directories)) {
      for (const d of data.directories) {
        const nested = await findFirstImageInFolder(apiType, d.path || d.name || '');
        if (nested) {
          return { path: nested.path, url: nested.url, count: (data.files?.length || 0) + (nested.count || 0) };
        }
      }
    }
    return { path: null, url: null, count: data.files?.length || 0 };
  } catch (err) {
    return null;
  }
}

function applyTileSize(size, containerSelector = null) {
  const px = Number(size) || 128;
  const selector = containerSelector || 'body';
  document.querySelectorAll(`${selector} .xos-folder-tile, ${selector} .xos-file-tile`).forEach((tile) => {
    tile.style.setProperty('--tile-size', `${px}px`);
    tile.style.width = `${px}px`;
    tile.style.minWidth = `${px}px`;
    tile.style.maxWidth = `${px}px`;
    const thumbWrap = tile.querySelector('.xos-thumb-wrap');
    if (thumbWrap) thumbWrap.style.height = `${px}px`;
  });
  document.querySelectorAll(`${selector} .xos-album-thumb`).forEach((img) => {
    img.style.width = `${px}px`;
    img.style.height = `${px}px`;
    img.style.minWidth = `${px}px`;
    img.style.objectFit = 'cover';
    img.style.borderRadius = '8px';
  });
}

function syncActiveSizeSelect(tab) {
  const activeSizeSelect = document.getElementById('active-size-select');
  if (activeSizeSelect) {
    activeSizeSelect.value = localStorage.getItem(`${tab}_tile_size`) || '128';
  }
}

function switchStudioTab(tab, path = '') {
  const captionsTabBtn = document.getElementById('captions-tab-btn');
  const xosTabBtn = document.getElementById('xos-tab-btn');
  const captionsPane = document.getElementById('captions-pane');
  const xosPane = document.getElementById('xos-browser-pane');
  if (captionsTabBtn) captionsTabBtn.classList.toggle('active', tab === 'captions');
  if (xosTabBtn) xosTabBtn.classList.toggle('active', tab === 'xos');
  if (captionsPane) captionsPane.classList.toggle('hidden', tab !== 'captions');
  if (xosPane) xosPane.classList.toggle('hidden', tab !== 'xos');
  localStorage.setItem('last_active_tab', tab);
  const targetPath = path || localStorage.getItem(`last_browse_path_${tab}`) || '';
  if (tab === 'captions') loadCaptionsFolder(targetPath);
  else loadXosFolder(targetPath);
}

// ── Captions Studio: upload, batch, gallery ──
function updateUploadProgress(percent, statusText) {
  const progressFill = document.getElementById('upload-progress-fill');
  const progressText = document.getElementById('upload-progress-text');
  if (progressFill) progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (progressText) progressText.textContent = statusText;
}

function renderUploadPreview(file) {
  const previewWrap = document.getElementById('upload-preview-wrap');
  const previewImg = document.getElementById('upload-preview-image');
  if (!previewWrap || !previewImg) return;
  const fileUrl = URL.createObjectURL(file);
  previewImg.src = fileUrl;
  previewImg.alt = `Preview for ${file.name}`;
  previewWrap.style.display = 'block';
}

async function handleFileUpload(file) {
  const statusDiv = document.getElementById('upload-status');
  if (statusDiv) {
    statusDiv.textContent = `Uploading & preparing ${file.name}...`;
    statusDiv.style.color = '#818cf8';
  }
  renderUploadPreview(file);
  updateUploadProgress(12, 'Uploading image...');
  const formData = new FormData();
  formData.append('file', file);
  try {
    updateUploadProgress(22, 'Processing image...');
    const resp = await fetch('/api/captions/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.detail || 'Upload processing failed');
    updateUploadProgress(100, 'Processing complete');
    if (statusDiv) {
      statusDiv.textContent = `Processing complete for ${file.name}! Saved to ${data.result?.yaml_path}`;
      statusDiv.style.color = '#34d399';
    }
    loadCaptionsGallery();
  } catch (err) {
    updateUploadProgress(0, 'Upload failed');
    if (statusDiv) {
      statusDiv.textContent = `Upload failed: ${err.message}`;
      statusDiv.style.color = '#f87171';
    }
  }
}

async function startBatchProcessing() {
  const progressCard = document.getElementById('batch-progress-card');
  const progressBar = document.getElementById('batch-progress-bar');
  const progressStatus = document.getElementById('batch-progress-status');
  if (progressCard) progressCard.style.display = 'block';
  try {
    const resp = await fetch('/api/captions/process-batch', { method: 'POST' });
    const data = await resp.json();
    const jobId = data.job_id;
    pollJobStatus(jobId, progressBar, progressStatus, progressCard);
  } catch (err) {
    if (progressStatus) progressStatus.textContent = `Batch start error: ${err.message}`;
  }
}

function pollJobStatus(jobId, progressBar, progressStatus, progressCard) {
  let lastCompletedCount = -1;
  const interval = setInterval(async () => {
    try {
      const resp = await fetch(`/api/captions/jobs/${jobId}`);
      const job = await resp.json();
      if (job.total > 0) {
        const percent = Math.round((job.completed / job.total) * 100);
        if (progressBar) progressBar.style.width = percent + '%';
        if (progressStatus) progressStatus.textContent = `Processed ${job.completed} of ${job.total} images (${percent}%)`;
      }
      if (job.completed > lastCompletedCount) {
        lastCompletedCount = job.completed;
        loadCaptionsGallery();
      }
      if (job.status === 'completed') {
        clearInterval(interval);
        if (progressStatus) progressStatus.textContent = 'Batch extraction completed successfully!';
        loadCaptionsGallery();
      }
    } catch (err) {
      clearInterval(interval);
    }
  }, 5000);
}

async function loadCaptionsGallery() {
  const gallery = document.getElementById('captions-studio-gallery');
  if (!gallery) return;
  try {
    const resp = await fetch('/api/captions');
    const data = await resp.json();
    window.captionGalleryItems = data.captions || [];
    if (!data.captions || data.captions.length === 0) {
      gallery.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2rem;">No caption YAML files generated yet. Upload an image above or run batch processing!</div>';
      return;
    }
    gallery.innerHTML = data.captions.map((c, index) => renderCaptionCard(c, index)).join('');
    bindGalleryCardActions();
  } catch (err) {
    gallery.innerHTML = 'Failed to load captions.';
  }
}

function bindGalleryCardActions() {
  const gallery = document.getElementById('captions-studio-gallery');
  if (!gallery) return;
  gallery.querySelectorAll('.caption-card').forEach((card, index) => {
    const button = card.querySelector('.view-yaml-btn');
    const image = card.querySelector('.caption-thumb');
    const openCardViewer = (event) => {
      if (event) event.stopPropagation();
      const targetIndex = Number(button ? button.dataset.index || index : image.dataset.index || index);
      if (Array.isArray(window.captionGalleryItems) && window.captionGalleryItems.length) {
        const paths = window.captionGalleryItems.map(c => c.image_path || c.yml_path);
        openSlideshow(paths, targetIndex, 'captions');
      }
    };
    if (button) button.addEventListener('click', openCardViewer);
    if (image) image.addEventListener('click', openCardViewer);
  });
}

function resolveCaptionImageUrl(item) {
  if (!item) return '/static/placeholder.png';
  if (item.image_url) return item.image_url;
  const imagePath = item.image_path || item.image_filename || '';
  if (!imagePath) return '/static/placeholder.png';
  const normalized = String(imagePath).replace(/\\/g, '/').replace(/^\/+/, '');
  return `/captions/${encodeURIComponent(normalized).replace(/%2F/g, '/')}`;
}

function renderCaptionCard(item, index = 0) {
  const name = item.image_name || item.image_filename || 'Image';
  const ymlPath = item.yml_path || '';
  const imgUrl = resolveCaptionImageUrl(item);
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const tagHtml = tags.length > 0
    ? tags.slice(0, 3).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')
    : '<span class="tag-pill tag-empty">No tags</span>';
  return `
    <div class="caption-card" data-yaml-path="${escapeHtmlAttribute(ymlPath)}">
      <div class="caption-thumb-wrap">
        <img class="caption-thumb" src="${imgUrl}" alt="${escapeHtml(name)}" data-index="${index}" data-yml-path="${escapeHtmlAttribute(ymlPath)}">
        <button class="view-yaml-btn" data-index="${index}" data-yml-path="${escapeHtmlAttribute(ymlPath)}" title="View Metadata Info">📄</button>
      </div>
      <div class="caption-meta">
        <div class="xos-file-name" style="font-size:0.85rem;font-weight:600;">${escapeHtml(name)}</div>
        <div class="tag-cloud">${tagHtml}</div>
      </div>
    </div>
  `;
}

// ── init functions ──
function initCaptionsStudio() {
  loadCaptionsGallery();
  const uploadArea = document.getElementById('file-upload-area');
  const fileInput = document.getElementById('image-file-input');
  if (uploadArea && fileInput) {
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFileUpload(e.target.files[0]);
    });
  }
  const startBatchBtn = document.getElementById('start-batch-btn');
  if (startBatchBtn) startBatchBtn.addEventListener('click', startBatchProcessing);
  const captionsTabBtn = document.getElementById('captions-tab-btn');
  const xosTabBtn = document.getElementById('xos-tab-btn');
  if (captionsTabBtn && xosTabBtn) {
    captionsTabBtn.addEventListener('click', () => switchStudioTab('captions'));
    xosTabBtn.addEventListener('click', () => switchStudioTab('xos'));
  }
  const captionsRefreshBtn = document.getElementById('captions-refresh-btn');
  const xosRefreshBtn = document.getElementById('xos-refresh-btn');
  if (captionsRefreshBtn) captionsRefreshBtn.addEventListener('click', () => loadCaptionsFolder());
  if (xosRefreshBtn) xosRefreshBtn.addEventListener('click', () => loadXosFolder());
  const captionsSizeSelect = document.getElementById('captions-size-select');
  const xosSizeSelect = document.getElementById('xos-size-select');
  if (captionsSizeSelect) {
    captionsSizeSelect.value = localStorage.getItem('captions_tile_size') || '128';
    captionsSizeSelect.addEventListener('change', (e) => {
      localStorage.setItem('captions_tile_size', e.target.value);
      applyTileSize(e.target.value, '#captions-browser-grid');
      applyTileSize(e.target.value, '#captions-album-content');
    });
  }
  if (xosSizeSelect) {
    xosSizeSelect.value = localStorage.getItem('xos_tile_size') || '128';
    xosSizeSelect.addEventListener('change', (e) => {
      localStorage.setItem('xos_tile_size', e.target.value);
      applyTileSize(e.target.value, '#xos-browser-grid');
      applyTileSize(e.target.value, '#xos-album-content');
    });
  }
  const initialBrowse = getQueryParam('browse') || 'captions';
  const initialPath = getQueryParam('path') || localStorage.getItem(`last_browse_path_${initialBrowse}`) || '';
  switchStudioTab(initialBrowse, initialPath);
}

function initBrowsePage() {
  const captionsTabBtn = document.getElementById('captions-tab-btn');
  const xosTabBtn = document.getElementById('xos-tab-btn');
  if (captionsTabBtn && xosTabBtn) {
    captionsTabBtn.addEventListener('click', () => {
      window.history.replaceState({}, '', '/browse/captions');
      switchStudioTab('captions');
      syncActiveSizeSelect('captions');
    });
    xosTabBtn.addEventListener('click', () => {
      window.history.replaceState({}, '', '/browse/xos');
      switchStudioTab('xos');
      syncActiveSizeSelect('xos');
    });
  }
  const activeSizeSelect = document.getElementById('active-size-select');
  if (activeSizeSelect) {
    const path = window.location.pathname;
    const initialTab = path === '/browse/xos' ? 'xos' : 'captions';
    activeSizeSelect.value = localStorage.getItem(`${initialTab}_tile_size`) || '128';
    activeSizeSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      const tab = window.currentBrowser || 'captions';
      localStorage.setItem(`${tab}_tile_size`, val);
      applyTileSize(val, `#${tab}-browser-grid`);
      applyTileSize(val, `#${tab}-album-content`);
    });
  }
  const activeRefreshBtn = document.getElementById('active-refresh-btn');
  if (activeRefreshBtn) {
    activeRefreshBtn.addEventListener('click', () => {
      const tab = window.currentBrowser || 'captions';
      if (tab === 'xos') loadXosFolder();
      else loadCaptionsFolder();
    });
  }
  const selectionCheckbox = document.getElementById('selection-mode-checkbox');
  if (selectionCheckbox) {
    selectionCheckbox.addEventListener('change', () => {
      document.querySelectorAll('.browser-tile-grid, #captions-browser-grid, #xos-browser-grid').forEach(grid => {
        grid.classList.toggle('selection-mode-active', selectionCheckbox.checked);
      });
      if (!selectionCheckbox.checked) {
        document.querySelectorAll('.xos-folder-tile.selected, .xos-file-tile.selected').forEach(tile => {
          tile.classList.remove('selected');
          const check = tile.querySelector('.tile-select-check');
          if (check) check.classList.remove('checked');
        });
      }
    });
  }
  const searchInput = document.getElementById('browser-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim().toLowerCase();
      const tab = window.currentBrowser || 'captions';
      const grid = document.getElementById(`${tab}-browser-grid`);
      if (!grid) return;
      grid.querySelectorAll('.xos-folder-tile, .xos-file-tile').forEach(tile => {
        const name = (tile.querySelector('.xos-folder-name, .xos-file-name')?.textContent || '').toLowerCase();
        tile.style.display = (!query || name.includes(query)) ? '' : 'none';
      });
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });
  }
  const pathName = window.location.pathname;
  let initialBrowse = pathName === '/browse/xos' ? 'xos' : 'captions';
  if (pathName === '/browse' || pathName === '/browse/') {
    initialBrowse = localStorage.getItem('last_active_tab') || 'captions';
    window.history.replaceState({}, '', `/browse/${initialBrowse}`);
  }
  const initialPath = localStorage.getItem(`last_browse_path_${initialBrowse}`) || getQueryParam('path') || '';
  localStorage.setItem('last_active_tab', initialBrowse);
  syncActiveSizeSelect(initialBrowse);
  switchStudioTab(initialBrowse, initialPath);
}

// ── auto-run ──
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  if (path === '/captions-studio') initCaptionsStudio();
  else if (path.startsWith('/browse')) initBrowsePage();
});