// server/routes/devices.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB } = require('../db');
const { requireAuth, checkPassword, setSessionCookie, clearSessionCookie, MAX_DEVICES } = require('../auth');

router.use(requireAuth());

router.get('/', (req, res) => {
  const db = getDB();
  const list = db.sessions
    .filter(s => s.accountId === req.account.id)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map(s => ({ ...s, isCurrent: s.id === req.sessionId }));
  res.json({ sessions: list, max: MAX_DEVICES });
});

// Guarda una ubicación aproximada (reverse-geocode ya resuelto en el
// navegador) para la sesión actual. Solo el propio dispositivo puede
// reportar su ubicación — no se puede pedir la de otro dispositivo.
router.post('/location', (req, res) => {
  const { label } = req.body || {};
  if (!label) return res.status(400).json({ error: 'Falta la ubicación.' });
  const db = getDB();
  const session = db.sessions.find(s => s.id === req.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada.' });
  session.location = String(label).slice(0, 120);
  saveDB(db);
  res.json({ ok: true });
});

router.post('/:id/trust', (req, res) => {
  const { password } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  if (!checkPassword(password || '', acc.passwordHash)) return res.status(401).json({ error: 'Contraseña incorrecta.' });
  const session = db.sessions.find(s => s.id === req.params.id && s.accountId === req.account.id);
  if (!session) return res.status(404).json({ error: 'Dispositivo no encontrado.' });
  session.trusted = true;
  saveDB(db);
  if (session.id === req.sessionId) setSessionCookie(res, req.account.id, session.id, true);
  res.json({ ok: true, needsRelogin: session.id !== req.sessionId });
});

router.post('/:id/revoke', (req, res) => {
  const { password } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  if (!checkPassword(password || '', acc.passwordHash)) return res.status(401).json({ error: 'Contraseña incorrecta.' });
  const exists = db.sessions.find(s => s.id === req.params.id && s.accountId === req.account.id);
  if (!exists) return res.status(404).json({ error: 'Dispositivo no encontrado.' });
  db.sessions = db.sessions.filter(s => s.id !== req.params.id);
  saveDB(db);
  if (exists.id === req.sessionId) clearSessionCookie(res);
  res.json({ ok: true, wasCurrent: exists.id === req.sessionId });
});

module.exports = router;
