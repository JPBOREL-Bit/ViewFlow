// public/js/viewer.js
let ME = null;
let currentPage = sessionStorage.getItem('vf_viewer_page') || 'dashboard';
let activeParticipation = null;
let participationTimer = null;

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'campaigns', label: 'Campañas disponibles' },
  { id: 'subscription', label: 'Suscripción' },
  { id: 'donate', label: 'Donar a viewers' },
  { id: 'withdraw', label: 'Retirar' },
  { id: 'history', label: 'Actividad' },
  { id: 'profile', label: 'Perfil' },
  { id: 'devices', label: 'Dispositivos' }
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

let campaignsPollInterval = null;
async function renderPage(silent) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === currentPage));
  if (!silent && campaignsPollInterval) { clearInterval(campaignsPollInterval); campaignsPollInterval = null; }
  const main = document.getElementById('mainContent');
  if (!silent) main.innerHTML = '<div class="empty-state">Cargando...</div>';
  try {
    if (currentPage === 'dashboard') await renderDashboard(main);
    else if (currentPage === 'campaigns') { await renderCampaigns(main); if (!silent) campaignsPollInterval = setInterval(() => renderCampaigns(main), 6000); }
    else if (currentPage === 'subscription') await renderSubscription(main);
    else if (currentPage === 'donate') await renderDonate(main);
    else if (currentPage === 'withdraw') await renderWithdraw(main);
    else if (currentPage === 'history') await renderHistory(main);
    else if (currentPage === 'profile') renderProfile(main);
    else if (currentPage === 'devices') await renderDevices(main);
  } catch (e) { if (!silent) main.innerHTML = `<div class="empty-state">${e.message}</div>`; }
}

async function renderDashboard(main) {
  const [{ campaigns }, { participations }, { withdrawals }, { donations }, sub] = await Promise.all([
    Api.get('/campaigns/active'),
    Api.get('/campaigns/participations/mine'),
    Api.get('/withdrawals/mine'),
    Api.get('/donations/mine').catch(() => ({ donations: [] })),
    Api.get('/subscriptions/mine').catch(() => null)
  ]);
  const completed = participations.filter(p => p.status === 'completed');
  const creditsEarned = completed.reduce((s, p) => s + (p.reward || 0), 0);
  const creditsWithdrawn = withdrawals.filter(w => w.status === 'paid').reduce((s, w) => s + w.credits, 0);
  const creditsDonated = (donations.donations || []).reduce((s, d) => s + (d.credits || 0), 0);
  const planLabel = sub ? sub.planDetail.label : 'Free';
  main.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><div class="ps">Tu actividad y tus créditos, de un vistazo</div></div></div>
    ${sub ? `<div class="section-card" style="margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
      <div>
        <div class="mini-help" style="margin-bottom:4px;">Tu plan actual</div>
        <div style="font-size:20px; font-weight:700;">${planLabel} ${sub.planDetail.badge ? `<span class="badge badge-approved">${sub.planDetail.badge}</span>` : ''}</div>
        <div class="mini-help" style="margin-top:4px;">Impuesto de retiro: ${sub.planDetail.withdrawTaxPct}% · Tiempo reducido: ${sub.planDetail.timeReductionPct}%</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="goTo('subscription')">Mejorar plan</button>
    </div>` : ''}
    <div class="stat-grid">
      <div class="stat-card"><div class="sl">Créditos disponibles</div><div class="sv gold">${fmtCr(ME.credits || 0)} cr</div></div>
      <div class="stat-card"><div class="sl">Campañas disponibles</div><div class="sv teal">${campaigns.length}</div></div>
      <div class="stat-card"><div class="sl">Campañas participadas</div><div class="sv">${completed.length}</div></div>
      <div class="stat-card"><div class="sl">Créditos retirados</div><div class="sv">${fmtCr(creditsWithdrawn)}</div></div>
      <div class="stat-card"><div class="sl">Créditos donados</div><div class="sv">${fmtCr(creditsDonated)}</div></div>
      <div class="stat-card"><div class="sl">Créditos ganados</div><div class="sv teal">${fmtCr(creditsEarned)}</div></div>
    </div>
    <div class="ad-slot-banner"><ins class="adsbygoogle"
     style="display:block; width:100%;"
     data-ad-client="ca-pub-8545340767144593"
     data-ad-slot="6688850781"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;
}

