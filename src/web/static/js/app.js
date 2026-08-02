/**
 * Caption Stories Reader - Frontend Application Script
 */

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path === '/' || path === '/index.html') {
        initDashboard();
    } else if (path === '/admin') {
        initAdmin();
    } else if (path === '/captions-studio') {
        initCaptionsStudio();
    }
});

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
        uploadArea.addEventListener('click', () => fileInput.click());
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

    const xosRefreshBtn = document.getElementById('xos-refresh-btn');
    if (xosRefreshBtn) {
        xosRefreshBtn.addEventListener('click', () => loadXosFolder());
    }

    if (document.getElementById('xos-browser-pane')) {
        loadXosFolder();
    }
}

function switchStudioTab(tab) {
    const captionsTabBtn = document.getElementById('captions-tab-btn');
    const xosTabBtn = document.getElementById('xos-tab-btn');
    const captionsPane = document.getElementById('captions-pane');
    const xosPane = document.getElementById('xos-browser-pane');

    if (captionsTabBtn) captionsTabBtn.classList.toggle('active', tab === 'captions');
    if (xosTabBtn) xosTabBtn.classList.toggle('active', tab === 'xos');
    if (captionsPane) captionsPane.classList.toggle('hidden', tab !== 'captions');
    if (xosPane) xosPane.classList.toggle('hidden', tab !== 'xos');
}

async function loadXosFolder(path = '') {
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

        if (data.parent !== null) {
            content.push(renderXosTile({
                type: 'parent',
                name: '..',
                path: data.parent || '',
            }));
        }

        data.directories.forEach((entry) => content.push(renderXosTile(entry)));
        data.files.forEach((entry) => content.push(renderXosTile(entry)));

        browserGrid.innerHTML = content.join('') || '<div class="placeholder-message">This folder is empty.</div>';
        bindXosTiles();

        if (albumView && albumTitle) {
            albumView.classList.add('hidden');
            albumTitle.textContent = '';
        }
    } catch (err) {
        browserGrid.innerHTML = `<div class="placeholder-message">Failed to load XOS folder: ${err.message}</div>`;
    }
}

function renderXosBreadcrumb(path) {
    const segments = path ? path.split('/').filter(Boolean) : [];
    const crumbs = [
        `<button type="button" class="breadcrumb-button" data-path="">xos</button>`,
    ];
    let current = '';
    segments.forEach((segment) => {
        current = current ? `${current}/${segment}` : segment;
        crumbs.push(`<span class="breadcrumb-separator">/</span>`);
        crumbs.push(`<button type="button" class="breadcrumb-button" data-path="${escapeHtmlAttribute(current)}">${escapeHtml(segment)}</button>`);
    });
    return crumbs.join('');
}

function renderXosTile(entry) {
    if (entry.type === 'directory' || entry.type === 'parent') {
        return `
            <div class="xos-folder-tile" data-path="${escapeHtmlAttribute(entry.path)}" data-type="directory">
                <div class="xos-folder-icon">📁</div>
                <div class="xos-folder-name">${escapeHtml(entry.name)}</div>
                <div class="xos-folder-meta">Folder</div>
            </div>
        `;
    }

    return `
        <div class="xos-file-tile" data-path="${escapeHtmlAttribute(entry.path)}" data-type="file" data-extension="${escapeHtmlAttribute(entry.extension)}">
            <div class="xos-file-icon">${entry.extension === '.mp4' ? '🎬' : '🖼️'}</div>
            <div class="xos-file-name">${escapeHtml(entry.name)}</div>
            <div class="xos-file-meta">${formatFileSize(entry.size_bytes)}</div>
        </div>
    `;
}

