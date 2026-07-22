// server/pricing.js
// Toda la matemática de precios vive acá, del lado del servidor. El
// frontend puede mostrar previsualizaciones, pero el monto que realmente se
// cobra o se acredita siempre se recalcula acá antes de tocar la base.

const CREDIT_WINDOW_SECONDS = 30;
const CREDITS_PER_WINDOW = 1.6; // 1.6 créditos cada 30s vistos

function floor1(n) { return Math.floor(n * 10) / 10; } // trunca a 1 decimal (viewers)

function viewerRewardFor(seconds) {
  return floor1((seconds / CREDIT_WINDOW_SECONDS) * CREDITS_PER_WINDOW);
}

function campaignCost(seconds, views) {
  const perView = viewerRewardFor(seconds);
  const viewerPool = floor1(perView * views);
  const total = Math.max(1, Math.round(viewerPool)); // el creador siempre paga un entero
  return { perView, viewerPool, total };
}

function creditsToUsd(credits, settings) { return credits * settings.creditToUsd; }
function creditsToArs(credits, settings) { return credits * settings.creditToUsd * settings.usdRate; }

function purchaseQuote(credits, settings) {
  const baseUsd = creditsToUsd(credits, settings);
  const totalUsd = baseUsd * (1 + settings.purchaseTaxPct / 100);
  const taxCredits = Math.round(credits * settings.purchaseTaxPct / 100);
  const rate = settings.usdRateVenta || settings.usdRate;
  return {
    credits,
    usd: Number(totalUsd.toFixed(2)),
    ars: Math.round(totalUsd * rate),
    taxCredits
  };
}

function withdrawQuote(credits, settings) {
  const netCredits = credits * (1 - settings.withdrawTaxPct / 100);
  const rate = settings.usdRateCompra || settings.usdRate;
  return {
    credits,
    netCredits: Math.round(netCredits * 100) / 100,
    usd: Number((netCredits * settings.creditToUsd).toFixed(2)),
    ars: Math.round(netCredits * settings.creditToUsd * rate),
    taxCredits: Math.round((credits - netCredits) * 100) / 100
  };
}

module.exports = { viewerRewardFor, campaignCost, purchaseQuote, withdrawQuote, creditsToUsd, creditsToArs, floor1 };
