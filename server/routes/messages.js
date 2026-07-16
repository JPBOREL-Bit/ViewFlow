// server/routes/messages.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB } = require('../db');
const { requireAuth } = require('../auth');
const { uid } = require('../util');
const { getSupportBotReply } = require('../bot');

router.get('/', requireAuth(), (req, res) => {
  const db = getDB();
  const list = db.messages.filter(m => m.accountId === req.account.id).sort((a, b) => a.ts - b.ts);
  list.forEach(m => { if (m.sender === 'admin') m.read = true; });
  saveDB(db);
  res.json({ messages: list });
});

router.post('/', requireAuth(), (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Mensaje vacío.' });
  const db = getDB();
  const userMsg = { id: uid('msg'), accountId: req.account.id, sender: 'user', text: text.trim(), ts: Date.now(), read: false };
  db.messages.push(userMsg);
  const botReply = getSupportBotReply(text, req.account, db.settings);
  if (botReply) {
    db.messages.push({ id: uid('msg'), accountId: req.account.id, sender: 'admin', text: botReply, ts: Date.now() + 1, read: true });
  }
  saveDB(db);
  res.json({ ok: true });
});

module.exports = router;
