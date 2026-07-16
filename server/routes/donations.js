// server/routes/donations.js
// Donaciones a otros usuarios del mismo tipo: un creador dona y se reparte
// entre TODOS los viewers aprobados; un viewer dona y se reparte entre
// TODOS los demás viewers aprobados (sin contarse a sí mismo).
const express = require('express');
const router = express.Router();
const { getDB, saveDB } = require('../db');
const { requireAuth } = require('../auth');
const { uid } = require('../util');

function debitAccount(acc, amount, detail) {
  acc.credits = Math.round(((acc.credits || 0) - amount) * 100000) / 100000;
  acc.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'out', amount, detail });
}

// ---- Creador dona a todos los viewers ----
router.post('/creator', requireAuth('creator'), (req, res) => {
  const { credits } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  const amount = Number(credits);
  if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: 'Ingresá una cantidad entera de créditos.' });
  if (amount > (acc.credits || 0)) return res.status(400).json({ error: 'No tenés suficientes créditos disponibles.' });

  debitAccount(acc, amount, 'Donación enviada a revisión');
  const donation = { id: uid('don'), fromId: acc.id, fromRole: 'creator', credits: amount, status: 'pending', perRecipientAmount: 0, createdAt: Date.now() };
  db.donations.push(donation);
  saveDB(db);
  res.json({ ok: true, donation });
});

// ---- Viewer dona a todos los demás viewers ----
router.post('/viewer', requireAuth('viewer'), (req, res) => {
  const { credits } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  const amount = Number(credits);
  if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: 'Ingresá una cantidad entera de créditos.' });
  if (amount > (acc.credits || 0)) return res.status(400).json({ error: 'No tenés suficientes créditos disponibles.' });

  debitAccount(acc, amount, 'Donación enviada a revisión');
  const donation = { id: uid('don'), fromId: acc.id, fromRole: 'viewer', credits: amount, status: 'pending', perRecipientAmount: 0, createdAt: Date.now() };
  db.donations.push(donation);
  saveDB(db);
  res.json({ ok: true, donation });
});

router.get('/mine', requireAuth(), (req, res) => {
  const db = getDB();
  const list = db.donations.filter(d => d.fromId === req.account.id).sort((a, b) => b.createdAt - a.createdAt);
  const recipientCount = req.account.role === 'creator'
    ? db.accounts.filter(a => a.role === 'viewer' && a.status === 'approved').length
    : db.accounts.filter(a => a.role === 'viewer' && a.status === 'approved' && a.id !== req.account.id).length;
  res.json({ donations: list, recipientCount });
});

module.exports = router;
