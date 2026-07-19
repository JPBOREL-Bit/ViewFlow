// public/js/live-updates.js
// La app se actualiza sola en segundo plano todo el tiempo (silenciosa,
// imperceptible). Además, cuando el servidor detecta que hubo un cambio real
// (alguien más hizo algo), aparece un cartel chiquito "Nueva actividad" que
// dispara la actualización en el momento y se esconde solo apenas termina.

let lastSeenUpdate = 0;

async function initLiveUpdates() {
  try { const v = await Api.get('/version'); lastSeenUpdate = v.updatedAt; } catch (e) {}
  setInterval(backgroundTick, 4000);
}

async function backgroundTick() {
  // Refresco silencioso de fondo, siempre, sin cartel — imperceptible.
  const modalOpen = document.getElementById('modalRoot') && document.getElementById('modalRoot').children.length > 0;
  if (!modalOpen && typeof window.__vfSilentRefresh === 'function') window.__vfSilentRefresh();
  if (typeof refreshSupportBadgeOnly === 'function') refreshSupportBadgeOnly();

  // Además, chequeamos si hubo un cambio real del lado del servidor (por
  // ejemplo otra persona hizo algo) para mostrar el cartel de aviso.
  try {
    const v = await Api.get('/version');
    if (v.updatedAt > lastSeenUpdate + 500) {
      lastSeenUpdate = v.updatedAt;
      showNewActivityBanner();
    }
  } catch (e) {}
}

function showNewActivityBanner() {
  if (document.getElementById('newContentBanner')) return;
  const el = document.createElement('div');
  el.id = 'newContentBanner';
  el.className = 'new-content-banner';
  el.innerHTML = `<span>Nueva actividad</span><button id="newContentBtn">Actualizar</button>`;
  document.body.appendChild(el);
  document.getElementById('newContentBtn').onclick = async () => {
    if (typeof window.__vfSilentRefresh === 'function') window.__vfSilentRefresh();
    el.remove();
  };
  // Se esconde solo a los pocos segundos, ya haya sido tocado o no —
  // el refresco de fondo ya se encarga de traer los datos igual.
  setTimeout(() => { if (document.getElementById('newContentBanner')) el.remove(); }, 6000);
}

initLiveUpdates();