function bindXosTiles() {
    document.querySelectorAll('#xos-browser-grid .xos-folder-tile, #xos-browser-grid .xos-file-tile').forEach((tile) => {
        tile.addEventListener('click', () => {
            const path = tile.dataset.path || '';
            const type = tile.dataset.type;
            if (type === 'directory') {
                loadXosFolder(path);
            } else {
                openXosAlbum(path);
            }
        });
    });
    document.querySelectorAll('#xos-breadcrumb .breadcrumb-button').forEach((crumb) => {
        crumb.addEventListener('click', () => loadXosFolder(crumb.dataset.path || ''));
    });
}

function openXosAlbum(path) {
    const albumView = document.getElementById('xos-album-view');
    const albumTitle = document.getElementById('xos-album-title');
    const albumContent = document.getElementById('xos-album-content');
    if (!albumView || !albumTitle || !albumContent) return;

    const url = `/xos/${encodeURIComponent(path).replace(/%2F/g, '/').replace(/%5C/g, '/')}`;
    const extension = path.split('.').pop().toLowerCase();

    let preview = '';
    if (extension === 'mp4') {
        preview = `<video controls class="xos-album-preview"><source src="${url}" type="video/mp4">Your browser does not support MP4 video.</video>`;
    } else {
        preview = `<img src="${url}" class="xos-album-preview" alt="${escapeHtml(path)}">`;
    }

    albumTitle.textContent = path.split('/').pop();
    albumContent.innerHTML = preview;
    albumView.classList.remove('hidden');
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
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

            // Refresh gallery whenever new images have finished, not just at the end
            if (job.completed > lastCompletedCount) {
                lastCompletedCount = job.completed;
                loadCaptionsGallery();
            }

            if (job.status === 'completed') {
                clearInterval(interval);
                if (progressStatus) progressStatus.textContent = 'Batch extraction completed successfully!';
                // Final refresh to ensure gallery is fully up to date
                loadCaptionsGallery();
            }
        } catch (err) {
            clearInterval(interval);
        }
    }, 1000);
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

        card.addEventListener('click', (event) => {
            if (event.target.closest('.view-yaml-btn')) return;
            if (ymlPath || image?.dataset?.ymlPath) {
                openYamlViewer(ymlPath || image.dataset.ymlPath || '', Number(card.dataset.index || index));
            }
        });
    });
}