const PLATFORM_LABELS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
function planTimeReductionPct(plan) { return { free: 0, plus: 10, pro: 25, elite: 50 }[plan] || 0; }
function reducedSecondsPreview(seconds) {
  const pct = planTimeReductionPct((ME && ME.subPlan) || 'free');
  return Math.max(5, Math.round(seconds * (1 - pct / 100)));
}

async function renderCampaigns(main) {
  const { campaigns } = await Api.get('/campaigns/active');
  main.innerHTML = `
    <div class="page-head"><div><h1>Campañas disponibles</h1><div class="ps">Mirá videos y ganá créditos por tu tiempo</div></div></div>
    ${campaigns.length === 0 ? '<div class="empty-state">No hay campañas disponibles en este momento.</div>' : campaigns.map(c => `
      <div class="section-card" style="margin-bottom:14px;">
        <h4>${c.title}</h4>
        <div class="mini-help">Por ${c.creatorName} · Quedate viendo: <b>${formatHMS(reducedSecondsPreview(c.seconds))}</b>${reducedSecondsPreview(c.seconds) < c.seconds ? ` <span style="color:var(--gold);">(reducido por tu plan)</span>` : ''} · Vas a ganar: <b style="color:var(--gold)">${fmtCr(c.rewardPerView)} créditos</b></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, (c.viewsDone / c.views) * 100)}%"></div></div>
        <div style="margin-top:14px;"><button class="btn btn-primary btn-sm" onclick="openParticipate('${c.id}')">Participar</button></div>
      </div>`).join('')}`;
}
function formatHMS(total) {
  const m = Math.floor(total / 60), s = total % 60;
  return m ? `${m}:${String(s).padStart(2, '0')} min` : `${s}s`;
}

let ytPlayer = null;
let ytApiReadyPromise = null;
function loadYouTubeApi() {
  if (ytApiReadyPromise) return ytApiReadyPromise;
  ytApiReadyPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    window.onYouTubeIframeAPIReady = resolve;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiReadyPromise;
}

async function openParticipate(campId) {
  let start;
  try { start = await Api.post(`/campaigns/${campId}/participate/start`); }
  catch (err) { toast(err.message, true); return; }

  activeParticipation = { id: start.participation.id, campaignId: campId, seconds: start.participation.seconds, reward: start.participation.reward, videoId: start.videoId };
  let total = start.participation.effectiveSeconds; // ya viene reducido según el plan del viewer
  let remaining = total;
  const reducedNote = total < activeParticipation.seconds ? ` <span style="color:var(--gold);">(reducido por tu plan)</span>` : '';

  renderModal(`
    <div class="modal-head"><h2>Mirando video</h2><button class="modal-close" onclick="tryCloseParticipation()">×</button></div>
    <div class="player-frame"><div id="pt_yt_player" style="width:100%; height:100%;"></div><div class="player-lock-overlay"></div></div>
    <div class="timer-ring-text mono" id="pt_remaining">${formatHMS(remaining)}</div>
    <div class="timer-label" id="pt_label">Quedate viendo sin salir de esta pestaña para ganar <b style="color:var(--gold)">${fmtCr(activeParticipation.reward)} créditos</b>${reducedNote}</div>
    <div class="progress-bar"><div class="progress-fill" id="pt_progress" style="width:0%"></div></div>
    <div class="mini-help" id="pt_tabwarn" style="text-align:center; color:var(--red);"></div>
    <div class="modal-foot"><button class="btn btn-danger" id="pt_stop_btn" onclick="stopParticipation()">Dejar de participar</button></div>
  `, 'modal-video');

  await loadYouTubeApi();
  ytPlayer = new YT.Player('pt_yt_player', {
    videoId: activeParticipation.videoId,
    playerVars: { autoplay: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, origin: location.origin },
    events: {
      onReady: async (e) => {
        e.target.playVideo();
        const dur = Math.floor(e.target.getDuration() || 0);
        if (dur > 0 && dur < total) {
          try {
            const res = await Api.post(`/campaigns/${campId}/participate/duration`, { participationId: activeParticipation.id, duration: dur });
            total = res.effectiveSeconds;
            remaining = Math.min(remaining, total);
            const labelEl = document.getElementById('pt_label');
            if (labelEl) labelEl.innerHTML = `El video dura menos de lo pedido — mirándolo completo ya ganás <b style="color:var(--gold)">${fmtCr(activeParticipation.reward)} créditos</b> (el creador paga el tiempo completo igual).`;
          } catch (err) { /* si falla, seguimos con el tiempo original */ }
        }
      }
    }
  });

  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const grace = Math.min(5, Math.floor(total * 0.2));
  if (participationTimer) clearInterval(participationTimer);
  participationTimer = setInterval(async () => {
    if (!activeParticipation) return;
    if (document.hidden) return;
    remaining = Math.max(0, Math.min(remaining - 1, total));
    const el = document.getElementById('pt_remaining');
    const pg = document.getElementById('pt_progress');
    if (el) el.textContent = formatHMS(remaining);
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
  if (ytPlayer && ytPlayer.pauseVideo) {
    try { document.hidden ? ytPlayer.pauseVideo() : ytPlayer.playVideo(); } catch (e) {}
  }
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
  if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch (e) {} ytPlayer = null; }
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
  if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch (e) {} ytPlayer = null; }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  activeParticipation = null;
  closeModal();
  toast('Dejaste de participar.', true);
  renderPage();
}

