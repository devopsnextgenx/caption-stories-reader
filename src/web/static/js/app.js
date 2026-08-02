/**
 * Caption Stories Reader - Frontend Application Script
 */

document.addEventListener('DOMContentLoaded', () => {
    highlightNavLinks();

    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') {
        initDashboard();
    } else if (path === '/admin') {
        initAdmin();
    } else if (path === '/captions-studio') {
        initCaptionsStudio();
    } else if (path.startsWith('/browse')) {
        initBrowsePage();
    }
});

// Catch-all click listener targeting the album preview containers explicitly
document.addEventListener('click', function (e) {
    const previewTile = e.target.closest('.album-preview-tile');
    if (!previewTile) return;

    // If an action utility inside the tile bar was targeted, let the normal bubbles handle it
    if (e.target.closest('.action-btn-inline')) return;

    e.preventDefault();
    e.stopPropagation();

    const clickedPath = previewTile.getAttribute('data-path');
    const container = previewTile.closest('#xos-album-content, #captions-album-content');
    if (!container) return;

    // Reconstruct the collection index context actively from the rendered DOM elements
    const allTiles = Array.from(container.querySelectorAll('.album-preview-tile'));
    const allPaths = allTiles.map(t => t.getAttribute('data-path'));
    const startIndex = allPaths.indexOf(clickedPath);
    const namespace = container.id.includes('xos') ? 'xos' : 'captions';

    if (typeof window.openSlideshow === 'function') {
        window.openSlideshow(allPaths, startIndex < 0 ? 0 : startIndex, namespace);
    } else if (typeof openSlideshow === 'function') {
        openSlideshow(allPaths, startIndex < 0 ? 0 : startIndex, namespace);
    } else {
        console.error("Slideshow execution failure: openSlideshow runtime function is missing.");
    }
});

function bindAlbumPreviewListeners(containerSelector, allImagePaths, contextNamespace) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    container.querySelectorAll('.album-preview-tile').forEach((tile) => {
        tile.addEventListener('click', (e) => {
            // Intercept inline copy/download utilities
            const actionBtn = e.target.closest('.action-btn-inline');
            if (actionBtn) {
                e.preventDefault();
                e.stopPropagation();
                const action = actionBtn.dataset.action || (actionBtn.tagName === 'A' ? 'download' : '');
                const path = tile.getAttribute('data-path');
                if (action === 'copy') {
                    navigator.clipboard.writeText(path).then(() => alert('Path copied!'));
                }
                return;
            }

            // Launch Slideshow matching the specific index positioning clicked
            const path = tile.getAttribute('data-path');
            const startIndex = allImagePaths.indexOf(path);
            
            if (typeof window.openSlideshow === 'function') {
                window.openSlideshow(allImagePaths, startIndex < 0 ? 0 : startIndex, contextNamespace);
            } else {
                console.error("Slideshow module is not initialized globally.");
            }
        });
    });
}

/**
 * Unified folder album renderer and listener binder
 */
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
        bindAlbumPreviewListeners(`#${browserType}-album-content`, files.map(f => f.path), browserType);
    } else {
        albumView.classList.add('hidden');
        albumTitle.textContent = '';
    }
}

