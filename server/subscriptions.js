// server/subscriptions.js
// Configuración central de los planes de suscripción para viewers.
// Todo lo que cambia un plan (impuesto de retiro, reducción de tiempo,
// prioridad, badge) sale de acá — un solo lugar para no desincronizar.

const PLANS = {
  free:  { key: 'free',  label: 'Free',  priceUsd: 0,    timeReductionPct: 0,  withdrawTaxPct: 15, priority: 0, badge: null },
  plus:  { key: 'plus',  label: 'Plus',  priceUsd: 1.99, timeReductionPct: 10, withdrawTaxPct: 10, priority: 1, badge: 'Plus' },
  pro:   { key: 'pro',   label: 'Pro',   priceUsd: 4.99, timeReductionPct: 25, withdrawTaxPct: 5,  priority: 2, badge: 'Pro' },
  elite: { key: 'elite', label: 'Elite', priceUsd: 9.99, timeReductionPct: 50, withdrawTaxPct: 0,  priority: 3, badge: 'Elite' }
};
const PLAN_ORDER = ['free', 'plus', 'pro', 'elite'];
const ANNUAL_DISCOUNT_PCT = 10; // pagando el año completo de una, se ahorra un 10%

function annualPriceUsd(planKey) {
  const monthly = getPlan(planKey).priceUsd;
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100) * 100) / 100;
}

function getPlan(key) {
  return PLANS[key] || PLANS.free;
}

// Aplica la reducción de tiempo del plan a una cantidad de segundos pedida
// por una campaña. Nunca baja de 5 segundos (para que siga siendo una
// participación real, no instantánea).
function reduceSecondsByPlan(seconds, planKey) {
  const plan = getPlan(planKey);
  const reduced = Math.round(seconds * (1 - plan.timeReductionPct / 100));
  return Math.max(5, reduced);
}

function withdrawTaxForPlan(planKey) {
  return getPlan(planKey).withdrawTaxPct;
}

module.exports = { PLANS, PLAN_ORDER, ANNUAL_DISCOUNT_PCT, getPlan, reduceSecondsByPlan, withdrawTaxForPlan, annualPriceUsd };