async function renderSubscription(main) {
  const [{ plans, banks }, sub] = await Promise.all([Api.get('/subscriptions/plans'), Api.get('/subscriptions/mine')]);
  const currentIdx = plans.findIndex(p => p.key === sub.plan);
  main.innerHTML = `
    <div class="page-head"><div><h1>Suscripción</h1><div class="ps">Mejorá tu plan y reducí el tiempo de las campañas y el impuesto de retiro</div></div></div>
    <div class="notice" style="margin-bottom:16px;">Las suscripciones ViewFlow Premium ofrecen beneficios dentro de la plataforma, pero no garantizan una cantidad determinada de campañas, visualizaciones o ingresos. La disponibilidad de campañas depende exclusivamente de la actividad de los creadores dentro de ViewFlow.</div>
    <div class="mini-help" style="margin-bottom:24px;">El usuario acepta que pueden existir períodos con pocas o ninguna campaña disponible.</div>

    ${sub.pendingPurchase ? `<div class="notice" style="margin-bottom:20px;">Tenés una solicitud pendiente de aprobación para el plan <b>${plans.find(p => p.key === sub.pendingPurchase.plan)?.label}</b>. Mandaste el comprobante por Gmail a <b>${sub.pendingPurchase.contactEmail}</b> — te avisamos cuando se apruebe.</div>` : ''}

    <div class="section-card" style="margin-bottom:24px;">
      <h3 style="margin-bottom:6px;">Tu plan actual: ${sub.planDetail.label}${sub.planDetail.badge ? ` <span class="badge badge-approved">${sub.planDetail.badge}</span>` : ''}</h3>
      <div class="mini-help">Impuesto de retiro: ${sub.planDetail.withdrawTaxPct}% · Reducción de tiempo en campañas: ${sub.planDetail.timeReductionPct}%</div>
      ${sub.plan !== 'free' ? `<div class="mini-help" style="margin-top:6px;">
        ${sub.billingCycle === 'annual' ? 'Pago anual (1 pago) — no se te vuelve a cobrar hasta' : 'Pago mensual — se renueva automáticamente el'} ${sub.renewsAt ? new Date(sub.renewsAt).toLocaleDateString() : '—'}.
        Si cancelás, no se devuelve lo ya pagado.
      </div>
      <div style="margin-top:12px;"><button class="btn btn-danger btn-sm" onclick="cancelSubscription()">Cancelar suscripción</button></div>` : ''}
    </div>

    <div class="pkg-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:16px;">
      ${plans.map((p, i) => `
        <div class="section-card" style="text-align:center; ${p.key === sub.plan ? 'border-color:var(--gold);' : ''}">
          <h3 style="margin-bottom:2px;">${p.label}</h3>
          <div class="mono" style="font-size:22px; font-weight:700; color:var(--gold); margin:8px 0;">${p.priceUsd === 0 ? 'Gratis' : `$${p.priceUsd.toFixed(2)}/mes`}</div>
          ${p.priceUsd > 0 ? `<div class="mini-help" style="margin-bottom:12px;">$${fmtArsSub(p.priceArs)} ARS/mes</div>` : '<div style="height:20px;"></div>'}
          <ul style="text-align:left; font-size:13px; color:var(--text-dim); line-height:1.9; margin-bottom:16px; padding-left:18px;">
            <li>${p.timeReductionPct}% menos tiempo por campaña</li>
            <li>Impuesto de retiro: ${p.withdrawTaxPct}%</li>
            <li>Prioridad: ${['Normal', 'Media', 'Alta', 'Máxima'][i]}</li>
            ${p.badge ? `<li>Badge ${p.badge} en tu perfil</li>` : '<li>Sin badge</li>'}
          </ul>
          ${p.key === sub.plan
            ? `<button class="btn btn-ghost btn-sm" disabled>Plan actual</button>`
            : p.key === 'free'
              ? `<button class="btn btn-ghost btn-sm" onclick="cancelSubscription()">Volver a Free</button>`
              : sub.pendingPurchase
                ? `<button class="btn btn-ghost btn-sm" disabled>Tenés un pago pendiente</button>`
                : `<button class="btn btn-primary btn-sm" onclick="openSubscribeModal('${p.key}')">Elegir ${p.label}</button>`}
        </div>`).join('')}
    </div>`;
}
function fmtArsSub(n) { return Math.round(n).toLocaleString('es-AR'); }

