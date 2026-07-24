// public/js/landing.js
document.getElementById('year').textContent = new Date().getFullYear();

// Trae textos del sitio configurados por el admin (sin exponer nada sensible).
Api.get('/public-settings').then(s => {
  document.title = s.siteTitle;
  document.getElementById('heroTitle').textContent = s.siteTagline;
  document.getElementById('heroDesc').textContent = s.siteDesc;
  if (s.maintenanceMode) showMaintenanceOverlay(s.maintenanceMessage);
  if (s.stats) renderCommunityStats(s.stats);
}).catch(() => {});

function renderCommunityStats(stats) {
  const el = document.getElementById('communityStats');
  if (!el) return;
  el.innerHTML = `
    <div class="community-stat"><div class="cs-num">${stats.totalCreators}</div><div class="cs-label">Creadores <span class="cs-online">${stats.onlineCreators} en línea</span></div></div>
    <div class="community-stat"><div class="cs-num">${stats.totalViewers}</div><div class="cs-label">Viewers <span class="cs-online">${stats.onlineViewers} en línea</span></div></div>`;
}

// Si ya hay sesión activa, mandamos directo al panel correspondiente.
Api.get('/auth/me').then(({ account }) => {
  if (account.role === 'creator') window.location.href = '/creator.html';
  else if (account.role === 'viewer') window.location.href = '/viewer.html';
  else if (account.role === 'admin') window.location.href = '/admin.html';
}).catch(() => {});

// Link de invitación: si entraron con un código de creador (por path
// /CODIGO, redirigido por el servidor a /?ref=CODIGO&forceRole=creator, o
// directamente con ?ref=), solo pueden registrarse como creador.
const __forceRoleCreator = new URLSearchParams(window.location.search).get('forceRole') === 'creator';
if (__forceRoleCreator) {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('button[onclick*="openRegister(\'viewer\')"]').forEach(btn => btn.style.display = 'none');
    openRegister('creator');
  });
}

function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function renderModal(html, extraClass) {
  document.getElementById('modalRoot').innerHTML =
    `<div class="modal-overlay" onclick="if(event.target===this) closeModal()"><div class="modal ${extraClass || ''}">${html}</div></div>`;
}

function passwordFieldHTML(id, label, required, minLen) {
  return `
    <div class="field">
      <label${required ? ' class="req"' : ''}>${label}</label>
      <div style="position:relative;">
        <input id="${id}" type="password" ${required ? 'required' : ''} ${minLen ? `minlength="${minLen}"` : ''} placeholder="••••••••" style="padding-right:44px;">
        <button type="button" onclick="togglePasswordVisibility('${id}', this)" style="position:absolute; right:6px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text-faint); font-size:12px; padding:6px 8px;">Ver</button>
      </div>
      ${minLen ? `<div class="mini-help">Mínimo ${minLen} caracteres.</div>` : ''}
    </div>`;
}
function togglePasswordVisibility(id, btn) {
  const input = document.getElementById(id);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? 'Ocultar' : 'Ver';
}

function openRegister(role) {
  if (role === 'creator') {
    renderModal(`
      <div class="modal-head"><h2>Registro — Creador</h2><button class="modal-close" onclick="closeModal()">×</button></div>
      ${__forceRoleCreator ? '<div class="notice" style="margin-bottom:16px;">Entraste con un link de invitación — esos links solo sirven para registrarte como creador.</div>' : ''}
      <form onsubmit="submitRegister(event,'creator')">
        <div class="field"><label class="req">Nombre visible</label><input id="rc_visible" required></div>
        <div class="field"><label class="req">Nombre completo</label><input id="rc_name" required></div>
        <div class="grid-2">
          <div class="field"><label>Teléfono (opcional — te lo vamos a pedir al comprar o retirar)</label><input id="rc_phone"></div>
          <div class="field"><label class="req">Gmail</label><input id="rc_email" type="email" required></div>
        </div>
        <div class="field"><label class="req">Usuario de YouTube</label><input id="rc_yt" required placeholder="@usuario"></div>
        ${passwordFieldHTML('rc_pass', 'Contraseña', true, 8)}
        <div class="mini-help" style="margin-bottom:14px;">Te vamos a mandar un código de verificación a este Gmail para activar tu cuenta.</div>
        ${termsCheckboxHTML('rc_terms')}
        <div class="modal-foot">
          <button class="btn btn-primary" type="submit">Crear cuenta de creador</button>
          ${__forceRoleCreator ? '' : `<div class="switch-note">¿Sos viewer? <button type="button" onclick="openRegister('viewer')">Registrarte como viewer</button></div>`}
        </div>
      </form>`);
  } else {
    renderModal(`
      <div class="modal-head"><h2>Registro — Viewer</h2><button class="modal-close" onclick="closeModal()">×</button></div>
      <form onsubmit="submitRegister(event,'viewer')">
        <div class="field"><label class="req">Nombre completo</label><input id="rv_name" required></div>
        <div class="field"><label class="req">Usuario visible</label><input id="rv_visible" required></div>
        <div class="field"><label class="req">Gmail</label><input id="rv_email" type="email" required></div>
        <div class="field"><label>Teléfono (opcional — te lo vamos a pedir al comprar o retirar)</label><input id="rv_phone"></div>
        ${passwordFieldHTML('rv_pass', 'Contraseña', true, 8)}
        <div class="mini-help" style="margin-bottom:14px;">Te vamos a mandar un código de verificación a este Gmail para activar tu cuenta.</div>
        ${termsCheckboxHTML('rv_terms')}
        <div class="modal-foot">
          <button class="btn btn-primary" type="submit">Crear cuenta de viewer</button>
          <div class="switch-note">¿Sos creador? <button type="button" onclick="openRegister('creator')">Registrarte como creador</button></div>
        </div>
      </form>`);
  }
}

