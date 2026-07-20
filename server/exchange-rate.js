// server/exchange-rate.js
// Actualiza la cotización del dólar automáticamente desde una API pública
// (dolarapi.com, gratuita y sin necesidad de clave). Consultarla cada 5
// segundos sin parar puede hacer que la API te bloquee la IP por exceso de
// pedidos, así que el valor por defecto es cada 5 MINUTOS — sigue siendo
// 100% automático, vos no tenés que tocar nada, solo se actualiza con menos
// frecuencia para no arriesgar que se corte el servicio. Si en algún momento
// necesitás más frecuencia, se puede ajustar con la variable de entorno
// USD_RATE_INTERVAL_MS sin tocar código.

const { getDB, saveDB } = require('./db');

const INTERVAL_MS = Number(process.env.USD_RATE_INTERVAL_MS) || 5 * 60 * 1000;

async function fetchUsdRate() {
  const db = getDB();
  if (!db.settings.autoUsdRateEnabled) return;
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/oficial');
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data.venta === 'number' && data.venta > 0) {
      db.settings.usdRateVenta = data.venta; // se usa en la Tienda (compra de créditos)
      db.settings.usdRateCompra = data.compra || data.venta; // se usa en Retiros
      db.settings.usdRate = data.venta; // valor de referencia general (compatibilidad)
      db.settings.usdRateUpdatedAt = Date.now();
      saveDB(db);
    }
  } catch (err) {
    // Sin conexión o la API está caída/limitando pedidos: seguimos con la
    // última cotización conocida, no rompemos nada.
  }
}

function startExchangeRateJob() {
  fetchUsdRate();
  setInterval(fetchUsdRate, INTERVAL_MS);
}

module.exports = { startExchangeRateJob, fetchUsdRate };
