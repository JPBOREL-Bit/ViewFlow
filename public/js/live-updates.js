// public/js/live-updates.js
let lastSeenUpdate = 0;

async function initLiveUpdates() {
  try { const v = await Api.get('/version'); lastSeenUpdate = v.updatedAt; } catch (e) {}
  setInterval(checkForNewContent, 5000);
}

async function syncLastSeenUpdate() {
  try { const v = await Api.get('/version'); lastSeenUpdate = v.updatedAt; } catch (e) {}
}

async function checkForNewContent() {
  try {
    const v = await Api.get('/version');
    if (v.updatedAt > lastSeenUpdate) showNewContentBanner();
  } catch (e) {}
  if (typeof refreshSupportBadgeOnly === 'function') refreshSupportBadgeOnly();
}

function showNewContentBanner() {
  if (document.getElementById('newContentBanner')) return;
  const el = document.createElement('div');
  el.id = 'newContentBanner';
  el.className = 'new-content-banner';
  el.innerHTML = `<span>Contenido nuevo</span><button onclick="location.reload()">Reiniciar la página</button>`;
  document.body.appendChild(el);
}

initLiveUpdates();