function renderCaptionCard(c, index) {
    const relativeImgPath = c.image_path ? '/captions/' + c.image_filename : '/static/placeholder.png';
    const tagsHtml = (c.tags || []).length
        ? (c.tags || []).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')
        : '<span class="tag-pill tag-empty">No tags</span>';

    return `
        <div class="caption-card" data-index="${index}">
            <div class="caption-thumb-wrap">
                <img src="${relativeImgPath}" class="caption-thumb" alt="${escapeHtml(c.image_filename || 'Caption image')}" data-index="${index}" data-yml-path="${escapeHtmlAttribute(c.yml_path || '')}" style="cursor: pointer;"">
                <button class="view-yaml-btn" type="button" aria-label="View YAML" data-yml-path="${escapeHtmlAttribute(c.yml_path || '')}" data-index="${index}">👁</button>
            </div>
            <div class="caption-meta">
                <div class="caption-file-name">${escapeHtml(c.image_filename || 'Unknown image')}</div>
                <div class="tag-cloud">${tagsHtml}</div>
            </div>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

async function openYamlViewer(ymlPath, index = 0) {
    const captions = Array.isArray(window.captionGalleryItems) ? window.captionGalleryItems : [];
    const resolvedIndex = Number.isInteger(index) && index >= 0 ? index : captions.findIndex(item => item.yml_path === ymlPath);
    const selectedCaption = captions[resolvedIndex] || captions.find(item => item.yml_path === ymlPath) || { yml_path: ymlPath };

    try {
        const resp = await fetch(`/api/captions/details?yml_path=${encodeURIComponent(ymlPath || selectedCaption.yml_path)}`);
        if (!resp.ok) {
            throw new Error(`Failed to fetch YAML (${resp.status})`);
        }

        const data = await resp.json();
        const yamlText = yamlObjectToText(data);
        const imageSrc = selectedCaption.image_path ? '/captions/' + (selectedCaption.image_filename || selectedCaption.image_path.split('/').pop()) : '/static/placeholder.png';

        const modal = document.createElement('div');
        modal.className = 'yaml-viewer-overlay';
        modal.id = 'yaml-viewer-overlay';
        modal.innerHTML = `
            <div class="yaml-viewer-modal" role="dialog" aria-modal="true" aria-label="Caption YAML detail viewer">
                <div class="yaml-viewer-header">
                    <div class="yaml-viewer-title-wrap">
                        <div class="yaml-viewer-title">${escapeHtml(selectedCaption.image_filename || 'Caption detail')}</div>
                        <div class="yaml-viewer-path">${escapeHtml(ymlPath || selectedCaption.yml_path || '')}</div>
                    </div>
                    <div class="yaml-viewer-actions">
                        <button class="nav-btn" data-nav="prev" aria-label="Previous caption">&#8249;</button>
                        <button class="nav-btn" data-nav="next" aria-label="Next caption">&#8250;</button>
                        <button class="close-btn" aria-label="Close viewer">×</button>
                    </div>
                </div>
                <div class="yaml-viewer-split">
                    <div class="yaml-viewer-pane image-pane">
                        <img src="${imageSrc}" alt="Caption image">
                    </div>
                    <div class="yaml-viewer-resizer" aria-label="Resize viewer" role="separator" tabindex="0"></div>
                    <div class="yaml-viewer-pane yaml-pane">
                        <pre class="yaml-viewer-code yaml-syntax">${renderYamlHighlighted(yamlText)}</pre>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeYamlViewer(modal);
            }
        });

        const modalContent = modal.querySelector('.yaml-viewer-modal');
        const resizer = modal.querySelector('.yaml-viewer-resizer');
        const imagePane = modal.querySelector('.image-pane');
        const yamlPane = modal.querySelector('.yaml-pane');

        bindYamlViewerControls(modal, captions, resolvedIndex);
        setupSplitResize(resizer, imagePane, yamlPane);
        document.addEventListener('keydown', handleYamlViewerKeydown);
        window.yamlViewerCloseHandler = () => closeYamlViewer(modal);
    } catch (err) {
        console.error('Failed to load YAML details:', err);
        alert('Failed to load YAML details.');
    }
}

function bindYamlViewerControls(modal, captions, currentIndex) {
    const closeButton = modal.querySelector('.close-btn');
    if (closeButton) {
        closeButton.addEventListener('click', () => closeYamlViewer(modal));
    }

    modal.querySelectorAll('.nav-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const direction = button.dataset.nav === 'next' ? 1 : -1;
            if (!captions.length) return;
            const nextIndex = (currentIndex + direction + captions.length) % captions.length;
            const nextCaption = captions[nextIndex];
            if (nextCaption && nextCaption.yml_path) {
                closeYamlViewer(modal, false);
                openYamlViewer(nextCaption.yml_path, nextIndex);
            }
        });
    });
}

function setupSplitResize(resizer, imagePane, yamlPane) {
    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    const dragStart = (event) => {
        isDragging = true;
        startX = event.clientX;
        startWidth = imagePane.getBoundingClientRect().width;
        document.body.style.userSelect = 'none';
    };

    const dragMove = (event) => {
        if (!isDragging) return;
        const container = imagePane.parentElement;
        const delta = event.clientX - startX;
        const total = container.getBoundingClientRect().width;
        const minSize = 260;
        const maxSize = total - 260;
        const nextWidth = Math.min(Math.max(startWidth + delta, minSize), maxSize);
        imagePane.style.flex = `0 0 ${nextWidth}px`;
        yamlPane.style.flex = '1 1 auto';
    };

    const dragEnd = () => {
        isDragging = false;
        document.body.style.userSelect = '';
    };

    resizer.addEventListener('pointerdown', dragStart);
    window.addEventListener('pointermove', dragMove);
    window.addEventListener('pointerup', dragEnd);
}

