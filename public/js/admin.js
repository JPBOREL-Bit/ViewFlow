// public/js/admin.js
let ME = null;
let currentPage = sessionStorage.getItem('vf_admin_page') || 'overview';

const NAV = [
  { id: 'overview', label: 'Dashboard' },
  { id: 'users', label: 'Usuarios' },
  { id: 'creators', label: 'Creadores' },
  { id: 'viewers', label: 'Viewers' },
  { id: 'campaigns', label: 'Campañas' },
  { id: 'purchases', label: 'Pagos pendientes' },
  { id: 'withdrawals', label: 'Retiros' },
  { id: 'donations', label: 'Donaciones' },
  { id: 'verify', label: 'Verificación' },
  { id: 'messages', label: 'Mensajes' },
  { id: 'taxes', label: 'Impuestos' },
  { id: 'settings', label: 'Configuración' }
];
function buildNav(counts) {
  counts = counts || {};
  const dot = (n) => n > 0 ? `<span class="nav-dot" title="${n} nuevo(s)"></span>` : '';
  document.getElementById('sbNav').innerHTML = NAV.map(n =>
    `<button class="nav-item" data-page="${n.id}" onclick="goTo('${n.id}')"><span>${n.label}</span>${dot(counts[n.id])}</button>`).join('');
}
async function refreshNavIndicators() {
  try {
    const o = await Api.get('/admin/overview');
    buildNav({
      users: o.pending,
      purchases: o.pendingPurchases,
      withdrawals: o.pendingWithdrawals,
      donations: o.pendingDonations,
      verify: o.pendingVerify,
      messages: o.unreadMessages
    });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === currentPage));
  } catch (e) {}
}
function goTo(id) { currentPage = id; sessionStorage.setItem('vf_admin_page', id); renderPage(); }
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function renderModal(html) { document.getElementById('modalRoot').innerHTML = `<div class="modal-overlay"><div class="modal">${html}</div></div>`; }
async function logout() { await Api.post('/auth/logout'); window.location.href = '/'; }
function fmtCr(n) { return (Math.round(n * 10) / 10).toString(); }

async function boot() {
  ME = await requireSession('admin');
  if (!ME) return;
  document.getElementById('sbUserName').textContent = ME.visibleUser;
  document.getElementById('sbUserEmail').textContent = ME.email;
  await refreshNavIndicators();
  renderPage();
  setInterval(refreshNavIndicators, 8000);
}

async function renderPage() {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === currentPage));
  const main = document.getElementById('mainContent');
  main.innerHTML = '<div class="empty-state">Cargando...</div>';
  const renderers = { overview: renderOverview, users: renderUsers, creators: renderCreatorsSection, viewers: renderViewersSection, campaigns: renderCampaigns, purchases: renderPurchases, withdrawals: renderWithdrawals, verify: renderVerify, messages: renderMessages, taxes: renderTaxes, settings: renderSettings };
  try { await renderers[currentPage](main); } catch (e) { main.innerHTML = `<div class="empty-state">${e.message}</div>`; }
}