async function openSubscribeModal(planKey) {
  const { plans, banks, annualDiscountPct } = await Api.get('/subscriptions/plans');
  const plan = plans.find(p => p.key === planKey);
  renderModal(`
    <div class="modal-head"><h2>Suscribirte a ${plan.label}</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="field"><label class="req">¿Cómo querés pagar?</label>
      <select id="sub_cycle" onchange="onSubCycleChange(${plan.priceUsd}, ${plan.annualUsd}, ${plan.priceArs}, ${plan.annualArs})">
        <option value="monthly">Mensual — $${plan.priceUsd.toFixed(2)} USD por mes</option>
        <option value="annual">Anual (1 pago) — $${plan.annualUsd.toFixed(2)} USD, ahorrás ${annualDiscountPct}%</option>
      </select>
    </div>
    <div class="stat-grid" style="margin-bottom:16px;">
      <div class="stat-card"><div class="sl">A pagar ahora</div><div class="sv gold" id="sub_price_usd">$${plan.priceUsd.toFixed(2)} USD</div></div>
      <div class="stat-card"><div class="sl">En pesos</div><div class="sv" id="sub_price_ars">$${fmtArsSub(plan.priceArs)} ARS</div></div>
    </div>
    <form onsubmit="submitSubscribe(event, '${planKey}')">
      <div class="field"><label class="req">Nombre del titular que va a pagar</label><input id="sub_holder" required placeholder="Nombre y apellido"></div>
      <div class="field"><label class="req">¿Con qué compañía vas a transferir?</label>
        <select id="sub_bank">${banks.map(b => `<option value="${b}">${b}</option>`).join('')}</select>
      </div>
      <div class="notice" style="margin-bottom:16px;">Pago manual por ahora: transferís, mandás el comprobante por Gmail (desde el mismo Gmail de tu cuenta), y el admin lo aprueba. La solicitud vence en 1 hora si no se confirma.</div>
      <div class="field" style="display:flex; align-items:flex-start; gap:8px;">
        <input type="checkbox" id="sub_terms" required style="width:auto; margin-top:3px;">
        <label for="sub_terms" style="margin:0; font-weight:400; font-size:13px;">Entiendo que si cancelo la suscripción <b>no se me devuelve el dinero ya pagado</b>, y que (salvo que haya pagado el plan anual) <b>se renueva automáticamente cada mes en la misma fecha</b>, teniendo que volver a pagar para seguir con los beneficios.</label>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" type="submit">Enviar pedido de suscripción</button></div>
    </form>`);
}
function onSubCycleChange(monthlyUsd, annualUsd, monthlyArs, annualArs) {
  const cycle = document.getElementById('sub_cycle').value;
  document.getElementById('sub_price_usd').textContent = `$${(cycle === 'annual' ? annualUsd : monthlyUsd).toFixed(2)} USD`;
  document.getElementById('sub_price_ars').textContent = `$${fmtArsSub(cycle === 'annual' ? annualArs : monthlyArs)} ARS`;
}
async function submitSubscribe(e, planKey) {
  e.preventDefault();
  try {
    const { purchase } = await Api.post('/subscriptions/subscribe', {
      plan: planKey,
      billingCycle: document.getElementById('sub_cycle').value,
      bankCompany: document.getElementById('sub_bank').value,
      holderName: document.getElementById('sub_holder').value.trim(),
      acceptedSubTerms: document.getElementById('sub_terms').checked
    });
    renderModal(`
      <div class="modal-head"><h2>Solicitud enviada</h2><button class="modal-close" onclick="closeModal(); goTo('subscription');">×</button></div>
      <div class="stat-grid" style="margin-bottom:16px;">
        <div class="stat-card"><div class="sl">Alias / CBU</div><div class="sv mono" style="font-size:15px;">${purchase.alias}</div></div>
        <div class="stat-card"><div class="sl">Monto a transferir</div><div class="sv gold">$${fmtArsSub(purchase.priceArs)} ARS</div></div>
      </div>
      <div class="notice" style="margin-bottom:16px;">Mandá el comprobante por Gmail a <b>${purchase.contactEmail}</b> — desde el mismo Gmail de tu cuenta.</div>
      <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal(); goTo('subscription');">Entendido</button></div>`);
  } catch (err) { toast(err.message, true); }
}
async function cancelSubscription() {
  if (!confirm('¿Seguro que querés cancelar tu suscripción? Volvés al plan Free al instante y NO se devuelve el dinero ya pagado.')) return;
  try { await Api.post('/subscriptions/cancel'); toast('Volviste al plan Free.'); goTo('subscription'); }
  catch (err) { toast(err.message, true); }
}

