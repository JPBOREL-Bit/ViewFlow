// public/js/creator.js
let ME = null;
let currentPage = sessionStorage.getItem('vf_creator_page') || 'dashboard';

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'create', label: 'Crear campaña' },
  { id: 'mine', label: 'Mis campañas' },
  { id: 'finished', label: 'Finalizadas' },
  { id: 'store', label: 'Tienda' },
  { id: 'purchases', label: 'Mis compras' },
  { id: 'donate', label: 'Donar a viewers' },
  { id: 'profile', label: 'Perfil' },
  { id: 'devices', label: 'Dispositivos' }
];

function buildNav() {
  document.getElementById('sbNav').innerHTML = NAV.map(n =>
    `<button class="nav-item" data-page="${n.id}" onclick="goTo('${n.id}')"><span>${n.label}</span></button>`).join('');
}
function goTo(id) { currentPage = id; sessionStorage.setItem('vf_creator_page', id); renderPage(); }

function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function renderModal(html) {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this) closeModal()"><div class="modal">${html}</div></div>`;
}

async function logout() { await Api.post('/auth/logout'); window.location.href = '/'; }

function fmtCr(n) { return (Math.round(n * 10) / 10).toString(); }

async function boot() {
  ME = await requireSession('creator');
  if (!ME) return;
  document.getElementById('sbUserName').textContent = ME.visibleUser;
  document.getElementById('sbUserEmail').textContent = ME.email;
  buildNav();
  renderPage();
  renderSupportWidget();
}

async function renderPage(silent) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === currentPage));
  const main = document.getElementById('mainContent');
  if (!silent) main.innerHTML = '<div class="empty-state">Cargando...</div>';
  try {
    if (currentPage === 'dashboard') await renderDashboard(main);
    else if (currentPage === 'create') renderCreate(main);
    else if (currentPage === 'mine') await renderMine(main);
    else if (currentPage === 'finished') await renderFinished(main);
    else if (currentPage === 'store') await renderStore(main);
    else if (currentPage === 'purchases') await renderPurchases(main);
    else if (currentPage === 'donate') await renderDonate(main);
    else if (currentPage === 'profile') renderProfile(main);
    else if (currentPage === 'devices') await renderDevices(main);
  } catch (e) { if (!silent) main.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  if (!silent) { main.style.animation = 'none'; void main.offsetWidth; main.style.animation = ''; }
}

async function renderDashboard(main) {
  const { campaigns } = await Api.get('/campaigns/mine');
  const active = campaigns.filter(c => c.status === 'active');
  const finished = campaigns.filter(c => c.status === 'finished');
  const spent = campaigns.reduce((s, c) => s + c.credits, 0);
  const viewersReached = campaigns.reduce((s, c) => s + c.viewsDone, 0);
  const hoursEarned = campaigns.reduce((s, c) => s + (c.viewsDone * c.seconds) / 3600, 0);
  const goal = getPersonalGoal();
  main.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><div class="ps">Así viene tu cuenta hoy</div></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="sl">Saldo disponible</div><div class="sv gold">${fmtCr(ME.credits || 0)} cr</div></div>
      <div class="stat-card"><div class="sl">Campañas activas</div><div class="sv teal">${active.length}</div></div>
      <div class="stat-card"><div class="sl">Campañas completas</div><div class="sv">${finished.length}</div></div>
      <div class="stat-card"><div class="sl">Créditos gastados</div><div class="sv">${fmtCr(spent)}</div></div>
      <div class="stat-card"><div class="sl">Horas de reproducción ganadas</div><div class="sv teal">${hoursEarned.toFixed(1)} h</div></div>
      <div class="stat-card"><div class="sl">Viewers conseguidos</div><div class="sv">${viewersReached}</div></div>
    </div>
    <div class="section-card" style="margin-bottom:20px;">
      <h3 style="margin-bottom:16px;">Resumen</h3>
      ${barChart([
        { label: 'Créditos gastados', value: spent, color: 'var(--gold)' },
        { label: 'Viewers conseguidos', value: viewersReached, color: 'var(--teal)' },
        { label: 'Horas ganadas', value: Math.round(hoursEarned * 10) / 10, color: '#1c6fc2' }
      ])}
    </div>
    <div class="section-card" style="max-width:480px;">
      <h3 style="margin-bottom:10px;">Meta personal</h3>
      <div class="mini-help" style="margin-bottom:12px;">Definí un objetivo propio, por ejemplo cuántos viewers querés conseguir este mes.</div>
      <div class="field"><input id="goalText" placeholder="Ej: llegar a 500 viewers" value="${goal.text || ''}"></div>
      <div class="field"><label>Progreso (%)</label><input id="goalProgress" type="number" min="0" max="100" value="${goal.progress || 0}"></div>
      <button class="btn btn-primary btn-sm" onclick="savePersonalGoal()">Guardar meta</button>
      ${goal.text ? `<div class="progress-bar" style="margin-top:14px;"><div class="progress-fill" style="width:${goal.progress || 0}%"></div></div>` : ''}
    </div>
    <div class="ad-slot-banner"><ins class="adsbygoogle"
     style="display:block; width:100%;"
     data-ad-client="ca-pub-8545340767144593"
     data-ad-slot="6688850781"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;
}