async function loadXosFolder(path = '') {
    window.currentBrowser = 'xos';
    localStorage.setItem('last_active_tab', 'xos');
    localStorage.setItem('last_browse_path_xos', path); // Hard sync state

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
        breadcrumb.innerHTML = renderXosBreadcrumb(data.path);
        const content = [];

        // 1. Render Parent Directory Navigation
        if (data.parent !== null) {
            content.push(renderBrowserTile({
                type: 'parent',
                name: '..',
                path: data.parent || '',
            }));
        }

        // 2. ONLY render directory tiles in the main Browse Folder grid
        data.directories.forEach((entry) => content.push(renderBrowserTile(entry)));

        browserGrid.innerHTML = content.join('') || '<div class="placeholder-message">No subfolders found here.</div>';
        
        // Bind event listeners only to the active folder items
        bindBrowserTiles('#xos-browser-grid', '#xos-breadcrumb', loadXosFolder, openXosAlbum);
        populateFolderThumbnails('#xos-browser-grid', 'xos');
        
        const pref = localStorage.getItem('xos_tile_size') || '128';
        applyTileSize(pref, '#xos-browser-grid');

        // 3. Unify handling file layouts down inside the Folder Album section
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
        // Persist the last successfully loaded path
        localStorage.setItem('last_browse_path_captions', path);
        currentPath.textContent = `/${data.path}`.replace(/\/\//g, '/');
        breadcrumb.innerHTML = renderFolderBreadcrumb(data.path, 'captions');
        const content = [];

        // 1. Parent Directory
        if (data.parent !== null) {
            content.push(renderBrowserTile({
                type: 'parent',
                name: '..',
                path: data.parent || '',
            }));
        }

        // 2. ONLY folders allowed in the main folder view grid
        data.directories.forEach((entry) => content.push(renderBrowserTile(entry)));

        browserGrid.innerHTML = content.join('') || '<div class="placeholder-message">No subfolders found here.</div>';
        
        bindBrowserTiles('#captions-browser-grid', '#captions-breadcrumb', loadCaptionsFolder, openCaptionsAlbum);
        populateFolderThumbnails('#captions-browser-grid', 'captions');
        
        const cpref = localStorage.getItem('captions_tile_size') || '128';
        applyTileSize(cpref, '#captions-browser-grid');

        // 3. Unify handling file layouts down inside the Folder Album section
        renderAndBindFolderAlbum(data.files, data.path, 'captions', {
            albumView: albumView,
            albumTitle: albumTitle,
            albumContent: document.getElementById('captions-album-content')
        });
    } catch (err) {
        browserGrid.innerHTML = `<div class="placeholder-message">Failed to load Captions folder: ${err.message}</div>`;
    }
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

/* Dashboard Initialization */
async function initDashboard() {
    loadSystemStatus();
    loadRecentCaptionsPreview();
}

async function loadSystemStatus() {
    try {
        const resp = await fetch('/api/admin/status');
        const data = await resp.json();

        const statusBadge = document.getElementById('system-status-badge');
        if (statusBadge) {
            if (data.status === 'healthy') {
                statusBadge.className = 'badge badge-green';
                statusBadge.textContent = 'System Healthy';
            } else {
                statusBadge.className = 'badge badge-amber';
                statusBadge.textContent = 'Degraded';
            }
        }

        const ollamaStatus = document.getElementById('ollama-status');
        if (ollamaStatus) {
            ollamaStatus.textContent = data.ollama?.connected ? `Connected (${data.ollama.vision_model})` : 'Disconnected';
            ollamaStatus.className = data.ollama?.connected ? 'stat-value badge-green' : 'stat-value badge-red';
        }

        const qdrantStatus = document.getElementById('qdrant-status');
        if (qdrantStatus) {
            qdrantStatus.textContent = data.qdrant?.connected ? `Connected (${data.qdrant.collection})` : 'Disconnected / Pending';
            qdrantStatus.className = data.qdrant?.connected ? 'stat-value badge-green' : 'stat-value badge-amber';
        }

        const imagesCount = document.getElementById('total-images-count');
        if (imagesCount) imagesCount.textContent = data.data?.total_images || 0;

        const yamlsCount = document.getElementById('processed-yamls-count');
        if (yamlsCount) yamlsCount.textContent = data.data?.processed_yamls || 0;

    } catch (err) {
        console.error('Failed to load status:', err);
    }
}

async function loadRecentCaptionsPreview() {
    const gallery = document.getElementById('dashboard-gallery');
    if (!gallery) return;

    try {
        const resp = await fetch('/api/captions');
        const data = await resp.json();

        if (!data.captions || data.captions.length === 0) {
            gallery.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No processed caption images found yet. Head to Captions Studio to run extraction!</div>';
            return;
        }

        gallery.innerHTML = data.captions.slice(0, 6).map(c => renderCaptionCard(c)).join('');
    } catch (err) {
        console.error('Failed to load captions:', err);
    }
}

/* Admin Page Initialization */
async function initAdmin() {
    loadConfigYaml();
    loadSystemLogs();

    const saveBtn = document.getElementById('save-config-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveConfigYaml);
    }
}

async function loadConfigYaml() {
    const editor = document.getElementById('config-yaml-editor');
    if (!editor) return;

    try {
        const resp = await fetch('/api/admin/config');
        const data = await resp.json();
        editor.value = JSON.stringify(data, null, 2);
    } catch (err) {
        console.error('Failed to fetch config:', err);
    }
}

async function saveConfigYaml() {
    const editor = document.getElementById('config-yaml-editor');
    const msg = document.getElementById('config-save-msg');
    if (!editor) return;

    try {
        const jsonConfig = JSON.parse(editor.value);
        const resp = await fetch('/api/admin/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonConfig)
        });

        if (resp.ok) {
            if (msg) {
                msg.style.color = '#34d399';
                msg.textContent = 'Configuration saved successfully!';
            }
        } else {
            throw new Error('Save failed');
        }
    } catch (err) {
        if (msg) {
            msg.style.color = '#f87171';
            msg.textContent = 'Error saving config: ' + err.message;
        }
    }
}

