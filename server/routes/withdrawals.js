// server/routes/withdrawals.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB } = require('../db');
const { requireAuth } = require('../auth');
const { uid } = require('../util');
const { withdrawQuote } = require('../pricing');

const BANK_COMPANIES = ['BNA', 'Brubank', 'Naranja X', 'Mercado Pago', 'Ualá'];
const MISMATCH_PENALTY_PCT = 5; // si el alias/CBU no coincide con el titular, se cobra este % al devolver

function debitAccount(acc, amount, detail) {
  acc.credits = Math.round(((acc.credits || 0) - amount) * 100000) / 100000;
  acc.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'out', amount, detail });
}
function creditAccount(acc, amount, detail) {
  acc.credits = Math.round(((acc.credits || 0) + amount) * 100000) / 100000;
  acc.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'in', amount, detail });
}

router.get('/banks', requireAuth('viewer'), (req, res) => {
  res.json({ banks: BANK_COMPANIES, mismatchPenaltyPct: MISMATCH_PENALTY_PCT });
});

router.get('/quote', requireAuth('viewer'), (req, res) => {
  const db = getDB();
  const credits = parseFloat(String(req.query.credits || '0').replace(',', '.'));
  res.json(withdrawQuote(credits || 0, db.settings));
});

router.post('/', requireAuth('viewer'), (req, res) => {
  const { credits, bankCompany, alias, holderName, holderMatchesAccount } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  const amount = Math.floor(parseFloat(String(credits || '0').replace(',', '.')) * 10) / 10;
  const MIN = db.settings.minWithdrawCredits || 10;

  if (!amount || amount < MIN) return res.status(400).json({ error: `El mínimo de retiro es ${MIN} créditos.` });
  if (amount > (acc.credits || 0)) return res.status(400).json({ error: 'No tenés suficientes créditos disponibles.' });
  if (!BANK_COMPANIES.includes(bankCompany)) return res.status(400).json({ error: 'Elegí una compañía de pago válida.' });
  if (!alias || !holderName) return res.status(400).json({ error: 'Faltan datos de la cuenta para pagarte.' });

  const quote = withdrawQuote(amount, db.settings);
  const wd = {
    id: uid('wd'), viewerId: acc.id, credits: amount, netCredits: quote.netCredits,
    usd: quote.usd, ars: quote.ars, bankCompany,
    alias: String(alias).trim(), holderName: String(holderName).trim(),
    holderMatchesAccount: !!holderMatchesAccount,
    status: 'pending', createdAt: Date.now()
  };
  db.withdrawals.push(wd);
  debitAccount(acc, amount, 'Retiro solicitado');
  saveDB(db);
  res.json({ ok: true, withdrawal: wd, message: 'Tu solicitud está en proceso, se te acreditará en breve.' });
});

router.get('/mine', requireAuth('viewer'), (req, res) => {
  const db = getDB();
  const list = db.withdrawals.filter(w => w.viewerId === req.account.id).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ withdrawals: list });
});

module.exports = { router, BANK_COMPANIES, MISMATCH_PENALTY_PCT };
