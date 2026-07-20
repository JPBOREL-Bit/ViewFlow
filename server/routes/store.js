// server/routes/store.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB, addLog } = require('../db');
const { requireAuth } = require('../auth');
const { uid } = require('../util');
const { purchaseQuote } = require('../pricing');

const ONE_HOUR = 60 * 60 * 1000;
const PAYMENT_METHODS = ['Transferencia bancaria', 'Tarjeta de débito'];

// Purga solicitudes vencidas (más de 1h sin aprobar). Se llama en cada
// operación relevante para que "se borre sola" sin necesitar un cron aparte.
function purgeExpired(db) {
  const now = Date.now();
  const before = db.purchases.length;
  db.purchases = db.purchases.filter(p => !(p.status === 'pending' && p.expiresAt < now));
  return db.purchases.length !== before;
}

router.get('/packages', requireAuth(), (req, res) => {
  const db = getDB();
  const packages = [100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000]
    .map(c => purchaseQuote(c, db.settings));
  res.json({
    packages,
    methods: PAYMENT_METHODS,
    settings: {
      minPurchase: 100,
      paymentAlias: db.settings.paymentAlias,
      paymentContactEmail: db.settings.paymentContactEmail,
      usdRate: db.settings.usdRateVenta || db.settings.usdRate,
      usdRateUpdatedAt: db.settings.usdRateUpdatedAt
    }
  });
});

router.get('/quote', requireAuth(), (req, res) => {
  const db = getDB();
  const credits = Math.max(100, parseInt(req.query.credits, 10) || 100);
  res.json(purchaseQuote(credits, db.settings));
});

router.post('/purchases', requireAuth('creator'), (req, res) => {
  const { credits, method, holderName } = req.body || {};
  const db = getDB();
  purgeExpired(db);
  const c = Number(credits);
  if (!Number.isInteger(c) || c < 100) return res.status(400).json({ error: 'El mínimo de compra es 100 créditos.' });
  if (!holderName) return res.status(400).json({ error: 'Falta el nombre del titular que va a pagar.' });
  const chosenMethod = PAYMENT_METHODS.includes(method) ? method : PAYMENT_METHODS[0];

  const quote = purchaseQuote(c, db.settings);
  const purchase = {
    id: uid('pur'), creatorId: req.account.id, credits: c,
    usd: quote.usd, ars: quote.ars, taxCredits: quote.taxCredits,
    method: chosenMethod, holderName: String(holderName).trim(),
    alias: db.settings.paymentAlias, contactEmail: db.settings.paymentContactEmail,
    status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + ONE_HOUR
  };
  db.purchases.push(purchase);
  addLog(db, { type: 'purchase', message: `${req.account.visibleUser} pidió comprar ${c} créditos (${chosenMethod})`, accountName: req.account.visibleUser });
  saveDB(db);
  const note = chosenMethod === 'Transferencia bancaria'
    ? `Mandá el comprobante de la transferencia por Gmail a ${db.settings.paymentContactEmail} para que se apruebe más rápido.`
    : 'Tu pedido queda pendiente hasta que el administrador confirme el pago.';
  res.json({ ok: true, purchase, note });
});

router.get('/purchases/mine', requireAuth('creator'), (req, res) => {
  const db = getDB();
  purgeExpired(db);
  saveDB(db);
  const list = db.purchases.filter(p => p.creatorId === req.account.id).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ purchases: list });
});

module.exports = { router, purgeExpired, PAYMENT_METHODS };
