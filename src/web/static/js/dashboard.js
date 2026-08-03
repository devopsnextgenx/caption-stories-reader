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
    // we reuse renderCaptionCard from captions-browse.js, but we need to include it.
    // For simplicity, we'll define a minimal render here or call the global one.
    // Since dashboard.js loads after core.js but before captions-browse.js? Actually we load core.js and dashboard.js separately.
    // We'll include a simple renderer inside this file.
    function renderCaptionCard(item) {
      const name = item.image_name || item.image_filename || 'Image';
      const imgUrl = resolveCaptionImageUrl(item);
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const tagHtml = tags.length > 0
        ? tags.slice(0, 3).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')
        : '<span class="tag-pill tag-empty">No tags</span>';
      return `
        <div class="caption-card">
          <div class="caption-thumb-wrap">
            <img class="caption-thumb" src="${imgUrl}" alt="${escapeHtml(name)}">
          </div>
          <div class="caption-meta">
            <div class="xos-file-name" style="font-size:0.85rem;font-weight:600;">${escapeHtml(name)}</div>
            <div class="tag-cloud">${tagHtml}</div>
          </div>
        </div>
      `;
    }
    function resolveCaptionImageUrl(item) {
      if (!item) return '/static/placeholder.png';
      if (item.image_url) return item.image_url;
      const imagePath = item.image_path || item.image_filename || '';
      if (!imagePath) return '/static/placeholder.png';
      const normalized = String(imagePath).replace(/\\/g, '/').replace(/^\/+/, '');
      return `/captions/${encodeURIComponent(normalized).replace(/%2F/g, '/')}`;
    }
    gallery.innerHTML = data.captions.slice(0, 6).map(c => renderCaptionCard(c)).join('');
  } catch (err) {
    console.error('Failed to load captions:', err);
  }
}

document.addEventListener('DOMContentLoaded', initDashboard);