function handleYamlViewerKeydown(event) {
    const overlay = document.getElementById('yaml-viewer-overlay');
    if (!overlay) return;

    if (event.key === 'Escape') {
        closeYamlViewer(overlay);
        return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const buttons = overlay.querySelectorAll('.nav-btn');
        const targetButton = Array.from(buttons).find((button) => button.dataset.nav === (event.key === 'ArrowRight' ? 'next' : 'prev'));
        if (targetButton) {
            targetButton.click();
        }
    }
}

function closeYamlViewer(modal, restoreScroll = true) {
    if (!modal || !modal.parentNode) return;
    modal.remove();
    if (restoreScroll) {
        document.body.style.overflow = '';
    }
    document.removeEventListener('keydown', handleYamlViewerKeydown);
}

function yamlObjectToText(value, indent = 0) {
    const spacing = '  '.repeat(indent);

    if (value === null) return `${spacing}null`;
    if (Array.isArray(value)) {
        if (!value.length) return `${spacing}[]`;
        return value.map((item) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                const entries = Object.entries(item).map(([key, nestedValue]) => `${'  '.repeat(indent + 1)}${key}: ${formatYamlScalar(nestedValue)}`);
                return `${spacing}- ${entries.join('\n')}`;
            }
            return `${spacing}- ${formatYamlScalar(item)}`;
        }).join('\n');
    }

    if (typeof value === 'object') {
        return Object.entries(value).map(([key, nestedValue]) => {
            if (nestedValue === null || typeof nestedValue !== 'object') {
                return `${spacing}${key}: ${formatYamlScalar(nestedValue)}`;
            }
            if (Array.isArray(nestedValue)) {
                return `${spacing}${key}:\n${yamlObjectToText(nestedValue, indent + 1)}`;
            }
            if (Object.keys(nestedValue).length === 0) {
                return `${spacing}${key}: {}`;
            }
            return `${spacing}${key}:\n${yamlObjectToText(nestedValue, indent + 1)}`;
        }).join('\n');
    }

    return `${spacing}${formatYamlScalar(value)}`;
}

function formatYamlScalar(value) {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') {
        const normalized = value.replace(/\n/g, '\\n');
        return `"${normalized.replace(/"/g, '\\"')}"`;
    }
    return `"${String(value).replace(/"/g, '\\"')}"`;
}

function renderYamlHighlighted(yamlText) {
    const escaped = String(yamlText)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return escaped.split('\n').map((line) => {
        const leadingWhitespace = line.match(/^\s*/)[0];
        const content = line.slice(leadingWhitespace.length);

        if (!content) {
            return leadingWhitespace || ' ';
        }

        if (content.startsWith('- ')) {
            const itemValue = content.slice(2);
            return `${leadingWhitespace}<span class="yaml-punctuation">-</span> ${renderYamlValueMarkup(itemValue)}`;
        }

        const keyMatch = content.match(/^([^:#]+)(\s*:\s*)(.*)$/);
        if (keyMatch) {
            const [, key, punctuation, rawValue] = keyMatch;
            return `${leadingWhitespace}<span class="yaml-key">${escapeHtml(key)}</span><span class="yaml-punctuation">${escapeHtml(punctuation)}</span>${renderYamlValueMarkup(rawValue)}`;
        }

        return `${leadingWhitespace}${renderYamlValueMarkup(content)}`;
    }).join('\n');
}

function renderYamlValueMarkup(value) {
    const raw = String(value).trim();
    if (!raw) return '<span class="yaml-empty">""</span>';
    if (/^(true|false|null)$/i.test(raw)) return `<span class="yaml-boolean">${raw}</span>`;
    if (/^-?\d+(\.\d+)?$/i.test(raw)) return `<span class="yaml-number">${raw}</span>`;
    if (/^\[.*\]$|^\{.*\}$/.test(raw)) return `<span class="yaml-string">${escapeHtml(raw)}</span>`;
    return `<span class="yaml-string">${escapeHtml(raw)}</span>`;
}