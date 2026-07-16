// public/js/viewer.js
let ME = null;
let currentPage = sessionStorage.getItem('vf_viewer_page') || 'dashboard';
let activeParticipation = null;
let participationTimer = null;

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'campaigns', label: 'Campañas disponibles' },
  { id: 'donate', label: 'Donar a viewers' },
  { id: 'withdraw', label: 'Retirar' },
  { id: 'history', label: 'Actividad' },
  { id: 'profile', label: 'Perfil' }
];
function buildNav() {
  document.getElementById('sbNav').innerHTML = NAV.map(n =>
    `<button class="nav-item" data-page="${n.id}" onclick="goTo('${n.id}')"><span>${n.label}</span></button>`).join('');
}
function goTo(id) { currentPage = id; sessionStorage.setItem('vf_viewer_page', id); renderPage(); }
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function renderModal(html, extraClass) {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-overlay"><div class="modal ${extraClass || ''}">${html}</div></div>`;
}
async function logout() { await Api.post('/auth/logout'); window.location.href = '/'; }
function fmtCr(n) { return (Math.floor(n * 10) / 10).toString(); }

async function boot() {
  ME = await requireSession('viewer');
  if (!ME) return;
  document.getElementById('sbUserName').textContent = ME.visibleUser;
  document.getElementById('sbUserEmail').textContent = ME.email;
  buildNav();
  renderPage();
  renderSupportWidget();
}

async function renderPage() {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === currentPage));
  const main = document.getElementById('mainContent');
  main.innerHTML = '<div class="empty-state">Cargando...</div>';
  try {
    if (currentPage === 'dashboard') await renderDashboard(main);
    else if (currentPage === 'campaigns') await renderCampaigns(main);
    else if (currentPage === 'donate') await renderDonate(main);
    else if (currentPage === 'withdraw') renderWithdraw(main);
    else if (currentPage === 'history') await renderHistory(main);
    else if (currentPage === 'profile') renderProfile(main);
  } catch (e) { main.innerHTML = `<div class="empty-state">${e.message}</div>`; }
}

async function renderDashboard(main) {
  const [{ campaigns }, { participations }, { withdrawals }, { donations }] = await Promise.all([
    Api.get('/campaigns/active'),
    Api.get('/campaigns/participations/mine'),
    Api.get('/withdrawals/mine'),
    Api.get('/donations/mine').catch(() => ({ donations: [] }))
  ]);
  const completed = participations.filter(p => p.status === 'completed');
  const creditsEarned = completed.reduce((s, p) => s + (p.reward || 0), 0);
  const creditsWithdrawn = withdrawals.filter(w => w.status === 'paid').reduce((s, w) => s + w.credits, 0);
  const creditsDonated = (donations.donations || []).reduce((s, d) => s + (d.credits || 0), 0);
  main.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><div class="ps">Tu actividad y tus créditos, de un vistazo</div></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="sl">Créditos disponibles</div><div class="sv gold">${fmtCr(ME.credits || 0)} cr</div></div>
      <div class="stat-card"><div class="sl">Campañas disponibles</div><div class="sv teal">${campaigns.length}</div></div>
      <div class="stat-card"><div class="sl">Campañas participadas</div><div class="sv">${completed.length}</div></div>
      <div class="stat-card"><div class="sl">Créditos retirados</div><div class="sv">${fmtCr(creditsWithdrawn)}</div></div>
      <div class="stat-card"><div class="sl">Créditos donados</div><div class="sv">${fmtCr(creditsDonated)}</div></div>
      <div class="stat-card"><div class="sl">Créditos ganados</div><div class="sv teal">${fmtCr(creditsEarned)}</div></div>
    </div>`;
}

async function renderCampaigns(main) {
  const { campaigns } = await Api.get('/campaigns/active');
  main.innerHTML = `
    <div class="page-head"><div><h1>Campañas disponibles</h1><div class="ps">Mirá videos y ganá créditos por tu tiempo</div></div></div>
    ${campaigns.length === 0 ? '<div class="empty-state">No hay campañas disponibles en este momento.</div>' : campaigns.map(c => `
      <div class="section-card" style="margin-bottom:14px;">
        <h4>${c.title}</h4>
        <div class="mini-help">Por ${c.creatorName} · Quedate viendo: <b>${formatHMS(c.seconds)}</b> · Vas a ganar: <b style="color:var(--gold)">${fmtCr(c.rewardPerView)} créditos</b></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, (c.viewsDone / c.views) * 100)}%"></div></div>
        <div style="margin-top:14px;"><button class="btn btn-primary btn-sm" onclick="openParticipate('${c.id}')">Participar</button></div>
      </div>`).join('')}`;
}
function formatHMS(total) {
  const m = Math.floor(total / 60), s = total % 60;
  return m ? `${m}:${String(s).padStart(2, '0')} min` : `${s}s`;
}

function getYoutubeEmbed(videoId, locked) {
  const lockedParams = locked ? '&controls=0&disablekb=1&fs=0&iv_load_policy=3' : '';
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${lockedParams}`;
}
function ytCommand(iframeId, func) {
  const iframe = document.getElementById(iframeId);
  if (!iframe || !iframe.contentWindow) return;
  try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*'); } catch (e) {}
}