function barChart(items) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div style="display:flex; flex-direction:column; gap:12px;">
    ${items.map(i => `
      <div>
        <div style="display:flex; justify-content:space-between; font-size:12.5px; color:var(--text-dim); margin-bottom:4px;">
          <span>${i.label}</span><span class="mono">${i.value}</span>
        </div>
        <div style="height:10px; background:var(--panel-2); border-radius:6px; overflow:hidden;">
          <div style="height:100%; width:${Math.max(2, (i.value / max) * 100)}%; background:${i.color}; border-radius:6px;"></div>
        </div>
      </div>`).join('')}
  </div>`;
}
function getPersonalGoal() {
  try { return JSON.parse(localStorage.getItem('vf_goal_' + ME.id) || '{}'); } catch (e) { return {}; }
}
function savePersonalGoal() {
  const text = document.getElementById('goalText').value.trim();
  const progress = Math.min(100, Math.max(0, parseInt(document.getElementById('goalProgress').value || 0)));
  localStorage.setItem('vf_goal_' + ME.id, JSON.stringify({ text, progress }));
  toast('Meta guardada.');
  renderPage();
}

function buildTimePresetOptions() {
  const opts = [];
  for (let s = 30; s <= 2700; s += 30) {
    const m = Math.floor(s / 60), rem = s % 60;
    opts.push(`<option value="${s}">${m === 0 ? s + ' segundos' : m + ':' + String(rem).padStart(2, '0') + ' min'}</option>`);
  }
  return opts.join('');
}

function renderCreate(main) {
  main.innerHTML = `
    <div class="page-head"><div><h1>Crear campaña</h1><div class="ps">Elegí el video, el tiempo y la cantidad de viewers</div></div>
      <button class="btn btn-teal" type="button" onclick="applyQuickCreate()">Creación rápida</button></div>
    <div class="section-card" style="max-width:640px;">
      <form onsubmit="submitCampaign(event)">
        <div class="field"><label class="req">Título del video</label><input id="cp_title" required></div>
        <div class="field"><label class="req">URL de YouTube (video o Shorts)</label><input id="cp_url" required placeholder="https://youtube.com/watch?v=..."></div>
        <div class="grid-2">
          <div class="field"><label class="req">Cantidad de viewers</label><input id="cp_views" type="number" min="10" value="50" oninput="updateCost()"></div>
          <div class="field"><label class="req">Tiempo solicitado</label><select id="cp_seconds" onchange="updateCost()">${buildTimePresetOptions()}</select></div>
        </div>
        <div class="mini-help" style="margin-bottom:16px;">Mínimo 10 viewers por campaña.</div>
        <div class="stat-card" style="margin-bottom:20px;"><div class="sl">Tu saldo disponible</div><div class="sv gold">${fmtCr(ME.credits || 0)} cr</div></div>
        <div class="section-card" style="background:var(--panel-2);">
          <div class="grid-2">
            <div><div class="sl">COSTO</div><div class="mono" id="cost_credits" style="font-size:22px; color:var(--gold); font-weight:700;">0 cr</div></div>
            <div><div class="sl">TIEMPO DE REPRODUCCIÓN QUE GANÁS</div><div class="mono" id="cost_playtime" style="font-size:22px; color:var(--teal); font-weight:700;">0 min</div></div>
          </div>
        </div>
        <div style="margin-top:20px;"><button class="btn btn-primary" type="submit">Publicar campaña</button></div>
      </form>
    </div>`;
  updateCost();
}

function updateCost() {
  const seconds = parseInt(document.getElementById('cp_seconds').value || 0);
  const views = parseInt(document.getElementById('cp_views').value || 0);
  const perView = Math.floor((seconds / 30) * 1.667 * 10) / 10;
  const total = Math.max(1, Math.round(perView * views));
  document.getElementById('cost_credits').textContent = total + ' cr';
  const totalSeconds = seconds * views;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  document.getElementById('cost_playtime').textContent = h > 0 ? `${h}h ${m}min` : `${m} min`;
}
function applyQuickCreate() {
  document.getElementById('cp_seconds').value = '30';
  const perView30 = Math.floor((30 / 30) * 1.667 * 10) / 10;
  const maxViews = Math.max(10, Math.floor((ME.credits || 0) / perView30));
  document.getElementById('cp_views').value = maxViews;
  updateCost();
  toast(`Creación rápida: 30 segundos y ${maxViews} viewers.`);
}

async function submitCampaign(e) {
  e.preventDefault();
  try {
    await Api.post('/campaigns', {
      title: document.getElementById('cp_title').value.trim(),
      url: document.getElementById('cp_url').value.trim(),
      seconds: document.getElementById('cp_seconds').value,
      views: document.getElementById('cp_views').value
    });
    ME = await requireSession('creator');
    toast('Campaña publicada correctamente.');
    goTo('mine');
  } catch (err) { toast(err.message, true); }
}

async function renderMine(main) {
  const { campaigns } = await Api.get('/campaigns/mine');
  const active = campaigns.filter(c => c.status === 'active');
  main.innerHTML = `
    <div class="page-head"><div><h1>Mis campañas</h1><div class="ps">Seguimiento en tiempo real</div></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Título</th><th>Vistas</th><th>Tiempo</th><th>Costo</th><th>Estado</th><th></th></tr></thead>
      <tbody>${active.map(c => `
        <tr><td>${c.title}</td><td>${c.viewsDone} / ${c.views}</td><td>${c.seconds}s</td>
        <td class="mono">${fmtCr(c.credits)} cr</td><td><span class="badge badge-active">Activa</span></td>
        <td><button class="btn btn-sm btn-danger" onclick="confirmDeleteCampaign('${c.id}')">Eliminar</button></td></tr>`).join('')}
      </tbody></table>
      ${active.length === 0 ? '<div class="empty-state">Todavía no tenés campañas activas.</div>' : ''}
    </div>`;
}
async function renderFinished(main) {
  const { campaigns } = await Api.get('/campaigns/mine');
  const finished = campaigns.filter(c => c.status === 'finished');
  main.innerHTML = `
    <div class="page-head"><div><h1>Campañas finalizadas</h1></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Título</th><th>Vistas conseguidas</th><th>Costo</th></tr></thead>
      <tbody>${finished.map(c => `<tr><td>${c.title}</td><td>${c.viewsDone}</td><td class="mono">${fmtCr(c.credits)} cr</td></tr>`).join('')}</tbody></table>
      ${finished.length === 0 ? '<div class="empty-state">Todavía no tenés campañas finalizadas.</div>' : ''}
    </div>`;
}
function confirmDeleteCampaign(id) {
  renderModal(`
    <div class="modal-head"><h2>Eliminar campaña</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="notice" style="background:var(--red-dim); color:#a13323; border-color:#e8b3a8;">Esta acción no se puede deshacer.</div>
    <form onsubmit="submitDeleteCampaign(event,'${id}')">
      <div class="field" style="margin-top:16px;"><label class="req">Ingresá tu contraseña</label><input id="del_pass" type="password" required></div>
      <div class="modal-foot"><button class="btn btn-danger" type="submit">Eliminar definitivamente</button><button class="btn btn-ghost" type="button" onclick="closeModal()">Cancelar</button></div>
    </form>`);
}
async function submitDeleteCampaign(e, id) {
  e.preventDefault();
  try {
    await Api.del(`/campaigns/${id}`, { password: document.getElementById('del_pass').value });
    closeModal(); toast('Campaña eliminada.'); renderPage();
  } catch (err) { toast(err.message, true); }
}

async function renderStore(main) {
  const { packages, banks, settings } = await Api.get('/store/packages');
  main.innerHTML = `
    <div class="page-head"><div><h1>Tienda</h1><div class="ps">Elegí un paquete de créditos — el precio ya incluye el impuesto</div></div></div>
    <div class="pkg-grid" id="pkgGrid" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px; margin-bottom:28px;">
      ${packages.map(p => `<button type="button" class="pkg-card" data-credits="${p.credits}" onclick="selectPackage(${p.credits})" style="background:var(--panel); border:1px solid var(--border-soft); border-radius:14px; padding:18px 14px; text-align:center; cursor:pointer; transition:all .15s ease;">
        <div class="mono" style="font-weight:700; color:var(--gold); font-size:19px;">${p.credits} cr</div>
        <div style="font-size:13px; color:var(--text-dim); margin-top:4px;">$${p.usd.toFixed(2)} USD</div>
        <div style="font-size:11.5px; color:var(--text-faint);">$${fmtArs(p.ars)} ARS</div>
      </button>`).join('')}
    </div>
    <div class="section-card" style="max-width:540px;">
      <h3 style="margin-bottom:16px;" id="selectedPkgTitle">Elegí un paquete arriba</h3>
      <div class="stat-grid" style="margin:16px 0;">
        <div class="stat-card"><div class="sl">Créditos seleccionados</div><div class="sv gold" id="sel_credits">—</div></div>
        <div class="stat-card"><div class="sl">Total a pagar (impuesto incluido)</div><div class="sv" id="sel_price">—</div></div>
      </div>
      <form onsubmit="submitPurchase(event)">
        <div class="field"><label class="req">Nombre del titular que va a pagar</label><input id="p_holder" required placeholder="Nombre y apellido"></div>
        <div class="field"><label class="req">¿Con qué compañía vas a transferir?</label>
          <select id="p_bank">${(banks || []).map(b => `<option value="${b}">${b}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Alias / CBU para transferir</label><input value="${settings.paymentAlias}" disabled></div>
        <div class="notice" style="margin-bottom:16px;">Pago solo por transferencia bancaria. Una vez que transfieras, mandá el comprobante por Gmail a <b>${settings.paymentContactEmail}</b> — <b>tiene que ser desde el mismo Gmail con el que te registraste en ViewFlow</b>, así lo podemos confirmar más rápido.</div>
        <div class="mini-help" style="margin-bottom:16px;">La solicitud vence en 1 hora si no se confirma el pago.</div>
        <button class="btn btn-primary" type="submit" id="submitPurchaseBtn" disabled>Elegí un paquete primero</button>
      </form>
    </div>`;
}
let selectedCredits = null;
async function selectPackage(credits) {
  selectedCredits = credits;
  document.querySelectorAll('.pkg-card').forEach(el => {
    const active = Number(el.dataset.credits) === credits;
    el.style.borderColor = active ? 'var(--gold)' : 'var(--border-soft)';
    el.style.background = active ? 'var(--gold-dim)' : 'var(--panel)';
  });
  const q = await Api.get('/store/quote?credits=' + credits);
  document.getElementById('selectedPkgTitle').textContent = `Comprando ${credits} créditos`;
  document.getElementById('sel_credits').textContent = credits + ' cr';
  document.getElementById('sel_price').textContent = `$${q.usd.toFixed(2)} USD · $${fmtArs(q.ars)} ARS`;
  const btn = document.getElementById('submitPurchaseBtn');
  btn.disabled = false;
  btn.textContent = 'Enviar pedido de compra';
}
async function submitPurchase(e) {
  e.preventDefault();
  if (!selectedCredits) { toast('Elegí un paquete primero.', true); return; }
  try {
    const { purchase } = await Api.post('/store/purchases', {
      credits: selectedCredits,
      method: 'Transferencia bancaria',
      bankCompany: document.getElementById('p_bank').value,
      holderName: document.getElementById('p_holder').value.trim()
    });
    showPurchaseConfirmation(purchase);
  } catch (err) { toast(err.message, true); }
}

function showPurchaseConfirmation(purchase) {
  renderModal(`
    <div class="modal-head"><h2>Pedido creado</h2><button class="modal-close" onclick="closeModal(); goTo('purchases');">×</button></div>
    <div class="stat-grid" style="margin-bottom:16px;">
      <div class="stat-card"><div class="sl">Alias / CBU</div><div class="sv mono" style="font-size:15px;">${purchase.alias}</div></div>
      <div class="stat-card"><div class="sl">Monto a transferir</div><div class="sv gold">$${fmtArs(purchase.ars)} ARS</div></div>
    </div>
    <div class="notice" style="margin-bottom:16px;">Mandá el comprobante por Gmail a <b>${purchase.contactEmail}</b> una vez que transfieras — desde el mismo Gmail de tu cuenta. La solicitud vence en 1 hora si no se confirma el pago.</div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal(); goTo('purchases');">Entendido</button></div>`);
}

async function renderPurchases(main) {
  const { purchases } = await Api.get('/store/purchases/mine');
  main.innerHTML = `
    <div class="page-head"><div><h1>Mis compras</h1><div class="ps">Historial completo de tus pedidos</div></div></div>
    <div class="section-card table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Créditos</th><th>Pagás en USD</th><th>Pagás en ARS</th><th>Método</th><th>Titular</th><th>Estado</th></tr></thead>
        <tbody>${purchases.map(p => `<tr>
          <td>${new Date(p.createdAt).toLocaleString()}</td>
          <td class="mono">${p.credits}</td>
          <td class="mono">$${p.usd}</td>
          <td class="mono">$${fmtArs(p.ars)}</td>
          <td>${p.method}${p.bankCompany ? ' — ' + p.bankCompany : ''}</td>
          <td>${p.holderName}</td>
          <td><span class="badge badge-${p.status === 'approved' ? 'approved' : p.status === 'rejected' ? 'rejected' : 'pending'}">${p.status}</span></td>
        </tr>`).join('')}</tbody>
      </table>
      ${purchases.length === 0 ? '<div class="empty-state">Todavía no hiciste pedidos. Andá a la Tienda para comprar créditos.</div>' : ''}
    </div>`;
}

async function renderDonate(main) {
  const { donations, recipientCount } = await Api.get('/donations/mine');
  main.innerHTML = `
    <div class="page-head"><div><h1>Donar a viewers</h1><div class="ps">Repartí créditos en partes iguales entre todos los viewers aprobados</div></div></div>
    <div class="section-card" style="max-width:520px;">
      <div class="stat-card" style="margin-bottom:18px;"><div class="sl">Tu saldo disponible</div><div class="sv gold">${fmtCr(ME.credits || 0)} cr</div></div>
      <form onsubmit="submitDonation(event)">
        <div class="field"><label class="req">Cantidad de créditos a donar</label><input id="dn_credits" type="number" min="1" step="1" required></div>
        <div class="mini-help" style="margin-bottom:16px;">Se reparte entre los ${recipientCount} viewers aprobados actuales, una vez que el administrador lo confirme.</div>
        <button class="btn btn-primary" type="submit">Enviar donación a revisión</button>
      </form>
    </div>
    <div class="section-card table-wrap">
      <h3>Mis donaciones</h3>
      <table><thead><tr><th>Fecha</th><th>Créditos donados</th><th>Por viewer</th><th>Estado</th></tr></thead>
      <tbody>${donations.map(d => `<tr><td>${new Date(d.createdAt).toLocaleString()}</td><td class="mono">${d.credits}</td>
        <td class="mono">${d.status === 'approved' ? d.perRecipientAmount + ' cr' : '—'}</td>
        <td><span class="badge badge-${d.status === 'approved' ? 'approved' : d.status === 'rejected' ? 'rejected' : 'pending'}">${d.status}</span></td></tr>`).join('')}</tbody></table>
      ${donations.length === 0 ? '<div class="empty-state">Todavía no hiciste donaciones.</div>' : ''}
    </div>`;
}
async function submitDonation(e) {
  e.preventDefault();
  try {
    await Api.post('/donations/creator', { credits: parseInt(document.getElementById('dn_credits').value) });
    ME = await requireSession('creator');
    toast('Donación enviada. Queda retenida hasta que el administrador la apruebe.');
    renderPage();
  } catch (err) { toast(err.message, true); }
}

function renderProfile(main) {
  main.innerHTML = `
    <div class="page-head"><div><h1>Perfil</h1></div></div>
    <div class="section-card" style="max-width:520px; margin-bottom:20px;">
      <h3 style="margin-bottom:14px;">Estilo de tu panel</h3>
      <div style="display:flex; gap:10px;">
        <button class="btn ${ME.theme !== 'dark' ? 'btn-primary' : 'btn-ghost'}" onclick="setTheme('light')">Claro</button>
        <button class="btn ${ME.theme === 'dark' ? 'btn-primary' : 'btn-ghost'}" onclick="setTheme('dark')">Oscuro</button>
      </div>
    </div>
    <div class="section-card" style="max-width:520px;">
      <form onsubmit="saveProfile(event)">
        <div class="grid-2">
          <div class="field"><label>Nombre</label><input id="pf_name" value="${ME.name}"></div>
          <div class="field"><label>Teléfono</label><input id="pf_phone" value="${ME.phone || ''}"></div>
        </div>
        <div class="field"><label>Gmail</label><input value="${ME.email}" disabled></div>
        <div class="field"><label>Nombre visible</label><input id="pf_visible" value="${ME.visibleUser}"></div>
        <div class="field"><label>Usuario de YouTube</label><input id="pf_yt" value="${ME.ytUser || ''}"></div>
        <div class="field"><label class="req">Confirmá tu contraseña para guardar</label><input id="pf_pass" type="password" required></div>
        <div style="display:flex; gap:10px;"><button class="btn btn-primary" type="submit">Guardar cambios</button><button class="btn btn-ghost" type="button" onclick="renderPage()">Cancelar cambios</button></div>
      </form>
    </div>`;
}
async function setTheme(theme) {
  try {
    await Api.put('/auth/theme', { theme });
    ME.theme = theme;
    applyTheme(theme);
    renderPage();
  } catch (err) { toast(err.message, true); }
}
async function saveProfile(e) {
  e.preventDefault();
  try {
    const { account } = await Api.put('/auth/profile', {
      name: document.getElementById('pf_name').value, phone: document.getElementById('pf_phone').value,
      visibleUser: document.getElementById('pf_visible').value, ytUser: document.getElementById('pf_yt').value,
      currentPassword: document.getElementById('pf_pass').value
    });
    ME = account; toast('Perfil actualizado.'); renderPage();
  } catch (err) { toast(err.message, true); }
}

boot();

const CREATOR_SAFE_REFRESH_PAGES = ['dashboard', 'mine', 'finished', 'purchases'];
window.__vfSilentRefresh = () => { if (ME && CREATOR_SAFE_REFRESH_PAGES.includes(currentPage)) renderPage(true); };
