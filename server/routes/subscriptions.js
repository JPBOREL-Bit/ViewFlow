// server/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB, addLog } = require('../db');
const { requireAuth } = require('../auth');
const { uid } = require('../util');
const { PLANS, PLAN_ORDER, getPlan, annualPriceUsd, ANNUAL_DISCOUNT_PCT } = require('../subscriptions');

const ONE_HOUR = 60 * 60 * 1000;
const BANK_COMPANIES = ['BNA', 'Brubank', 'Naranja X', 'Mercado Pago', 'Ualá'];

function purgeExpired(db) {
  const now = Date.now();
  db.subscriptionPurchases.forEach(p => {
    if (p.status === 'pending' && p.expiresAt < now) p.status = 'expired';
  });
}

function planToPublic(planKey, usdRate) {
  const p = getPlan(planKey);
  return {
    ...p,
    priceArs: Math.round(p.priceUsd * usdRate),
    annualUsd: annualPriceUsd(planKey),
    annualArs: Math.round(annualPriceUsd(planKey) * usdRate)
  };
}

// ---- Lista de planes (para las tarjetas de comparación) ----
router.get('/plans', requireAuth(), (req, res) => {
  const db = getDB();
  const rate = db.settings.usdRateVenta || db.settings.usdRate;
  res.json({ plans: PLAN_ORDER.map(k => planToPublic(k, rate)), banks: BANK_COMPANIES, annualDiscountPct: ANNUAL_DISCOUNT_PCT });
});

// ---- Mi suscripción actual (viewer) ----
router.get('/mine', requireAuth('viewer'), (req, res) => {
  const db = getDB();
  purgeExpired(db);
  const acc = db.accounts.find(a => a.id === req.account.id);
  const pending = db.subscriptionPurchases.find(p => p.viewerId === acc.id && p.status === 'pending');
  res.json({
    plan: acc.subPlan || 'free',
    status: acc.subStatus || 'active',
    billingCycle: acc.subBillingCycle || null,
    startedAt: acc.subStartedAt || null,
    renewsAt: acc.subRenewsAt || null,
    planDetail: getPlan(acc.subPlan || 'free'),
    pendingPurchase: pending || null
  });
});

// ---- Pedir upgrade de plan (pago manual, igual que la Tienda) ----
router.post('/subscribe', requireAuth('viewer'), (req, res) => {
  const { plan, bankCompany, holderName, billingCycle, acceptedSubTerms } = req.body || {};
  const db = getDB();
  purgeExpired(db);
  if (!PLAN_ORDER.includes(plan) || plan === 'free') return res.status(400).json({ error: 'Plan inválido.' });
  if (!['monthly', 'annual'].includes(billingCycle)) return res.status(400).json({ error: 'Elegí si pagás mensual o anual.' });
  if (!BANK_COMPANIES.includes(bankCompany)) return res.status(400).json({ error: 'Elegí con qué compañía vas a transferir.' });
  if (!holderName || !String(holderName).trim()) return res.status(400).json({ error: 'Falta el nombre del titular que va a pagar.' });
  if (!acceptedSubTerms) return res.status(400).json({ error: 'Tenés que aceptar los términos de la suscripción para continuar.' });

  const acc = db.accounts.find(a => a.id === req.account.id);
  const already = db.subscriptionPurchases.find(p => p.viewerId === acc.id && p.status === 'pending');
  if (already) return res.status(400).json({ error: 'Ya tenés una solicitud de suscripción pendiente de aprobación.' });

  const rate = db.settings.usdRateVenta || db.settings.usdRate;
  const planDetail = getPlan(plan);
  const priceUsd = billingCycle === 'annual' ? annualPriceUsd(plan) : planDetail.priceUsd;
  const purchase = {
    id: uid('sub'), viewerId: acc.id, plan, billingCycle,
    priceUsd, priceArs: Math.round(priceUsd * rate),
    holderName: String(holderName).trim(), bankCompany,
    alias: db.settings.paymentAlias, contactEmail: db.settings.paymentContactEmail,
    status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + ONE_HOUR
  };
  db.subscriptionPurchases.push(purchase);
  acc.subStatus = 'pending_payment';
  addLog(db, { type: 'subscription', message: `${acc.visibleUser} pidió pasar al plan ${planDetail.label} (${billingCycle === 'annual' ? 'anual' : 'mensual'}, pendiente de pago)`, accountName: acc.visibleUser });
  saveDB(db);
  res.json({ ok: true, purchase, note: `Mandá el comprobante por Gmail a ${db.settings.paymentContactEmail} — desde el mismo Gmail de tu cuenta.` });
});

// ---- Cancelar suscripción (siempre permitido, vuelve a Free de inmediato) ----
router.post('/cancel', requireAuth('viewer'), (req, res) => {
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  if ((acc.subPlan || 'free') === 'free') return res.status(400).json({ error: 'Ya estás en el plan Free.' });
  const prevPlan = getPlan(acc.subPlan).label;
  acc.subPlan = 'free';
  acc.subStatus = 'cancelled';
  acc.subRenewsAt = null;
  db.subscriptionPurchases = db.subscriptionPurchases.filter(p => !(p.viewerId === acc.id && p.status === 'pending'));
  addLog(db, { type: 'subscription', message: `${acc.visibleUser} canceló su suscripción ${prevPlan} — vuelve a Free`, accountName: acc.visibleUser });
  saveDB(db);
  res.json({ ok: true });
});

module.exports = { router, BANK_COMPANIES, planToPublic };