async function renderOverview(main) {
  const o = await Api.get('/admin/overview');
  const tax = await Api.get('/admin/taxes').catch(() => null);
  main.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><div class="ps">El estado de ViewFlow, de un vistazo</div></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="sl">Creadores</div><div class="sv">${o.creators}</div></div>
      <div class="stat-card"><div class="sl">Viewers</div><div class="sv">${o.viewers}</div></div>
      <div class="stat-card"><div class="sl">Bloqueados</div><div class="sv">${o.blocked}</div></div>
      <div class="stat-card"><div class="sl">Pendientes de aprobar</div><div class="sv gold">${o.pending}</div></div>
      <div class="stat-card"><div class="sl">Campañas activas</div><div class="sv teal">${o.activeCampaigns}</div></div>
      <div class="stat-card"><div class="sl">Campañas finalizadas/eliminadas</div><div class="sv">${o.finishedCampaigns}</div></div>
      <div class="stat-card"><div class="sl">Compras pendientes</div><div class="sv gold">${o.pendingPurchases}</div></div>
      <div class="stat-card"><div class="sl">Retiros pendientes</div><div class="sv gold">${o.pendingWithdrawals}</div></div>
      <div class="stat-card"><div class="sl">Donaciones pendientes</div><div class="sv gold">${o.pendingDonations || 0}</div></div>
      <div class="stat-card"><div class="sl">Verificaciones pendientes</div><div class="sv gold">${o.pendingVerify}</div></div>
      <div class="stat-card"><div class="sl">Mensajes sin leer</div><div class="sv gold">${o.unreadMessages}</div></div>
    </div>
    <div class="section-card" style="margin-top:10px;">
      <h3 style="margin-bottom:16px;">Créditos en circulación</h3>
      ${barChart([
        { label: 'Total en circulación', value: o.totalCreditsInCirculation, color: 'var(--gold)' },
        { label: 'De creadores', value: o.creatorsCreditsTotal, color: 'var(--teal)' },
        { label: 'De viewers', value: o.viewersCreditsTotal, color: '#1c6fc2' },
        { label: 'Ganancia neta plataforma', value: tax ? tax.netCredits : 0, color: '#c8483a' }
      ])}
    </div>`;
}

function barChart(items) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div style="display:flex; flex-direction:column; gap:12px;">
    ${items.map(i => `
      <div>
        <div style="display:flex; justify-content:space-between; font-size:12.5px; color:var(--text-dim); margin-bottom:4px;">
          <span>${i.label}</span><span class="mono">${(Math.round(i.value * 10) / 10)} cr</span>
        </div>
        <div style="height:10px; background:var(--panel-2); border-radius:6px; overflow:hidden;">
          <div style="height:100%; width:${Math.max(2, (i.value / max) * 100)}%; background:${i.color}; border-radius:6px;"></div>
        </div>
      </div>`).join('')}
  </div>`;
}

async function renderUsers(main) {
  const { accounts } = await Api.get('/admin/users');
  const pending = accounts.filter(a => a.status === 'pending');
  const others = accounts.filter(a => a.role !== 'admin' && a.status !== 'pending');
  main.innerHTML = `
    <div class="page-head"><div><h1>Usuarios</h1></div></div>
    ${pending.length ? `
    <div class="section-card table-wrap" style="margin-bottom:20px;">
      <h3>Pendientes de aprobar</h3>
      <table><thead><tr><th>Nombre</th><th>Rol</th><th>Gmail</th><th>Acciones</th></tr></thead>
      <tbody>${pending.map(a => `<tr><td>${a.visibleUser}</td><td>${a.role}</td><td>${a.email}</td>
        <td><button class="btn btn-sm btn-teal" onclick="setStatus('${a.id}','approved')">Aprobar</button>
        <button class="btn btn-sm btn-danger" onclick="setStatus('${a.id}','rejected')">Rechazar</button></td></tr>`).join('')}
      </tbody></table>
    </div>` : ''}
    <div class="section-card table-wrap">
      <h3>Todos los usuarios</h3>
      <table><thead><tr><th>Nombre</th><th>Rol</th><th>Gmail</th><th>Créditos</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${others.map(a => `<tr><td>${a.visibleUser}</td><td>${a.role}</td><td>${a.email}</td>
        <td class="mono">${fmtCr(a.credits || 0)}</td>
        <td><span class="badge badge-${a.status === 'approved' ? 'approved' : a.status}">${a.status}</span></td>
        <td>
          ${a.status === 'blocked' ? `<button class="btn btn-sm btn-teal" onclick="setStatus('${a.id}','approved')">Desbloquear</button>` : `<button class="btn btn-sm btn-ghost" onclick="setStatus('${a.id}','blocked')">Bloquear</button>`}
          <button class="btn btn-sm btn-ghost" onclick="adjustCredits('${a.id}')">Créditos</button>
          <button class="btn btn-sm btn-danger" onclick="deleteUser('${a.id}')">Eliminar</button>
        </td></tr>`).join('')}
      </tbody></table>
      ${others.length === 0 ? '<div class="empty-state">Todavía no hay usuarios aprobados.</div>' : ''}
    </div>`;
}
async function setStatus(id, status) { await Api.put(`/admin/users/${id}/status`, { status }); toast('Actualizado.'); renderPage(); }