async function loadSystemLogs() {
    const logBox = document.getElementById('system-logs-box');
    if (!logBox) return;

    try {
        const resp = await fetch('/api/admin/logs?max_lines=100');
        const data = await resp.json();
        logBox.textContent = data.logs.join('\n');
    } catch (err) {
        logBox.textContent = 'Failed to load system logs.';
    }
}

/* Captions Studio Initialization */
async function initCaptionsStudio() {
    loadCaptionsGallery();

    const uploadArea = document.getElementById('file-upload-area');
    const fileInput = document.getElementById('image-file-input');

    if (uploadArea && fileInput) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                handleFileUpload(e.target.files[0]);
            }
        });
    }

    const startBatchBtn = document.getElementById('start-batch-btn');
    if (startBatchBtn) {
        startBatchBtn.addEventListener('click', startBatchProcessing);
    }

    const captionsTabBtn = document.getElementById('captions-tab-btn');
    const xosTabBtn = document.getElementById('xos-tab-btn');
    if (captionsTabBtn && xosTabBtn) {
        captionsTabBtn.addEventListener('click', () => switchStudioTab('captions'));
        xosTabBtn.addEventListener('click', () => switchStudioTab('xos'));
    }

    const captionsRefreshBtn = document.getElementById('captions-refresh-btn');
    const xosRefreshBtn = document.getElementById('xos-refresh-btn');
    if (captionsRefreshBtn) {
        captionsRefreshBtn.addEventListener('click', () => loadCaptionsFolder());
    }
    if (xosRefreshBtn) {
        xosRefreshBtn.addEventListener('click', () => loadXosFolder());
    }

    // Tile size selectors
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
    // Check URL param first, fallback to localStorage cache, default to empty root
    const initialPath = getQueryParam('path') || localStorage.getItem(`last_browse_path_${initialBrowse}`) || '';
    switchStudioTab(initialBrowse, initialPath);
}