function termsCheckboxHTML(id) {
  return `
    <div class="field" style="display:flex; align-items:flex-start; gap:8px;">
      <input type="checkbox" id="${id}" required style="width:auto; margin-top:3px;">
      <label for="${id}" style="font-size:12.5px; color:var(--text-dim); font-weight:400;">
        Acepto los <a href="/terminos.html" target="_blank" style="color:var(--gold); text-decoration:underline;">Términos y Condiciones</a>,
        la <a href="/privacidad.html" target="_blank" style="color:var(--gold); text-decoration:underline;">Política de Privacidad</a>
        y la <a href="/cookies.html" target="_blank" style="color:var(--gold); text-decoration:underline;">Política de Cookies</a> de ViewFlow.
      </label>
    </div>`;
}

function getRefFromUrl() {
  const p = new URLSearchParams(window.location.search);
  return p.get('ref') || null;
}
async function submitRegister(e, role) {
  e.preventDefault();
  const termsEl = document.getElementById(role === 'creator' ? 'rc_terms' : 'rv_terms');
  if (!termsEl.checked) { toast('Tenés que aceptar los Términos y la Política de Privacidad para registrarte.', true); return; }
  const payload = role === 'creator'
    ? { role, visibleUser: rc_visible.value.trim(), name: rc_name.value.trim(), phone: rc_phone.value.trim(), email: rc_email.value.trim(), ytUser: rc_yt.value.trim(), password: rc_pass.value, acceptedTerms: true, ref: getRefFromUrl(), forceRole: __forceRoleCreator ? 'creator' : undefined }
    : { role, name: rv_name.value.trim(), visibleUser: rv_visible.value.trim(), email: rv_email.value.trim(), phone: rv_phone.value.trim(), password: rv_pass.value, acceptedTerms: true, ref: getRefFromUrl(), forceRole: __forceRoleCreator ? 'creator' : undefined };
  try {
    await Api.post('/auth/register', payload);
    renderModal(`
      <div class="modal-head"><h2>Cuenta creada</h2><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="notice">Te vamos a mandar un código de verificación de un solo uso por Gmail (dura 10 minutos).<br>Usá el botón "Verificación" en la pantalla de inicio para activar tu cuenta con ese código.</div>
      <div class="modal-foot"><button class="btn btn-primary" onclick="openVerifyAccount('${payload.email}')">Ir a Verificación</button></div>`);
  } catch (err) { toast(err.message, true); }
}

function openLogin() {
  renderModal(`
    <div class="modal-head"><h2>Iniciar sesión</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <form onsubmit="submitLogin(event)">
      <div class="field"><label class="req">Gmail</label><input id="li_email" type="email" required></div>
      ${passwordFieldHTML('li_pass', 'Contraseña', true)}
      <div class="modal-foot">
        <button class="btn btn-primary" type="submit">Ingresar</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="openForgotPassword()">Olvidé mi contraseña</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="openVerifyAccount()">Verificación</button>
      </div>
    </form>`);
}

function openVerifyAccount(prefillEmail) {
  renderModal(`
    <div class="modal-head"><h2>Verificación de cuenta</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="mini-help" style="margin-bottom:16px;">Poné tu Gmail, tu contraseña, y el código de un solo uso que te mandamos para activar tu cuenta. El código dura 10 minutos.</div>
    <form onsubmit="submitVerifyAccount(event)">
      <div class="field"><label class="req">Gmail</label><input id="va_email" type="email" required value="${prefillEmail || ''}"></div>
      ${passwordFieldHTML('va_pass', 'Contraseña', true)}
      <div class="field"><label class="req">Código de verificación</label><input id="va_code" required maxlength="6" style="letter-spacing:.2em; text-align:center; font-family:'JetBrains Mono';"></div>
      <div class="modal-foot">
        <button class="btn btn-primary" type="submit">Verificar cuenta</button>
        <button class="btn btn-ghost btn-sm" type="button" id="va_resend_btn" onclick="resendVerifyCode()">Reenviar código</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="openLogin()">Volver a iniciar sesión</button>
      </div>
    </form>`);
}

