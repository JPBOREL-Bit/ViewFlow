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
  if (!res.ok) {
    const err = new Error(data.error || 'Error de red');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  // Si esta llamada modificó datos, esta pestaña ya "sabe" del cambio —
  // así el aviso de "Contenido nuevo" nunca se dispara por tus propias acciones.
  if (method !== 'GET' && typeof lastSeenUpdate !== 'undefined') {
    setTimeout(() => { if (typeof syncLastSeenUpdate === 'function') syncLastSeenUpdate(); }, 300);
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

async function requireSession(expectedRole) {
  try {
    const { account } = await Api.get('/auth/me');
    if (expectedRole && account.role !== expectedRole) {
      window.location.href = '/';
      return null;
    }
    return account;
  } catch (e) {
    window.location.href = '/';
    return null;
  }
}
