// public/js/live-updates.js
// Sin cartel de "nueva actividad": la pantalla que el usuario tiene abierta
// se actualiza sola cada 0.5s, en silencio, sin recargar ni interrumpir
// formularios abiertos. Al cambiar de panel, ese panel ya pide datos frescos
// apenas se abre (así se siente instantáneo al navegar).
async function initLiveUpdates() {
  setInterval(() => {
    const modalOpen = document.getElementById('modalRoot') && document.getElementById('modalRoot').children.length > 0;
    if (!modalOpen && typeof window.__vfSilentRefresh === 'function') window.__vfSilentRefresh();
    if (typeof refreshSupportBadgeOnly === 'function') refreshSupportBadgeOnly();
  }, 500);
}
initLiveUpdates();