async function renderCreatorsSection(main) {
  const { accounts } = await Api.get('/admin/users');
  const creators = accounts.filter(a => a.role === 'creator' && a.status !== 'pending');
  main.innerHTML = `
    <div class="page-head"><div><h1>Creadores</h1><div class="ps">Solo lectura — no se puede editar la información del usuario desde acá</div></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Nombre</th><th>Gmail</th><th>Créditos</th><th>Estado</th><th></th></tr></thead>
      <tbody>${creators.map(a => `<tr><td>${a.visibleUser}</td><td>${a.email}</td><td class="mono">${fmtCr(a.credits || 0)}</td>
        <td><span class="badge badge-${a.status === 'approved' ? 'approved' : a.status}">${a.status}</span></td>
        <td><button class="btn btn-sm btn-ghost" onclick="openUserDetail('${a.id}')">Ver detalle</button></td></tr>`).join('')}
      </tbody></table>
      ${creators.length === 0 ? '<div class="empty-state">Todavía no hay creadores aprobados.</div>' : ''}
    </div>`;
}

async function renderViewersSection(main) {
  const { accounts } = await Api.get('/admin/users');
  const viewers = accounts.filter(a => a.role === 'viewer' && a.status !== 'pending');
  main.innerHTML = `
    <div class="page-head"><div><h1>Viewers</h1><div class="ps">Solo lectura — no se puede editar la información del usuario desde acá</div></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Usuario</th><th>Gmail</th><th>Créditos</th><th>Estado</th><th></th></tr></thead>
      <tbody>${viewers.map(a => `<tr><td>${a.visibleUser}</td><td>${a.email}</td><td class="mono">${fmtCr(a.credits || 0)}</td>
        <td><span class="badge badge-${a.status === 'approved' ? 'approved' : a.status}">${a.status}</span></td>
        <td><button class="btn btn-sm btn-ghost" onclick="openUserDetail('${a.id}')">Ver detalle</button></td></tr>`).join('')}
      </tbody></table>
      ${viewers.length === 0 ? '<div class="empty-state">Todavía no hay viewers aprobados.</div>' : ''}
    </div>`;
}

async function openUserDetail(id) {
  const { account } = await Api.get(`/admin/users/${id}/detail`);
  let body = '';
  if (account.role === 'creator') {
    body = `
      <h3 style="margin:16px 0 8px;">Campañas (${(account.campaigns || []).length})</h3>
      <div class="table-wrap"><table><thead><tr><th>Título</th><th>Estado</th><th>Costo</th><th>Vistas</th></tr></thead>
      <tbody>${(account.campaigns || []).map(c => `<tr><td>${c.title}</td><td>${c.status}</td><td class="mono">${fmtCr(c.credits)}</td><td>${c.viewsDone}/${c.views}</td></tr>`).join('') || '<tr><td colspan="4">Sin campañas</td></tr>'}</tbody></table></div>
      <h3 style="margin:20px 0 8px;">Compras (${(account.purchases || []).length})</h3>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Créditos</th><th>Estado</th><th>Método</th></tr></thead>
      <tbody>${(account.purchases || []).map(p => `<tr><td>${new Date(p.createdAt).toLocaleDateString()}</td><td class="mono">${p.credits}</td><td>${p.status}</td><td>${p.method}</td></tr>`).join('') || '<tr><td colspan="4">Sin compras</td></tr>'}</tbody></table></div>`;
  } else if (account.role === 'viewer') {
    body = `
      <h3 style="margin:16px 0 8px;">Participaciones (${(account.participations || []).length})</h3>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Estado</th></tr></thead>
      <tbody>${(account.participations || []).map(p => `<tr><td>${new Date(p.startedAt).toLocaleDateString()}</td><td>${p.status}</td></tr>`).join('') || '<tr><td colspan="2">Sin participaciones</td></tr>'}</tbody></table></div>
      <h3 style="margin:20px 0 8px;">Retiros (${(account.withdrawals || []).length})</h3>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Créditos</th><th>Estado</th></tr></thead>
      <tbody>${(account.withdrawals || []).map(w => `<tr><td>${new Date(w.createdAt).toLocaleDateString()}</td><td class="mono">${w.credits}</td><td>${w.status}</td></tr>`).join('') || '<tr><td colspan="3">Sin retiros</td></tr>'}</tbody></table></div>`;
  }
  renderModal(`
    <div class="modal-head"><h2>${account.visibleUser}</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="mini-help">${account.email} · ${account.phone || 'sin teléfono'} · Código de verificación actual: <span class="mono">${account.verifyCode || '—'}</span></div>
    ${body}
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cerrar</button></div>`);
}
async function deleteUser(id) { if (!confirm('¿Eliminar esta cuenta?')) return; await Api.del(`/admin/users/${id}`); toast('Cuenta eliminada.'); renderPage(); }
async function adjustCredits(id) {
  const val = prompt('Ajustar créditos (usá negativo para restar):');
  if (!val) return;
  await Api.put(`/admin/users/${id}/credits`, { amount: Number(val) });
  toast('Créditos ajustados.'); renderPage();
}

