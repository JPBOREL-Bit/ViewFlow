// public/js/support-widget.js
let supportWidgetOpen = false;

async function refreshSupportBadgeOnly() {
  if (supportWidgetOpen) return; // el panel abierto ya se actualiza solo
  try {
    const { messages } = await Api.get('/messages');
    const unread = messages.filter(m => m.sender === 'admin' && !m.read).length;
    renderFabOnly(unread);
  } catch (e) {}
}

function renderSupportFab(unread) {
  const root = document.getElementById('supportWidgetRoot');
  if (!root) return;
  root.innerHTML = `<button class="support-fab" onclick="toggleSupportWidget()">S${unread > 0 ? `<span class="badge-count">${unread}</span>` : ''}</button>`;
}

async function toggleSupportWidget() {
  supportWidgetOpen = !supportWidgetOpen;
  await renderSupportWidget();
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

const SUGGESTED_QUESTIONS = [
  'Quiero preguntar por mis créditos',
  'Quiero preguntar por un retiro',
  'Quiero preguntar por la Tienda',
  'Quiero preguntar por una campaña',
  'Quiero preguntar por mi código de verificación'
];

async function renderSupportWidget() {
  const root = document.getElementById('supportWidgetRoot');
  if (!root) return;
  let msgs = [];
  try { const r = await Api.get('/messages'); msgs = r.messages; } catch (e) { return; }
  const unread = msgs.filter(m => m.sender === 'admin' && !m.read).length;

  if (!supportWidgetOpen) { renderFabOnly(unread); return; }

  root.innerHTML = `
    <button class="support-fab" onclick="toggleSupportWidget()">×</button>
    <div class="support-panel">
      <div class="support-panel-head"><strong>Soporte</strong></div>
      <div class="support-panel-body" id="supportPanelBody">
        ${msgs.length === 0 ? `
          <div class="empty-state" style="padding:14px 4px;">Escribinos si tenés alguna duda, o elegí una pregunta:</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${SUGGESTED_QUESTIONS.map(q => `<button type="button" class="btn btn-ghost btn-sm" style="text-align:left;" onclick="sendSuggested('${q.replace(/'/g, "\\'")}')">${q}</button>`).join('')}
          </div>` : msgs.map(m => `
          <div class="support-msg ${m.sender === 'admin' ? 'admin' : 'user'}">
            ${escapeHtml(m.text)}<span class="ts">${new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>`).join('')}
      </div>
      <div class="support-panel-foot">
        <input id="supportInput" placeholder="Escribí tu mensaje..." onkeydown="if(event.key==='Enter') sendSupportMessage()">
        <button class="btn btn-primary btn-sm" onclick="sendSupportMessage()">Enviar</button>
      </div>
    </div>`;
  const body = document.getElementById('supportPanelBody');
  if (body) body.scrollTop = body.scrollHeight;
}

async function sendSuggested(text) {
  try {
    await Api.post('/messages', { text });
    await renderSupportWidget();
  } catch (e) { toast(e.message, true); }
}

function renderFabOnly(unread) {
  const root = document.getElementById('supportWidgetRoot');
  root.innerHTML = `<button class="support-fab" onclick="toggleSupportWidget()">S${unread > 0 ? `<span class="badge-count">${unread}</span>` : ''}</button>`;
}

async function sendSupportMessage() {
  const input = document.getElementById('supportInput');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  input.value = '';
  try {
    await Api.post('/messages', { text });
    await renderSupportWidget();
  } catch (e) { toast(e.message, true); }
}