async function renderWithdraw(main) {
  const [{ banks, mismatchPenaltyPct }, sub] = await Promise.all([
    Api.get('/withdrawals/banks'),
    Api.get('/subscriptions/mine').catch(() => null)
  ]);
  const taxPct = sub ? sub.planDetail.withdrawTaxPct : 15;
  main.innerHTML = `
    <div class="page-head"><div><h1>Retirar</h1><div class="ps">Pasá tus créditos a dinero real</div></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="sl">Créditos disponibles</div><div class="sv gold">${fmtCr(ME.credits || 0)}</div></div>
    </div>
    <div class="notice" style="margin-bottom:16px; max-width:520px;">Tu plan actual (${sub ? sub.planDetail.label : 'Free'}) tiene un impuesto de retiro del <b>${taxPct}%</b>.</div>
    <div class="mini-help" style="margin-bottom:16px; max-width:520px;">Los retiros son para mayores de 18 años. Si el alias/CBU no coincide con el nombre del titular, el pago puede quedar retenido para verificación.</div>
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
        <div class="field"><label class="req">¿Con qué compañía te vamos a pagar?</label>
          <select id="wd_bank">${banks.map(b => `<option value="${b}">${b}</option>`).join('')}</select>
        </div>
        <div class="field"><label class="req">Alias / CBU</label><input id="wd_alias" required></div>
        <div class="field"><label class="req">Nombre y apellido del titular de esa cuenta</label><input id="wd_holder" required></div>
        <div class="field" style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="wd_match" style="width:auto;">
          <label for="wd_match" style="margin:0;">El titular de la cuenta bancaria es el mismo que el de mi cuenta de ViewFlow</label>
        </div>
        <div class="mini-help" style="margin-bottom:14px;">Si no coincide, el pago se puede anular y devolverse con un ${mismatchPenaltyPct}% de penalidad.</div>
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
  document.getElementById('wd_preview').textContent = `Vas a recibir: $${q.usd} USD / $${fmtArs(q.ars)} ARS después del impuesto de tu plan (${q.planTaxPct}%).`;
}
async function submitWithdraw(e) {
  e.preventDefault();
  try {
    const { message } = await Api.post('/withdrawals', {
      credits: document.getElementById('wd_credits').value,
      bankCompany: document.getElementById('wd_bank').value,
      alias: document.getElementById('wd_alias').value,
      holderName: document.getElementById('wd_holder').value,
      holderMatchesAccount: document.getElementById('wd_match').checked
    });
    ME = await requireSession('viewer');
    toast(message);
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
        <div class="field"><label>Nombre</label><input id="pf_name" value="${ME.name}"></div>
        <div class="field"><label>Gmail</label><input value="${ME.email}" disabled></div>
        <div class="field"><label>Teléfono</label><input id="pf_phone" value="${ME.phone || ''}"></div>
        <div class="field"><label>Usuario visible</label><input id="pf_visible" value="${ME.visibleUser}"></div>
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

const VIEWER_SAFE_REFRESH_PAGES = ['dashboard', 'history'];
window.__vfSilentRefresh = () => { if (ME && VIEWER_SAFE_REFRESH_PAGES.includes(currentPage)) renderPage(true); };
