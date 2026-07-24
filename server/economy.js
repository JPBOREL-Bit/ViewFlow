// server/economy.js
// Economía cerrada de ViewFlow: todos los créditos que circulan salen de
// compras de creadores, del impuesto sobre esas compras, de donaciones, o
// de recompensas puntuales (referidos, pool). Nada se crea "de la nada"
// fuera de este archivo.

const FREE_CAMPAIGN = {
  fundTotal: 2500,
  maxCampaigns: 150,
  durationDays: 30,
  creditsPerCampaign: 16,
  views: 10,
  seconds: 30
};

// Reparto del impuesto de compra (15% total):
// - Caso normal: 5% para ViewFlow, 10% para el Pool comunitario.
// - Cuando el creador fue referido por otro usuario: 5% ViewFlow, 5% Pool, 5% para quien lo invitó.
const TAX_SPLIT_NORMAL = { platformPct: 5, poolPct: 10 };
const TAX_SPLIT_REFERRED = { platformPct: 5, poolPct: 5, referrerPct: 5 };

const REFERRED_CREATOR_DISCOUNT_PCT = 10; // primeras 5 compras
const REFERRED_CREATOR_DISCOUNT_PURCHASES = 5;

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
// email, teléfono, IPs conocidas y dispositivo/navegador de las sesiones
// contra todos los reclamos/registros anteriores.
function findFraudMatch(db, acc, ip, device, claimsList) {
  const accSessions = db.sessions.filter(s => s.accountId === acc.id);
  const knownIps = new Set([ip, ...accSessions.map(s => s.ip)].filter(Boolean));
  const knownDevices = new Set([device, ...accSessions.map(s => s.device)].filter(Boolean));

  for (const claim of claimsList) {
    if (claim.email === acc.email) return 'email';
    if (acc.phone && claim.phone && claim.phone === acc.phone) return 'teléfono';
    if (claim.ip && knownIps.has(claim.ip)) return 'IP';
    if (claim.device && knownDevices.has(claim.device)) return 'dispositivo/navegador';
  }
  return null;
}

// ¿Esta cuenta tiene descuento de creador referido vigente? (primeras 5 compras)
function referredDiscountActive(acc) {
  if (!acc.referredBy) return false;
  const used = acc.referredDiscountPurchasesUsed || 0;
  return used < REFERRED_CREATOR_DISCOUNT_PURCHASES;
}

// Se llama al aprobar una compra: reparte el impuesto según haya o no
// referente, y acredita al referente en el momento si corresponde.
function splitPurchaseTax(db, taxCredits, creatorAcc, referrerAcc, creditAccount) {
  ensureEconomyState(db);
  const hasReferrer = !!(creatorAcc.referredBy && referrerAcc);
  const split = hasReferrer ? TAX_SPLIT_REFERRED : TAX_SPLIT_NORMAL;
  const totalPct = TAX_SPLIT_NORMAL.platformPct + TAX_SPLIT_NORMAL.poolPct; // 15, para expresar cada parte como % del impuesto total
  const platformCredits = Math.round(taxCredits * (split.platformPct / totalPct) * 100) / 100;
  const poolCredits = Math.round(taxCredits * (split.poolPct / totalPct) * 100) / 100;
  const referrerCredits = hasReferrer ? Math.round((taxCredits - platformCredits - poolCredits) * 100) / 100 : 0;
  db.pool.balance += poolCredits;
  if (hasReferrer && referrerCredits > 0) {
    creditAccount(referrerAcc, referrerCredits, `Comisión por referido: ${creatorAcc.visibleUser} compró créditos`);
  }
  return { platformCredits, poolCredits, referrerCredits, hasReferrer };
}

// Elegibilidad para el pool semanal: cuenta activa + al menos 2 campañas
// completas en los últimos 3 días.
function recentCompletions(db, viewerId) {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return db.participations.filter(p => p.viewerId === viewerId && p.status === 'completed' && p.startedAt >= threeDaysAgo).length;
}
function isPoolEligible(db, viewerId) {
  const acc = db.accounts.find(a => a.id === viewerId);
  if (!acc || acc.status !== 'approved') return false;
  return recentCompletions(db, viewerId) >= 2;
}

// Reparte el saldo actual del pool entre los viewers elegibles, PROPORCIONAL
// a cuántas campañas vio cada uno en los últimos 3 días (más campañas =
// mayor porción del pool). Si nadie es elegible, el saldo se acumula.
function distributePool(db, addLog, creditAccount) {
  ensureEconomyState(db);
  const balance = Math.floor(db.pool.balance * 100) / 100;
  if (balance <= 0) {
    db.pool.weekStart = startOfWeek(Date.now());
    return { distributed: 0, eligibleCount: 0 };
  }
  const viewers = db.accounts.filter(a => a.role === 'viewer');
  const eligible = viewers
    .map(v => ({ acc: v, views: recentCompletions(db, v.id) }))
    .filter(v => v.views >= 2);

  if (eligible.length === 0) {
    db.pool.history.unshift({ ts: Date.now(), distributed: 0, eligibleCount: 0, note: 'Sin viewers elegibles — el saldo queda acumulado.' });
    db.pool.weekStart = startOfWeek(Date.now());
    return { distributed: 0, eligibleCount: 0 };
  }

  const totalViews = eligible.reduce((s, v) => s + v.views, 0);
  let distributed = 0;
  eligible.forEach(v => {
    const share = Math.round((balance * (v.views / totalViews)) * 100) / 100;
    if (share > 0) {
      creditAccount(v.acc, share, `Reparto semanal del Pool (${v.views} campañas vistas)`);
      distributed += share;
    }
  });
  distributed = Math.round(distributed * 100) / 100;
  db.pool.balance = Math.round((db.pool.balance - distributed) * 100) / 100;
  db.pool.history.unshift({ ts: Date.now(), distributed, eligibleCount: eligible.length });
  db.pool.weekStart = startOfWeek(Date.now());
  addLog(db, { type: 'system', message: `Reparto semanal del Pool: ${distributed} créditos entre ${eligible.length} viewers elegibles, proporcional a campañas vistas`, accountName: null });
  return { distributed, eligibleCount: eligible.length };
}

module.exports = {
  FREE_CAMPAIGN, TAX_SPLIT_NORMAL, TAX_SPLIT_REFERRED,
  REFERRED_CREATOR_DISCOUNT_PCT, REFERRED_CREATOR_DISCOUNT_PURCHASES,
  ensureEconomyState, startOfWeek, freeCampaignActive, findFraudMatch,
  referredDiscountActive, splitPurchaseTax, isPoolEligible, distributePool
};