async function initBrowsePage() {
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

    const captionsSizeSelect = document.getElementById('captions-size-select');
    const xosSizeSelect = document.getElementById('xos-size-select');

    // ── Unified size select ──
    const activeSizeSelect = document.getElementById('active-size-select');
    if (activeSizeSelect) {
        const path = window.location.pathname;
        const initialTab = path === '/browse/xos' ? 'xos' : 'captions';
        activeSizeSelect.value = localStorage.getItem(`${initialTab}_tile_size`) || '128';

        activeSizeSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            const tab = window.currentBrowser || 'captions';
            localStorage.setItem(`${tab}_tile_size`, val);
            if (tab === 'captions' && captionsSizeSelect) captionsSizeSelect.value = val;
            if (tab === 'xos' && xosSizeSelect) xosSizeSelect.value = val;
            applyTileSize(val, `#${tab}-browser-grid`);
            applyTileSize(val, `#${tab}-album-content`);
        });
    }

    // ── Unified refresh button ──
    const activeRefreshBtn = document.getElementById('active-refresh-btn');
    if (activeRefreshBtn) {
        activeRefreshBtn.addEventListener('click', () => {
            const tab = window.currentBrowser || 'captions';
            if (tab === 'xos') loadXosFolder();
            else loadCaptionsFolder();
        });
    }

    // ── Selection Mode toggle ──
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

    // ── Search filter ──
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

    // ── Restore Tab and Path State on Refresh ──
    const pathName = window.location.pathname;
    let initialBrowse = pathName === '/browse/xos' ? 'xos' : 'captions';
    
    if (pathName === '/browse' || pathName === '/browse/') {
        initialBrowse = localStorage.getItem('last_active_tab') || 'captions';
        window.history.replaceState({}, '', `/browse/${initialBrowse}`);
    }

    // Force pull directly from storage first to avoid old query string overrides on direct refresh
    const initialPath = localStorage.getItem(`last_browse_path_${initialBrowse}`) || getQueryParam('path') || '';

    localStorage.setItem('last_active_tab', initialBrowse);
    syncActiveSizeSelect(initialBrowse);
    switchStudioTab(initialBrowse, initialPath);
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

    // Save current active tab to storage
    localStorage.setItem('last_active_tab', tab);

    // Fetch the last known path for the selected tab if no explicit path argument was provided
    const targetPath = path || localStorage.getItem(`last_browse_path_${tab}`) || '';

    if (tab === 'captions') {
        loadCaptionsFolder(targetPath);
    } else {
        loadXosFolder(targetPath);
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
        if (thumbWrap) {
            thumbWrap.style.height = `${px}px`;
        }
    });

    document.querySelectorAll(`${selector} .xos-album-thumb`).forEach((img) => {
        img.style.width = `${px}px`;
        img.style.height = `${px}px`;
        img.style.minWidth = `${px}px`;
        img.style.objectFit = 'cover';
        img.style.borderRadius = '8px';
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

function renderXosBreadcrumb(path) {
    return renderFolderBreadcrumb(path, 'xos');
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
        const folderActions = renderTileActions([]);
        return `
            <div class="xos-folder-tile" data-path="${escapeHtmlAttribute(entry.path || '')}" data-type="directory">
                <div class="xos-thumb-wrap">
                    <img class="xos-thumb" src="/static/folder-placeholder.png" alt="folder thumb" loading="lazy" />
                    <div class="tile-overlay">
                        ${folderActions}
                    </div>
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
    
    // Display Dimensions cleanly alongside Size if present in properties
    const dimensionsStr = (entry.width && entry.height) ? `${entry.width}x${entry.height}` : (entry.dimensions ? entry.dimensions : '');
    const sizeStr = entry.size_bytes ? formatFileSize(entry.size_bytes) : (entry.extension || '').replace(/^\./, '').toUpperCase();
    const meta = dimensionsStr ? `${dimensionsStr} • ${sizeStr}` : sizeStr;

    const sizeBadge = entry.size_bytes ? `<div class="xos-file-size-badge">${escapeHtml(sizeStr)}</div>` : '';
    const indexLabel = entry.index || entry.name?.split?.('.')?.shift?.() || '1';
    const thumbHtml = isImage
        ? `<img class="xos-thumb" src="${url}" alt="${escapeHtml(entry.name)}" loading="lazy">`
        : `<div class="xos-file-icon">${entry.extension === '.mp4' ? '🎬' : '📄'}</div>`;

    const fileActions = renderTileActions([]);

    return `
        <div class="xos-file-tile" data-path="${escapeHtmlAttribute(entry.path)}" data-type="file" data-extension="${escapeHtmlAttribute(entry.extension || '')}">
            <div class="xos-thumb-wrap">
                ${thumbHtml}
                <div class="tile-overlay">
                    ${fileActions}
                </div>
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

            // 1. Handle selection checkbox click explicitly
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

            // 2. Handle action button clicks
            const actionBtn = e.target.closest('.tile-action-btn');
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                const path = tile.getAttribute('data-path') || '';
                const type = tile.getAttribute('data-type');
                handleTileAction(action, path, type, tile);
                return;
            }

            // 3. Standard Tile Click Action - Core Target Correction
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

    // Capture breadcrumb navigation clicks safely
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
    const isImage = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff'].includes(ext);

    if (isImage) {
        const allTiles = Array.from(document.querySelectorAll('#captions-browser-grid .xos-file-tile'));
        const imagePaths = allTiles
            .map(t => t.dataset.path)
            .filter(p => {
                const e = p.split('.').pop().toLowerCase();
                return ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff'].includes(e);
            });
            
        const startIndex = imagePaths.indexOf(path);
        openSlideshow(imagePaths, startIndex < 0 ? 0 : startIndex, 'captions');
        return;
    }

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
    if (!path) return;
    const ext = path.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff'].includes(ext);

    if (isImage) {
        const allTiles = Array.from(document.querySelectorAll('#xos-browser-grid .xos-file-tile'));
        const imagePaths = allTiles
            .map(t => t.dataset.path)
            .filter(p => {
                const e = p.split('.').pop().toLowerCase();
                return ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff'].includes(e);
            });
            
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
    switch (action) {
        default:
            console.debug('[tile-action]', action, path);
    }
}

/* ══════════════════════════════════════════════════════════
   SLIDESHOW MODULE
══════════════════════════════════════════════════════════ */
(function () {
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
    };

    // Document-level fallback so arrow/Escape keys work even when overlay loses focus
    document.addEventListener('keydown', function (e) {
        if (!ss.overlay) return;
        handleKey(e);
    });

    window.openSlideshow = function (paths, startIndex, browserType) {
        if (!paths || !paths.length) return;
        ss.paths       = paths;
        ss.index       = Math.max(0, Math.min(startIndex, paths.length - 1));
        ss.browserType = browserType || 'xos';
        ss.playing     = false;
        ss.random      = false;
        ss.intervalSecs= 7;
        ss._nativeSize = false;

        buildOverlay();
        loadImage(ss.index, null);
        document.body.style.overflow = 'hidden';
    };

    function imgUrl(path) {
        const prefix = ss.browserType === 'xos' ? '/xos' : '/captions';
        return `${prefix}/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
    }

    function buildOverlay() {
        closeSlideshow(false);

        const o = document.createElement('div');
        o.className  = 'slideshow-overlay';
        o.tabIndex   = -1;
        o.setAttribute('role', 'dialog');
        o.setAttribute('aria-modal', 'true');
        o.setAttribute('aria-label', 'Image slideshow');
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
          <div class="ss-stage" id="ss-stage">
            <button class="ss-nav-btn ss-prev" id="ss-prev-btn" aria-label="Previous image">&#8249;</button>
            <div class="ss-img-wrap fit" id="ss-img-wrap">
              <div class="ss-spinner" id="ss-spinner"></div>
            </div>
            <button class="ss-nav-btn ss-next" id="ss-next-btn" aria-label="Next image">&#8250;</button>
            <div class="ss-progress-track" id="ss-progress-track">
              <div class="ss-progress-fill" id="ss-progress-fill"></div>
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
            wrap.classList.toggle('fit',    !ss._nativeSize);
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

        const slider    = o.querySelector('#ss-timer-slider');
        const timerLbl  = o.querySelector('#ss-timer-label');
        slider.addEventListener('input', () => {
            ss.intervalSecs = parseInt(slider.value);
            timerLbl.textContent = `${ss.intervalSecs}s`;
            if (ss.playing) { stopPlay(); startPlay(); }
        });

        o.querySelector('#ss-close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            closeSlideshow(true);
        });

        o.addEventListener('keydown', handleKey);
    }

    function handleKey(e) {
        if (!ss.overlay) return;
        switch (e.key) {
            case 'ArrowRight': case 'ArrowDown':  e.preventDefault(); step(+1);       break;
            case 'ArrowLeft':  case 'ArrowUp':    e.preventDefault(); step(-1);       break;
            case ' ':          e.preventDefault(); togglePlay();                       break;
            case 'Escape':     e.preventDefault(); closeSlideshow(true);              break;
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

    function loadImage(index, animDir) {
        const o       = ss.overlay;
        const wrap    = o.querySelector('#ss-img-wrap');
        const spinner = o.querySelector('#ss-spinner');
        const titleEl = o.querySelector('#ss-title');
        const cntEl   = o.querySelector('#ss-counter');

        const path = ss.paths[index];
        titleEl.textContent = path.split('/').pop();
        cntEl.textContent   = `${index + 1} / ${ss.paths.length}`;
        syncFilmstrip(index);

        ss._nativeSize = false;
        wrap.classList.add('fit');
        wrap.classList.remove('native');

        spinner.style.display = 'block';
        const oldImg = wrap.querySelector('img');
        if (oldImg) oldImg.remove();

        const img = new Image();
        img.alt   = path.split('/').pop();
        img.draggable = false;

        img.onload = () => {
            spinner.style.display = 'none';
            wrap.classList.remove('anim-left', 'anim-right');
            wrap.appendChild(img);
            void wrap.offsetWidth;
            if (animDir) wrap.classList.add(animDir === 'left' ? 'anim-left' : 'anim-right');

            if (index === 0 && !o.querySelector('.ss-hint')) {
                const hint = document.createElement('div');
                hint.className   = 'ss-hint';
                hint.textContent = 'Double-click image to view at 100%';
                o.querySelector('#ss-stage').appendChild(hint);
                setTimeout(() => hint.remove(), 4200);
            }
        };

        img.onerror = () => {
            spinner.style.display = 'none';
            wrap.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:2rem;">Failed to load image</div>`;
        };

        img.src = imgUrl(path);
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
        const fill     = ss.overlay.querySelector('#ss-progress-fill');
        const duration = ss.intervalSecs * 1000;
        ss._progressStart = performance.now();

        function tick(now) {
            if (!ss.playing || !ss.overlay) return;
            const elapsed = now - ss._progressStart;
            const pct     = Math.min((elapsed / duration) * 100, 100);
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
            ss.overlay.removeEventListener('keydown', handleKey);
            ss.overlay.remove();
        }
        ss.overlay = null;
        if (restoreScroll) document.body.style.overflow = '';
    }
})();

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
        const resp = await fetch('/api/captions/upload', {
            method: 'POST',
            body: formData
        });
        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data?.detail || 'Upload processing failed');
        }

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
        const ymlPath = button ? button.dataset.ymlPath : '';

        const openCardViewer = (event) => {
            if (event) event.stopPropagation();
            const targetIndex = Number(button ? button.dataset.index || index : image.dataset.index || index);
            openYamlViewer(ymlPath || image?.dataset?.ymlPath || '', targetIndex);
        };

        if (button) {
            button.addEventListener('click', openCardViewer);
        }

        if (image) {
            image.addEventListener('click', openCardViewer);
        }
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