let resendCooldownInterval = null;
async function resendVerifyCode() {
  const email = document.getElementById('va_email').value.trim();
  const password = document.getElementById('va_pass').value;
  if (!email || !password) { toast('Completá tu Gmail y contraseña primero.', true); return; }
  try {
    const r = await Api.post('/auth/verify-account/resend', { email, password });
    toast(r.message);
    startResendCooldown();
  } catch (err) { toast(err.message, true); }
}
function startResendCooldown() {
  const btn = document.getElementById('va_resend_btn');
  if (!btn) return;
  let secs = 60;
  btn.disabled = true;
  if (resendCooldownInterval) clearInterval(resendCooldownInterval);
  btn.textContent = `Reenviar código (${secs}s)`;
  resendCooldownInterval = setInterval(() => {
    secs--;
    if (!document.getElementById('va_resend_btn')) { clearInterval(resendCooldownInterval); return; }
    if (secs <= 0) { clearInterval(resendCooldownInterval); btn.disabled = false; btn.textContent = 'Reenviar código'; return; }
    btn.textContent = `Reenviar código (${secs}s)`;
  }, 1000);
}

async function submitVerifyAccount(e) {
  e.preventDefault();
  try {
    const { account } = await Api.post('/auth/verify-account', { email: va_email.value.trim(), password: va_pass.value, code: va_code.value.trim() });
    if (account) {
      if (account.role === 'creator') window.location.href = '/creator.html';
      else if (account.role === 'viewer') window.location.href = '/viewer.html';
      else window.location.href = '/admin.html';
      return;
    }
    renderModal(`
      <div class="modal-head"><h2>Cuenta verificada</h2><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="notice">Listo, tu cuenta ya está activa.</div>
      <div class="modal-foot"><button class="btn btn-primary" onclick="openLogin()">Iniciar sesión</button></div>`);
  } catch (err) { toast(err.message, true); }
}

async function submitLogin(e) {
  e.preventDefault();
  try {
    const { account } = await Api.post('/auth/login', { email: li_email.value.trim(), password: li_pass.value });
    if (account.role === 'creator') window.location.href = '/creator.html';
    else if (account.role === 'viewer') window.location.href = '/viewer.html';
    else window.location.href = '/admin.html';
  } catch (err) {
    if (err.data && err.data.error === 'pending') {
      renderModal(`
        <div class="modal-head"><h2>Cuenta sin verificar</h2><button class="modal-close" onclick="closeModal()">×</button></div>
        <div class="notice">Todavía no verificaste tu cuenta. Usá el código de un solo uso que te mandamos.</div>
        <div class="modal-foot"><button class="btn btn-primary" onclick="openVerifyAccount()">Ir a Verificación</button></div>`);
    } else toast(err.message, true);
  }
}

function openForgotPassword() {
  renderModal(`
    <div class="modal-head"><h2>Olvidé mi contraseña</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="field"><label class="req">Gmail de tu cuenta</label><input id="fp_email" type="email" required></div>
    <div class="modal-foot">
      <button class="btn btn-primary" onclick="startForgotPassword()">Continuar</button>
      <button class="btn btn-ghost" onclick="openLogin()">Volver</button>
    </div>`);
}

async function startForgotPassword() {
  const email = document.getElementById('fp_email').value.trim();
  if (!email) { toast('Ingresá tu Gmail.', true); return; }
  try {
    const { message } = await Api.post('/auth/forgot/request', { email });
    renderModal(`
      <div class="modal-head"><h2>Verificá tu identidad</h2><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="mini-help" style="margin-bottom:14px;">${message}</div>
      <div class="field"><label class="req">Código de verificación</label><input id="fp_code" placeholder="Ingresá el código recibido"></div>
      <div class="modal-foot">
        <button class="btn btn-primary" onclick="verifyForgotCode('${email}')">Verificar código</button>
        <button class="btn btn-ghost" onclick="openLogin()">Cancelar</button>
      </div>`);
  } catch (err) { toast(err.message, true); }
}

async function verifyForgotCode(email) {
  const code = document.getElementById('fp_code').value.trim();
  try {
    await Api.post('/auth/forgot/verify', { email, code });
    renderModal(`
      <div class="modal-head"><h2>Cambiá tu contraseña</h2><button class="modal-close" onclick="closeModal()">×</button></div>
      <form onsubmit="submitPasswordReset(event,'${email}','${code}')">
        ${passwordFieldHTML('fp_new_pass', 'Nueva contraseña', true, 8)}
        ${passwordFieldHTML('fp_new_pass2', 'Confirmar contraseña', true, 8)}
        <div class="modal-foot"><button class="btn btn-primary" type="submit">Guardar cambios</button></div>
      </form>`);
  } catch (err) { toast(err.message, true); }
}

async function submitPasswordReset(e, email, code) {
  e.preventDefault();
  const p1 = document.getElementById('fp_new_pass').value;
  const p2 = document.getElementById('fp_new_pass2').value;
  if (p1 !== p2) { toast('Las contraseñas no coinciden.', true); return; }
  try {
    const { message } = await Api.post('/auth/forgot/reset', { email, code, newPassword: p1 });
    toast(message);
    openLogin();
  } catch (err) { toast(err.message, true); }
}
