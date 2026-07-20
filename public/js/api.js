// public/js/api.js
// Todas las páginas usan esto para hablar con el backend. Nunca hay
// contraseñas, tokens ni secretos acá — solo llamadas fetch con la cookie
// de sesión (httpOnly, la pone y la lee el servidor).

const API_BASE = '/api';

async function api(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* respuesta vacía */ }
  if (res.status === 503 && data.error === 'maintenance') {
    showMaintenanceOverlay(data.message);
    throw new Error(data.message || 'En mantenimiento.');
  }
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Error de red');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const Api = {
  get: (p) => api('GET', p),
  post: (p, b) => api('POST', p, b),
  put: (p, b) => api('PUT', p, b),
  del: (p, b) => api('DELETE', p, b)
};

function toast(msg, isErr) {
  let wrap = document.getElementById('toastWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toastWrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
}

function fmtArs(n) { return Number(n).toLocaleString('es-AR'); }

function showMaintenanceOverlay(message) {
  if (document.getElementById('maintenanceOverlay')) return;
  const el = document.createElement('div');
  el.id = 'maintenanceOverlay';
  el.style.cssText = 'position:fixed; inset:0; z-index:9999; background:var(--bg); display:flex; align-items:center; justify-content:center; padding:24px; text-align:center;';
  el.innerHTML = `
    <form id="maintAdminForm" style="max-width:340px; width:100%; text-align:left;" onsubmit="submitMaintenanceLogin(event)">
      <div class="field"><label>Gmail</label><input id="maint_email" type="email" required></div>
      <div class="field" style="margin-bottom:14px;"><label>Contraseña</label><input id="maint_pass" type="password" required></div>
      <button class="btn btn-primary" type="submit" style="width:100%;">Iniciar sesión</button>
      <div id="maintLoginError" style="color:var(--red); font-size:12.5px; margin-top:8px; text-align:center;"></div>
    </form>`;
  document.body.appendChild(el);
}

async function submitMaintenanceLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('maintLoginError');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ email: document.getElementById('maint_email').value.trim(), password: document.getElementById('maint_pass').value })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.message || data.error || 'No se pudo iniciar sesión.'; return; }
    if (data.account.role !== 'admin') { errEl.textContent = 'Esa cuenta no es de administrador — el sitio sigue en mantenimiento.'; return; }
    window.location.href = '/admin.html';
  } catch (err) { errEl.textContent = 'Error de red, probá de nuevo.'; }
}

async function renderDevices(main) {
  const { sessions, max } = await Api.get('/devices');
  main.innerHTML = `
    <div class="page-head"><div><h1>Dispositivos</h1><div class="ps">Hasta ${max} dispositivos conectados a la vez. Los que no marqués como "de confianza" cierran sesión solos al cerrar todas las pestañas.</div></div></div>
    <div id="devicesList"></div>`;
  renderDeviceCards(sessions);
}

function renderDeviceCards(sessions) {
  const wrap = document.getElementById('devicesList');
  if (!wrap) return;
  if (sessions.length === 0) { wrap.innerHTML = '<div class="empty-state">No hay dispositivos conectados.</div>'; return; }
  wrap.innerHTML = sessions.map(s => `
    <div class="section-card" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
      <div>
        <div style="font-weight:700; display:flex; align-items:center; gap:8px;">
          ${s.device}
          ${s.isCurrent ? '<span class="badge badge-active">Este dispositivo</span>' : ''}
          ${s.trusted ? '<span class="badge badge-approved">De confianza</span>' : ''}
        </div>
        <div class="mini-help" style="margin-top:4px;">
          ${s.location ? s.location : (s.isCurrent ? `<button type="button" onclick="requestDeviceLocation('${s.id}')" style="background:none; border:none; color:var(--gold); text-decoration:underline; font-size:inherit; cursor:pointer; padding:0;">Compartir ubicación</button>` : 'Ubicación aproximada no disponible')}
        </div>
        <div class="mini-help">Último acceso: ${new Date(s.lastActiveAt).toLocaleString()}</div>
      </div>
      <div style="display:flex; gap:8px;">
        ${!s.trusted ? `<button class="btn btn-ghost btn-sm" onclick="trustDevice('${s.id}')">Confiar en este dispositivo</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="revokeDevice('${s.id}', ${s.isCurrent})">Cerrar sesión</button>
      </div>
    </div>`).join('');
}

function requestDeviceLocation(sessionId) {
  if (!navigator.geolocation) { toast('Tu navegador no admite ubicación.', true); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const { latitude, longitude } = pos.coords;
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=es`);
      const geo = await res.json();
      const label = [geo.locality || geo.city, geo.principalSubdivision, geo.countryName].filter(Boolean).join(', ') || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
      await Api.post('/devices/location', { label });
      toast('Ubicación guardada.');
      renderPage();
    } catch (e) { toast('No se pudo resolver la ubicación.', true); }
  }, () => { toast('No diste permiso de ubicación.', true); });
}

async function trustDevice(sessionId) {
  const password = prompt('Ingresá tu contraseña para confiar en este dispositivo:');
  if (!password) return;
  try {
    const r = await Api.post(`/devices/${sessionId}/trust`, { password });
    toast(r.needsRelogin ? 'Confirmado. Ese dispositivo va a mantener la sesión la próxima vez que inicie sesión.' : 'Este dispositivo ahora mantiene la sesión iniciada por 30 días.');
    renderPage();
  } catch (err) { toast(err.message, true); }
}

async function revokeDevice(sessionId, isCurrent) {
  const password = prompt('Ingresá tu contraseña para cerrar sesión en ese dispositivo:');
  if (!password) return;
  try {
    await Api.post(`/devices/${sessionId}/revoke`, { password });
    if (isCurrent) { toast('Sesión cerrada.'); window.location.href = '/'; return; }
    toast('Sesión cerrada en ese dispositivo.');
    renderPage();
  } catch (err) { toast(err.message, true); }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

async function requireSession(expectedRole) {
  try {
    const { account } = await Api.get('/auth/me');
    if (expectedRole && account.role !== expectedRole) {
      window.location.href = '/';
      return null;
    }
    applyTheme(account.theme);
    return account;
  } catch (e) {
    window.location.href = '/';
    return null;
  }
}
