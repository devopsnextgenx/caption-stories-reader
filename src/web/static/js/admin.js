async function initAdmin() {
  loadConfigYaml();
  loadSystemLogs();
  const saveBtn = document.getElementById('save-config-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveConfigYaml);
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
      if (msg) { msg.style.color = '#34d399'; msg.textContent = 'Configuration saved successfully!'; }
    } else {
      throw new Error('Save failed');
    }
  } catch (err) {
    if (msg) { msg.style.color = '#f87171'; msg.textContent = 'Error saving config: ' + err.message; }
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

document.addEventListener('DOMContentLoaded', initAdmin);