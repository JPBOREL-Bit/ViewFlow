// server/economy.js
// Economía cerrada de ViewFlow: todos los créditos que circulan salen de
// compras de creadores, del impuesto sobre esas compras, o de donaciones
// entre usuarios. Nada se crea "de la nada" fuera de este archivo.

const FREE_CAMPAIGN = {
  fundTotal: 2500,
  maxCampaigns: 150,
  durationDays: 30,
  creditsPerCampaign: 16,
  views: 10,
  seconds: 30
};

const TAX_SPLIT_PCT = { platform: 33.33, pool: 33.33, rewardsFund: 33.34 }; // suma 100% del impuesto de compra

// Recompensas por hitos de campañas completadas (viewer). Montos definidos
// por Claude ya que el pedido no especificó valores exactos — son
// ajustables desde Configuración sin tocar código.
const DEFAULT_MILESTONES = { 25: 10, 50: 20, 100: 40, 250: 100, 500: 200, 1000: 500 };

function ensureEconomyState(db) {
  if (!db.settings.freeCampaignProgram) {
    db.settings.freeCampaignProgram = {
      enabled: true,
      startedAt: Date.now(),
      fundTotal: FREE_CAMPAIGN.fundTotal,
      fundUsed: 0,
      maxCampaigns: FREE_CAMPAIGN.maxCampaigns,
      usedCampaigns: 0,
      durationDays: FREE_CAMPAIGN.durationDays
    };
  }
  if (!db.settings.rewardMilestones) db.settings.rewardMilestones = { ...DEFAULT_MILESTONES };
  if (!db.rewardsFund) db.rewardsFund = { balance: 0 };
  if (!db.pool) db.pool = { balance: 0, weekStart: startOfWeek(Date.now()), history: [] };
  if (!Array.isArray(db.freeCampaignClaims)) db.freeCampaignClaims = [];
}

function startOfWeek(ts) {
  const d = new Date(ts);
  const day = d.getDay(); // 0=domingo
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function freeCampaignActive(db) {
  ensureEconomyState(db);
  const p = db.settings.freeCampaignProgram;
  const withinWindow = Date.now() - p.startedAt < p.durationDays * 24 * 60 * 60 * 1000;
  return p.enabled && withinWindow && p.usedCampaigns < p.maxCampaigns && p.fundUsed + FREE_CAMPAIGN.creditsPerCampaign <= p.fundTotal;
}

// Huella de fraude: no confiamos solo en la IP (se evade fácil). Cruzamos
// email, teléfono, IPs conocidas y user-agents de las sesiones del creador
// contra todos los reclamos anteriores del beneficio.
function findFraudMatch(db, acc, ip, userAgent) {
  const accSessions = db.sessions.filter(s => s.accountId === acc.id);
  const knownIps = new Set([ip, ...accSessions.map(s => s.ip)].filter(Boolean));
  const knownDevices = new Set([userAgent, ...accSessions.map(s => s.device)].filter(Boolean));

  for (const claim of db.freeCampaignClaims) {
    if (claim.email === acc.email) return 'email';
    if (acc.phone && claim.phone && claim.phone === acc.phone) return 'teléfono';
    if (claim.ip && knownIps.has(claim.ip)) return 'IP';
    if (claim.device && knownDevices.has(claim.device)) return 'dispositivo/navegador';
  }
  return null;
}

// Se llama cuando se aprueba una compra: reparte el impuesto en 3 partes.
function splitPurchaseTax(db, taxCredits) {
  ensureEconomyState(db);
  const platformCredits = Math.round(taxCredits * TAX_SPLIT_PCT.platform / 100);
  const poolCredits = Math.round(taxCredits * TAX_SPLIT_PCT.pool / 100);
  const rewardsCredits = taxCredits - platformCredits - poolCredits; // resto exacto, sin perder centavos por redondeo
  db.pool.balance += poolCredits;
  db.rewardsFund.balance += rewardsCredits;
  return { platformCredits, poolCredits, rewardsCredits };
}

// Elegibilidad para el pool semanal: cuenta activa + al menos 2 campañas
// completas en los últimos 3 días.
function isPoolEligible(db, viewerId) {
  const acc = db.accounts.find(a => a.id === viewerId);
  if (!acc || acc.status !== 'approved') return false;
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const recentCompletions = db.participations.filter(p => p.viewerId === viewerId && p.status === 'completed' && p.startedAt >= threeDaysAgo).length;
  return recentCompletions >= 2;
}

// Reparte el saldo actual del pool entre los viewers elegibles, en partes
// iguales. Si nadie es elegible, el saldo queda acumulado para la próxima
// semana (no se pierde ni se reparte igual entre no elegibles).
function distributePool(db, addLog, creditAccount) {
  ensureEconomyState(db);
  const balance = Math.floor(db.pool.balance);
  if (balance <= 0) {
    db.pool.weekStart = startOfWeek(Date.now());
    return { distributed: 0, perPerson: 0, eligibleCount: 0 };
  }
  const viewers = db.accounts.filter(a => a.role === 'viewer');
  const eligible = viewers.filter(v => isPoolEligible(db, v.id));
  if (eligible.length === 0) {
    db.pool.history.unshift({ ts: Date.now(), distributed: 0, eligibleCount: 0, note: 'Sin viewers elegibles — el saldo queda acumulado.' });
    db.pool.weekStart = startOfWeek(Date.now());
    return { distributed: 0, perPerson: 0, eligibleCount: 0 };
  }
  const perPerson = Math.floor((balance / eligible.length) * 100) / 100;
  eligible.forEach(v => creditAccount(v, perPerson, 'Reparto semanal del Pool'));
  const distributed = Math.round(perPerson * eligible.length * 100) / 100;
  db.pool.balance = Math.round((db.pool.balance - distributed) * 100) / 100;
  db.pool.history.unshift({ ts: Date.now(), distributed, eligibleCount: eligible.length, perPerson });
  db.pool.weekStart = startOfWeek(Date.now());
  addLog(db, { type: 'system', message: `Reparto semanal del Pool: ${distributed} créditos entre ${eligible.length} viewers elegibles (${perPerson} c/u)`, accountName: null });
  return { distributed, perPerson, eligibleCount: eligible.length };
}

module.exports = {
  FREE_CAMPAIGN, TAX_SPLIT_PCT, DEFAULT_MILESTONES,
  ensureEconomyState, startOfWeek, freeCampaignActive, findFraudMatch, splitPurchaseTax, isPoolEligible, distributePool
};