async function openParticipate(campId) {
  let start;
  try { start = await Api.post(`/campaigns/${campId}/participate/start`); }
  catch (err) { toast(err.message, true); return; }

  activeParticipation = { id: start.participation.id, campaignId: campId, seconds: start.participation.seconds, reward: start.participation.reward, videoId: start.videoId };
  let remaining = activeParticipation.seconds;
  const embed = getYoutubeEmbed(activeParticipation.videoId, true);

  renderModal(`
    <div class="modal-head"><h2>Mirando video</h2><button class="modal-close" onclick="tryCloseParticipation()">×</button></div>
    <div class="player-frame"><iframe id="pt_yt_iframe" src="${embed}" style="width:100%;height:100%;border:0;" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe><div class="player-lock-overlay"></div></div>
    <div class="timer-ring-text mono" id="pt_remaining">${formatHMS(remaining)}</div>
    <div class="timer-label">Quedate viendo sin salir de esta pestaña para ganar <b style="color:var(--gold)">${fmtCr(activeParticipation.reward)} créditos</b></div>
    <div class="progress-bar"><div class="progress-fill" id="pt_progress" style="width:0%"></div></div>
    <div class="mini-help" id="pt_tabwarn" style="text-align:center; color:var(--red);"></div>
    <div class="modal-foot"><button class="btn btn-danger" id="pt_stop_btn" onclick="stopParticipation()">Dejar de participar</button></div>
  `, 'modal-video');

  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const total = activeParticipation.seconds;
  const grace = Math.min(5, Math.floor(total * 0.2));
  if (participationTimer) clearInterval(participationTimer);
  participationTimer = setInterval(async () => {
    if (!activeParticipation) return;
    if (document.hidden) return;
    remaining--;
    const el = document.getElementById('pt_remaining');
    const pg = document.getElementById('pt_progress');
    if (el) el.textContent = formatHMS(Math.max(0, remaining));
    if (pg) pg.style.width = (((total - remaining) / total) * 100) + '%';
    if (remaining <= total - grace) {
      const btn = document.getElementById('pt_stop_btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Ventana de salida cerrada'; }
    }
    if (remaining <= 0) {
      clearInterval(participationTimer);
      await completeParticipation();
    }
  }, 1000);
}

function onVisibilityChange() {
  const warnEl = document.getElementById('pt_tabwarn');
  if (warnEl) warnEl.textContent = document.hidden ? 'El video está pausado: volvé a esta pestaña.' : '';
  ytCommand('pt_yt_iframe', document.hidden ? 'pauseVideo' : 'playVideo');
}