async function renderCampaigns(main) {
  const { campaigns } = await Api.get('/admin/campaigns');
  main.innerHTML = `
    <div class="page-head"><div><h1>Campañas</h1></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Título</th><th>Creador</th><th>Vistas</th><th>Estado</th><th></th></tr></thead>
      <tbody>${campaigns.map(c => `<tr><td>${c.title}</td><td>${c.creatorName || '—'}</td><td>${c.viewsDone}/${c.views}</td>
        <td><span class="badge badge-${c.status === 'active' ? 'active' : 'finished'}">${c.status}</span></td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteCampaignAdmin('${c.id}')">Eliminar</button></td></tr>`).join('')}
      </tbody></table>
      ${campaigns.length === 0 ? '<div class="empty-state">No hay campañas todavía.</div>' : ''}
    </div>`;
}
async function deleteCampaignAdmin(id) { if (!confirm('¿Eliminar campaña?')) return; await Api.del(`/admin/campaigns/${id}`); toast('Eliminada.'); renderPage(); }

async function renderPurchases(main) {
  const { purchases } = await Api.get('/admin/purchases');
  main.innerHTML = `
    <div class="page-head"><div><h1>Pagos pendientes</h1><div class="ps">Vencen solas en 1 hora si no se confirman</div></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Fecha</th><th>Creador</th><th>Créditos</th><th>Total</th><th>Titular</th><th>Alias</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${purchases.map(p => `<tr><td>${new Date(p.createdAt).toLocaleString()}</td><td>${p.creatorName || '—'}</td>
        <td class="mono">${p.credits}</td><td>$${p.usd} USD</td><td>${p.holderName}</td><td>${p.alias}</td>
        <td><span class="badge badge-${p.status === 'approved' ? 'approved' : p.status === 'rejected' ? 'rejected' : 'pending'}">${p.status}</span></td>
        <td>${p.status === 'pending' ? `<button class="btn btn-sm btn-teal" onclick="approvePurchase('${p.id}')">Confirmar</button><button class="btn btn-sm btn-danger" onclick="rejectPurchase('${p.id}')">Rechazar</button>` : ''}</td></tr>`).join('')}
      </tbody></table>
      ${purchases.length === 0 ? '<div class="empty-state">No hay pagos pendientes.</div>' : ''}
    </div>`;
}
async function approvePurchase(id) { await Api.put(`/admin/purchases/${id}/approve`); toast('Aprobado.'); renderPage(); }
async function rejectPurchase(id) { await Api.put(`/admin/purchases/${id}/reject`); toast('Rechazado.'); renderPage(); }

async function renderWithdrawals(main) {
  const { withdrawals } = await Api.get('/admin/withdrawals');
  main.innerHTML = `
    <div class="page-head"><div><h1>Retiros</h1></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Viewer</th><th>Créditos</th><th>Neto</th><th>Alias</th><th>Titular</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${withdrawals.map(w => `<tr><td>${w.viewerName || '—'}</td><td class="mono">${w.credits}</td>
        <td>$${w.usd} USD / $${fmtArs(w.ars)} ARS</td><td>${w.alias}</td><td>${w.holderName}</td>
        <td><span class="badge badge-${w.status === 'paid' ? 'approved' : w.status === 'rejected' ? 'rejected' : 'pending'}">${w.status}</span></td>
        <td>${w.status === 'pending' ? `<button class="btn btn-sm btn-teal" onclick="approveWithdrawal('${w.id}')">Marcar pagado</button><button class="btn btn-sm btn-danger" onclick="rejectWithdrawal('${w.id}')">Rechazar</button>` : ''}</td></tr>`).join('')}
      </tbody></table>
      ${withdrawals.length === 0 ? '<div class="empty-state">No hay retiros todavía.</div>' : ''}
    </div>`;
}
async function approveWithdrawal(id) { await Api.put(`/admin/withdrawals/${id}/approve`); toast('Marcado como pagado.'); renderPage(); }
async function rejectWithdrawal(id) { await Api.put(`/admin/withdrawals/${id}/reject`); toast('Rechazado y reembolsado.'); renderPage(); }

async function renderVerify(main) {
  const { requests } = await Api.get('/admin/verify-requests');
  main.innerHTML = `
    <div class="page-head"><div><h1>Verificación</h1><div class="ps">El código queda fijo hasta que lo mandes</div></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Usuario</th><th>Gmail</th><th>Código</th><th>Espera estimada</th><th>Acciones</th></tr></thead>
      <tbody>${requests.map(r => `<tr><td>${r.userName}</td><td>${r.userEmail}</td>
        <td class="mono" style="color:var(--gold); font-weight:700;">${r.code}</td>
        <td>${r.estimatedWaitMinutes} min</td>
        <td><button class="btn btn-sm btn-teal" onclick="sendVerifyCode('${r.id}')">Mandar código</button></td></tr>`).join('')}
      </tbody></table>
      ${requests.length === 0 ? '<div class="empty-state">Nadie pidió verificación todavía.</div>' : ''}
    </div>`;
}
async function sendVerifyCode(id) { await Api.post(`/admin/verify-requests/${id}/send`); toast('Solicitud resuelta.'); renderPage(); }

let openConvo = null;
async function renderMessages(main) {
  const { conversations } = await Api.get('/admin/messages');
  if (!openConvo && conversations[0]) openConvo = conversations[0].accountId;
  const thread = openConvo ? (await Api.get(`/admin/messages/${openConvo}`)).messages : [];
  const activeConvo = conversations.find(c => c.accountId === openConvo);
  main.innerHTML = `
    <div class="page-head"><div><h1>Mensajes</h1></div></div>
    <div style="display:grid; grid-template-columns:280px 1fr; gap:18px;">
      <div class="section-card" style="padding:10px;">
        ${conversations.map(c => `<button onclick="openConversation('${c.accountId}')" style="width:100%; text-align:left; background:${c.accountId === openConvo ? 'var(--gold-dim)' : 'none'}; border:none; border-radius:9px; padding:12px; margin-bottom:4px;">
          <div style="font-weight:600; font-size:13.5px;">${c.name} ${c.unread ? `<span class="badge badge-pending">${c.unread}</span>` : ''}</div>
          <div class="mini-help">${c.role} · ${c.email}</div></button>`).join('') || '<div class="empty-state">Sin mensajes.</div>'}
      </div>
      <div class="section-card" style="min-height:400px; display:flex; flex-direction:column;">
        ${!activeConvo ? '<div class="empty-state">Elegí una conversación.</div>' : `
        <div style="font-weight:700; margin-bottom:14px;">${activeConvo.name} <span class="mini-help">${activeConvo.email}</span></div>
        <div style="flex:1; display:flex; flex-direction:column; gap:8px; margin-bottom:14px; max-height:340px; overflow-y:auto;">
          ${thread.map(m => `<div class="support-msg ${m.sender === 'admin' ? 'user' : 'admin'}" style="align-self:${m.sender === 'admin' ? 'flex-end' : 'flex-start'};">${m.text}</div>`).join('')}
        </div>
        <div style="display:flex; gap:8px;"><input id="adminReply" placeholder="Responder..."><button class="btn btn-primary btn-sm" onclick="sendReply()">Enviar</button></div>`}
      </div>
    </div>`;
}
function openConversation(id) { openConvo = id; renderPage(); }
async function sendReply() {
  const text = document.getElementById('adminReply').value.trim();
  if (!text) return;
  await Api.post(`/admin/messages/${openConvo}/reply`, { text });
  renderPage();
}

async function renderTaxes(main) {
  const t = await Api.get('/admin/taxes');
  main.innerHTML = `
    <div class="page-head"><div><h1>Impuestos</h1></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="sl">Ganás por impuesto de compra</div><div class="sv teal">${fmtCr(t.purchaseTaxCredits)} cr</div></div>
      <div class="stat-card"><div class="sl">Ganás por impuesto de retiro</div><div class="sv teal">${fmtCr(t.withdrawTaxCredits)} cr</div></div>
      <div class="stat-card"><div class="sl">Ganancia neta total</div><div class="sv gold">${fmtCr(t.netCredits)} cr</div></div>
    </div>`;
}

async function renderSettings(main) {
  const { settings: s } = await Api.get('/admin/settings');
  main.innerHTML = `
    <div class="page-head"><div><h1>Configuración</h1></div></div>
    <div class="section-card" style="max-width:560px; margin-bottom:20px;">
      <h3>Economía</h3>
      <form onsubmit="saveSettings(event)">
        <div class="grid-2">
          <div class="field"><label>Dólar (ARS)</label><input id="st_usd" type="number" value="${s.usdRate}"></div>
          <div class="field"><label>1 crédito en USD</label><input id="st_credit" type="number" step="0.01" value="${s.creditToUsd}"></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Impuesto de compra (%)</label><input id="st_ptax" type="number" value="${s.purchaseTaxPct}"></div>
          <div class="field"><label>Impuesto de retiro (%)</label><input id="st_wtax" type="number" value="${s.withdrawTaxPct}"></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Mínimo de retiro (créditos)</label><input id="st_minwd" type="number" value="${s.minWithdrawCredits}"></div>
          <div class="field"><label>Mínimo de viewers por campaña</label><input id="st_minviews" type="number" value="${s.minCampaignViews}"></div>
        </div>
        <div class="field"><label>Alias de pago</label><input id="st_alias" value="${s.paymentAlias}"></div>
        <button class="btn btn-primary" type="submit">Guardar</button>
      </form>
    </div>
    <div class="section-card" style="max-width:560px; border-color:#e8b3a8;">
      <h3 style="color:#a13323;">Zona de peligro</h3>
      <div class="mini-help" style="margin-bottom:14px;">Borra todas las cuentas de creadores y viewers, campañas, compras, retiros y mensajes. No se puede deshacer.</div>
      <button class="btn btn-danger" onclick="confirmReset()">Reiniciar sistema</button>
    </div>`;
}
async function saveSettings(e) {
  e.preventDefault();
  await Api.put('/admin/settings', {
    usdRate: Number(st_usd.value), creditToUsd: Number(st_credit.value),
    purchaseTaxPct: Number(st_ptax.value), withdrawTaxPct: Number(st_wtax.value),
    minWithdrawCredits: Number(st_minwd.value), minCampaignViews: Number(st_minviews.value),
    paymentAlias: st_alias.value
  });
  toast('Configuración guardada.');
}
function confirmReset() {
  renderModal(`
    <div class="modal-head"><h2>Reiniciar sistema</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="notice" style="background:var(--red-dim); color:#a13323; border-color:#e8b3a8;">Esta acción no se puede deshacer.</div>
    <form onsubmit="submitReset(event)">
      <div class="field" style="margin-top:16px;"><label class="req">Tu contraseña</label><input id="reset_pass" type="password" required></div>
      <div class="modal-foot"><button class="btn btn-danger" type="submit">Reiniciar definitivamente</button><button class="btn btn-ghost" type="button" onclick="closeModal()">Cancelar</button></div>
    </form>`);
}
async function submitReset(e) {
  e.preventDefault();
  try {
    await Api.post('/admin/reset', { password: document.getElementById('reset_pass').value });
    closeModal(); toast('Sistema reiniciado.'); goTo('overview');
  } catch (err) { toast(err.message, true); }
}

boot();