async function openYamlViewer(ymlPath, index = 0) {
    if (!ymlPath) return;

    const items = Array.isArray(window.captionGalleryItems) ? window.captionGalleryItems : [];
    if (!items.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'caption-viewer-overlay slideshow-overlay';
    overlay.innerHTML = `
        <div class="caption-viewer-shell">
            <div class="caption-viewer-toolbar ss-topbar">
                <div class="caption-viewer-toolbar-title">
                    <button class="caption-viewer-nav-btn ss-ctrl-btn" id="caption-viewer-prev" type="button">←</button>
                    <div>
                        <div class="caption-viewer-title">Caption Viewer</div>
                        <div class="caption-viewer-subtitle" id="caption-viewer-title"></div>
                    </div>
                    <button class="caption-viewer-nav-btn ss-ctrl-btn" id="caption-viewer-next" type="button">→</button>
                </div>
                <button class="caption-viewer-close ss-close-btn" id="caption-viewer-close" type="button">✕</button>
            </div>
            <div class="caption-viewer-body">
                <div class="caption-viewer-image-pane">
                    <div class="caption-viewer-image-frame">
                        <img id="caption-viewer-image" alt="Caption preview" class="caption-viewer-image" />
                    </div>
                </div>
                <div class="caption-viewer-divider" id="caption-viewer-divider"></div>
                <div class="caption-viewer-yaml-pane">
                    <div class="caption-viewer-pane-header">YAML metadata</div>
                    <pre class="caption-viewer-code yaml-syntax" id="caption-viewer-code">Loading YAML…</pre>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const shell = overlay.querySelector('.caption-viewer-shell');
    const imageEl = overlay.querySelector('#caption-viewer-image');
    const titleEl = overlay.querySelector('#caption-viewer-title');
    const codeEl = overlay.querySelector('#caption-viewer-code');
    const divider = overlay.querySelector('#caption-viewer-divider');
    const closeBtn = overlay.querySelector('#caption-viewer-close');
    const prevBtn = overlay.querySelector('#caption-viewer-prev');
    const nextBtn = overlay.querySelector('#caption-viewer-next');
    let activeIndex = items.findIndex((item) => item.yml_path === ymlPath || item.yml_file === ymlPath);
    activeIndex = activeIndex >= 0 ? activeIndex : Math.max(0, Math.min(index, items.length - 1));
    let isResizing = false;

    const setYamlWidth = (width) => {
        const bodyWidth =
            shell.querySelector('.caption-viewer-body').clientWidth;

        const minWidth = 400;
        const maxWidth = bodyWidth - 350;   // leave room for image

        shell.style.setProperty(
            '--yaml-width',
            `${Math.max(minWidth, Math.min(maxWidth, width))}px`
        );
    };

    const updateViewer = async () => {
        const item = items[activeIndex];
        if (!item) return;
        const imgUrl = resolveCaptionImageUrl(item);
        const displayName = item.image_filename || item.image_path || item.yml_file || 'Caption';
        titleEl.textContent = displayName;
        imageEl.src = imgUrl;
        imageEl.alt = displayName;
        codeEl.textContent = 'Loading YAML…';

        try {
            const response = await fetch(`/api/captions/details?yml_path=${encodeURIComponent(item.yml_path || '')}`);
            const payload = await response.json();
            const yamlText = payload.yaml_text || JSON.stringify(payload.data || payload, null, 2);
            codeEl.innerHTML = highlightYaml(yamlText);
        } catch (err) {
            codeEl.textContent = `Unable to load YAML details.\n${err.message}`;
        }
    };

    prevBtn.addEventListener('click', () => {
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        updateViewer();
    });

    nextBtn.addEventListener('click', () => {
        activeIndex = (activeIndex + 1) % items.length;
        updateViewer();
    });

    closeBtn.addEventListener('click', () => {
        document.body.style.overflow = '';
        overlay.remove();
    });

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            document.body.style.overflow = '';
            overlay.remove();
        }
    });

    divider.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        isResizing = true;
        divider.setPointerCapture(event.pointerId);
    });

    overlay.addEventListener('pointermove', (event) => {
        if (!isResizing) return;
        const bodyRect = shell.querySelector('.caption-viewer-body').getBoundingClientRect();
        const dividerX = event.clientX - bodyRect.left;
        const width = bodyRect.width - dividerX;
        setYamlWidth(width);
    });

    const stopResizing = () => {
        isResizing = false;
    };

    overlay.addEventListener('pointerup', stopResizing);
    overlay.addEventListener('pointercancel', stopResizing);

    // Keyboard navigation: arrows to change image, Escape to close
    function handleViewerKey(e) {
        if (!overlay.isConnected) return;
        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                updateViewer();
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                updateViewer();
                break;
            case 'Escape':
                e.preventDefault();
                document.body.style.overflow = '';
                overlay.remove();
                document.removeEventListener('keydown', handleViewerKey);
                break;
        }
    }
    document.addEventListener('keydown', handleViewerKey);

    // Clean up key listener when overlay is closed via button or backdrop click
    closeBtn.addEventListener('click', () => {
        document.removeEventListener('keydown', handleViewerKey);
    });
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            document.removeEventListener('keydown', handleViewerKey);
        }
    }, { once: true });

    updateViewer();
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

function highlightYaml(text) {
    return escapeHtml(text)
        .split('\n')
        .map(line => {
            const m = line.match(/^(\s*)([^:#]+):(.*)$/);

            if (!m)
                return line;

            return `${m[1]}<span class="yaml-key">${m[2]}</span><span class="yaml-punctuation">:</span>${highlightYamlValue(m[3])}`;
        })
        .join('\n');
}

function highlightYamlValue(value) {
    return value
        .replace(
            /"(.*?)"|'(.*?)'/g,
            '<span class="yaml-string">$&</span>'
        )
        .replace(
            /\b(true|false|null)\b/g,
            '<span class="yaml-boolean">$1</span>'
        )
        .replace(
            /\b-?\d+(\.\d+)?\b/g,
            '<span class="yaml-number">$&</span>'
        );
}

/* Helper functions for escaping HTML content securely */
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