async function completeParticipation() {
  if (!activeParticipation) return;
  try {
    const res = await Api.post(`/campaigns/${activeParticipation.campaignId}/participate/complete`, { participationId: activeParticipation.id });
    ME.credits = res.credits;
    closeModal();
    showRewardPop(res.reward);
    activeParticipation = null;
  } catch (err) {
    toast(err.message, true);
    closeModal();
    activeParticipation = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  renderPage();
}
function showRewardPop(reward) {
  renderModal(`
    <div class="reward-pop" style="text-align:center; padding:20px 0;">
      <div style="font-size:34px; font-weight:800; color:var(--gold);">+${fmtCr(reward)} créditos</div>
      <div class="mini-help" style="margin-top:8px;">¡Participación registrada!</div>
      <button class="btn btn-primary" style="margin-top:20px;" onclick="closeModal()">Cerrar</button>
    </div>`);
}
async function stopParticipation() { await abandonParticipation(); }
async function tryCloseParticipation() { await abandonParticipation(); }
async function abandonParticipation() {
  if (!activeParticipation) { closeModal(); return; }
  clearInterval(participationTimer);
  try { await Api.post(`/campaigns/${activeParticipation.campaignId}/participate/abandon`, { participationId: activeParticipation.id }); } catch (e) {}
  document.removeEventListener('visibilitychange', onVisibilityChange);
  activeParticipation = null;
  closeModal();
  toast('Dejaste de participar.', true);
  renderPage();
}

function renderWithdraw(main) {
  main.innerHTML = `
    <div class="page-head"><div><h1>Retirar</h1><div class="ps">Pasá tus créditos a dinero real</div></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="sl">Créditos disponibles</div><div class="sv gold">${fmtCr(ME.credits || 0)}</div></div>
    </div>
    <div class="section-card" style="max-width:520px;">
      <form onsubmit="submitWithdraw(event)">
        <div class="field">
          <label class="req">Cantidad de créditos (podés usar coma)</label>
          <div style="display:flex; gap:8px;">
            <input id="wd_credits" type="text" required oninput="updateWithdrawPreview()">
            <button class="btn btn-ghost btn-sm" type="button" onclick="withdrawAll()">Retirar todo</button>
          </div>
        </div>
        <div class="mini-help" id="wd_preview" style="margin-bottom:14px;"></div>
        <div class="field"><label class="req">Método de pago</label><select id="wd_method"><option>Mercado Pago</option><option>Transferencia</option></select></div>
        <div class="field"><label class="req">Alias / CBU</label><input id="wd_alias" required></div>
        <div class="field"><label class="req">Nombre y apellido del titular</label><input id="wd_holder" required></div>
        <button class="btn btn-primary" type="submit">Generar retiro</button>
      </form>
    </div>`;
}
function withdrawAll() {
  document.getElementById('wd_credits').value = String(ME.credits || 0).replace('.', ',');
  updateWithdrawPreview();
}
async function updateWithdrawPreview() {
  const raw = document.getElementById('wd_credits').value.replace(',', '.');
  const q = await Api.get('/withdrawals/quote?credits=' + (raw || 0));
  document.getElementById('wd_preview').textContent = `Vas a recibir: $${q.usd} USD / $${fmtArs(q.ars)} ARS después del impuesto.`;
}
async function submitWithdraw(e) {
  e.preventDefault();
  try {
    const { message } = await Api.post('/withdrawals', {
      credits: document.getElementById('wd_credits').value,
      method: document.getElementById('wd_method').value,
      alias: document.getElementById('wd_alias').value,
      holderName: document.getElementById('wd_holder').value
    });
    ME = await requireSession('viewer');
    toast(message);
    renderPage();
  } catch (err) { toast(err.message, true); }
}

function renderProfile(main) {
  main.innerHTML = `
    <div class="page-head"><div><h1>Perfil</h1></div></div>
    <div class="section-card" style="max-width:520px;">
      <form onsubmit="saveProfile(event)">
        <div class="field"><label>Nombre</label><input id="pf_name" value="${ME.name}"></div>
        <div class="field"><label>Gmail</label><input value="${ME.email}" disabled></div>
        <div class="field"><label>Teléfono</label><input id="pf_phone" value="${ME.phone || ''}"></div>
        <div class="field"><label>Usuario visible</label><input id="pf_visible" value="${ME.visibleUser}"></div>
        <div class="field"><label class="req">Confirmá tu contraseña para guardar</label><input id="pf_pass" type="password" required></div>
        <div style="display:flex; gap:10px;"><button class="btn btn-primary" type="submit">Guardar cambios</button><button class="btn btn-ghost" type="button" onclick="renderPage()">Cancelar cambios</button></div>
      </form>
    </div>`;
}
async function saveProfile(e) {
  e.preventDefault();
  try {
    const { account } = await Api.put('/auth/profile', {
      name: document.getElementById('pf_name').value, phone: document.getElementById('pf_phone').value,
      visibleUser: document.getElementById('pf_visible').value, currentPassword: document.getElementById('pf_pass').value
    });
    ME = account; toast('Perfil actualizado.'); renderPage();
  } catch (err) { toast(err.message, true); }
}

async function renderDonate(main) {
  const { donations, recipientCount } = await Api.get('/donations/mine');
  main.innerHTML = `
    <div class="page-head"><div><h1>Donar a viewers</h1><div class="ps">Repartí créditos en partes iguales entre todos los demás viewers</div></div></div>
    <div class="section-card" style="max-width:480px;">
      <div class="stat-card" style="margin-bottom:16px;"><div class="sl">Tu saldo disponible</div><div class="sv gold">${fmtCr(ME.credits || 0)} cr</div></div>
      <form onsubmit="submitDonate(event)">
        <div class="field"><label class="req">Cantidad de créditos a donar</label><input id="dnCredits" type="number" min="1" step="1" required></div>
        <div class="mini-help" style="margin-bottom:14px;">Se van a repartir entre los ${recipientCount} viewers actuales, una vez que el administrador confirme la donación.</div>
        <button class="btn btn-primary" type="submit">Enviar donación a revisión</button>
      </form>
    </div>
    <div class="section-card table-wrap" style="margin-top:20px;">
      <h3>Mis donaciones</h3>
      <table><thead><tr><th>Fecha</th><th>Créditos</th><th>Por viewer</th><th>Estado</th></tr></thead>
      <tbody>${donations.map(d => `<tr><td>${new Date(d.createdAt).toLocaleString()}</td><td class="mono">${d.credits}</td>
        <td class="mono">${d.status === 'approved' ? d.perRecipientAmount : '—'}</td>
        <td><span class="badge badge-${d.status === 'approved' ? 'approved' : d.status === 'rejected' ? 'rejected' : 'pending'}">${d.status}</span></td></tr>`).join('') || '<tr><td colspan="4">Todavía no hiciste donaciones.</td></tr>'}</tbody></table>
    </div>`;
}
async function submitDonate(e) {
  e.preventDefault();
  try {
    const credits = Number(document.getElementById('dnCredits').value);
    await Api.post('/donations/viewer', { credits });
    toast('Donación enviada. Queda retenida hasta que el administrador la apruebe.');
    ME = await requireSession('viewer');
    renderPage();
  } catch (err) { toast(err.message, true); }
}

async function renderHistory(main) {
  const [{ participations }, { withdrawals }, { donations }] = await Promise.all([
    Api.get('/campaigns/participations/mine'),
    Api.get('/withdrawals/mine'),
    Api.get('/donations/mine')
  ]);
  const rows = [];
  participations.filter(p => p.status === 'completed').forEach(p => rows.push({ ts: p.startedAt, detail: 'Participación: ' + p.campaignTitle, type: 'in', amount: p.reward }));
  withdrawals.forEach(w => rows.push({ ts: w.createdAt, detail: `Retiro (${w.status})`, type: 'out', amount: w.credits }));
  donations.forEach(d => rows.push({ ts: d.createdAt, detail: `Donación enviada (${d.status})`, type: 'out', amount: d.credits }));
  rows.sort((a, b) => b.ts - a.ts);
  main.innerHTML = `
    <div class="page-head"><div><h1>Actividad</h1><div class="ps">De dónde vinieron tus créditos y a dónde fueron</div></div></div>
    <div class="section-card table-wrap">
      <table><thead><tr><th>Fecha</th><th>Detalle</th><th>Tipo</th><th>Monto</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${new Date(r.ts).toLocaleString()}</td><td>${r.detail}</td>
        <td><span class="badge badge-${r.type === 'in' ? 'approved' : 'rejected'}">${r.type === 'in' ? 'Ingreso' : 'Egreso'}</span></td>
        <td class="mono" style="color:${r.type === 'in' ? 'var(--teal)' : 'var(--red)'}">${r.type === 'in' ? '+' : '-'}${fmtCr(r.amount)}</td></tr>`).join('') || '<tr><td colspan="4">Todavía no hay movimientos.</td></tr>'}</tbody></table>
    </div>`;
}

boot();
