// server/routes/campaigns.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB } = require('../db');
const { requireAuth, checkPassword } = require('../auth');
const { uid } = require('../util');
const { campaignCost, viewerRewardFor } = require('../pricing');

function creditAccount(acc, amount, detail) {
  acc.credits = Math.round(((acc.credits || 0) + amount) * 100000) / 100000;
  acc.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'in', amount, detail });
}
function debitAccount(acc, amount, detail) {
  acc.credits = Math.round(((acc.credits || 0) - amount) * 100000) / 100000;
  acc.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'out', amount, detail });
}

// Solo YouTube: video normal o Shorts.
function extractYouTubeId(url) {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{6,})/,
    /youtu\.be\/([a-zA-Z0-9_-]{6,})/,
    /youtube\.com\/(?:embed|shorts)\/([a-zA-Z0-9_-]{6,})/
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

// ---- Cotización en vivo (para el formulario de crear campaña) ----
router.get('/quote', requireAuth('creator'), (req, res) => {
  const s = parseInt(req.query.seconds, 10) || 0;
  const v = parseInt(req.query.views, 10) || 0;
  const { total, perView } = campaignCost(s, v);
  const totalPlaybackSeconds = s * v;
  res.json({
    total, perView,
    playbackHours: Math.floor(totalPlaybackSeconds / 3600),
    playbackMinutes: Math.floor((totalPlaybackSeconds % 3600) / 60)
  });
});

// ---- Crear campaña (creador) ----
router.post('/', requireAuth('creator'), (req, res) => {
  const { title, url, seconds, views } = req.body || {};
  const db = getDB();
  const settings = db.settings;
  const s = parseInt(seconds, 10);
  const v = parseInt(views, 10);

  if (!title || !url) return res.status(400).json({ error: 'Faltan título o URL.' });
  if (!extractYouTubeId(url)) return res.status(400).json({ error: 'Solo se admiten links de YouTube (video o Shorts).' });
  if (!s || s < 30) return res.status(400).json({ error: 'El tiempo mínimo de una campaña es 30 segundos.' });
  if (!v || v < (settings.minCampaignViews || 10)) return res.status(400).json({ error: `El mínimo de viewers es ${settings.minCampaignViews || 10}.` });

  const acc = db.accounts.find(a => a.id === req.account.id);
  const { total, viewerPool, perView } = campaignCost(s, v);
  if ((acc.credits || 0) < total) {
    return res.status(400).json({ error: `Créditos insuficientes. Necesitás ${total} y tenés ${acc.credits || 0}.` });
  }

  const camp = {
    id: uid('camp'), creatorId: acc.id, title: String(title).trim(), url: String(url).trim(),
    seconds: s, views: v, viewsDone: 0, credits: total, rewardPerView: perView, viewerPool,
    status: 'active', createdAt: Date.now()
  };
  db.campaigns.push(camp);
  debitAccount(acc, total, 'Campaña creada: ' + camp.title);
  saveDB(db);
  res.json({ ok: true, campaign: camp });
});

// ---- Listar campañas activas (viewer) ----
router.get('/active', requireAuth(), (req, res) => {
  const db = getDB();
  let list = db.campaigns.filter(c => c.status === 'active');
  if (req.account.role === 'viewer') {
    const doneIds = new Set(db.participations.filter(p => p.viewerId === req.account.id && ['completed', 'active'].includes(p.status)).map(p => p.campaignId));
    list = list.filter(c => !doneIds.has(c.id));
  }
  list = list.map(c => ({ ...c, creatorName: (db.accounts.find(a => a.id === c.creatorId) || {}).visibleUser || '—' }));
  res.json({ campaigns: list });
});

// ---- Historial de participaciones del viewer ----
router.get('/participations/mine', requireAuth('viewer'), (req, res) => {
  const db = getDB();
  const list = db.participations.filter(p => p.viewerId === req.account.id).map(p => {
    const camp = db.campaigns.find(c => c.id === p.campaignId);
    return { ...p, campaignTitle: camp ? camp.title : '(campaña eliminada)' };
  }).sort((a, b) => b.startedAt - a.startedAt);
  res.json({ participations: list });
});

// ---- Mis campañas (creador) ----
router.get('/mine', requireAuth('creator'), (req, res) => {
  const db = getDB();
  const list = db.campaigns.filter(c => c.creatorId === req.account.id);
  res.json({ campaigns: list });
});

// ---- Eliminar campaña (creador, pide contraseña) ----
router.delete('/:id', requireAuth('creator'), (req, res) => {
  const { password } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  if (!checkPassword(password || '', acc.passwordHash)) return res.status(401).json({ error: 'Contraseña incorrecta.' });
  const camp = db.campaigns.find(c => c.id === req.params.id && c.creatorId === acc.id);
  if (!camp) return res.status(404).json({ error: 'Campaña no encontrada.' });
  db.campaigns = db.campaigns.filter(c => c.id !== camp.id);
  db.participations = db.participations.filter(p => p.campaignId !== camp.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---- Participar: iniciar (viewer) ----
router.post('/:id/participate/start', requireAuth('viewer'), (req, res) => {
  const db = getDB();
  const camp = db.campaigns.find(c => c.id === req.params.id && c.status === 'active');
  if (!camp) return res.status(404).json({ error: 'Campaña no disponible.' });

  const already = db.participations.find(p => p.campaignId === camp.id && p.viewerId === req.account.id && p.status === 'completed');
  if (already) return res.status(400).json({ error: 'Ya participaste en esta campaña.' });

  const strikes = db.participations.filter(p => p.campaignId === camp.id && p.viewerId === req.account.id && ['abandoned', 'expired'].includes(p.status)).length;
  if (strikes >= 3) return res.status(400).json({ error: 'Alcanzaste el máximo de salidas permitidas en esta campaña.' });

  const part = {
    id: uid('part'), campaignId: camp.id, viewerId: req.account.id,
    status: 'active', startedAt: Date.now(), deadline: Date.now() + 60 * 60 * 1000,
    seconds: camp.seconds, reward: camp.rewardPerView
  };
  db.participations.push(part);
  saveDB(db);
  res.json({ ok: true, participation: part, videoId: extractYouTubeId(camp.url) });
});

// ---- Participar: completar (viewer) ----
router.post('/:id/participate/complete', requireAuth('viewer'), (req, res) => {
  const { participationId } = req.body || {};
  const db = getDB();
  const camp = db.campaigns.find(c => c.id === req.params.id);
  const part = db.participations.find(p => p.id === participationId && p.viewerId === req.account.id && p.status === 'active');
  if (!camp || !part) return res.status(404).json({ error: 'Participación no encontrada.' });
  if (Date.now() > part.deadline) {
    part.status = 'expired';
    saveDB(db);
    return res.status(400).json({ error: 'Se agotó el tiempo máximo de 1 hora.' });
  }
  const elapsedOk = (Date.now() - part.startedAt) >= (camp.seconds * 1000) - 1500; // pequeño margen de red
  if (!elapsedOk) return res.status(400).json({ error: 'Todavía no se cumplió el tiempo requerido.' });

  part.status = 'completed';
  camp.viewsDone += 1;
  if (camp.viewsDone >= camp.views) camp.status = 'finished';
  const acc = db.accounts.find(a => a.id === req.account.id);
  creditAccount(acc, camp.rewardPerView, 'Participación: ' + camp.title);
  saveDB(db);
  res.json({ ok: true, reward: camp.rewardPerView, credits: acc.credits });
});

// ---- Participar: abandonar (viewer) ----
router.post('/:id/participate/abandon', requireAuth('viewer'), (req, res) => {
  const { participationId } = req.body || {};
  const db = getDB();
  const part = db.participations.find(p => p.id === participationId && p.viewerId === req.account.id && p.status === 'active');
  if (!part) return res.status(404).json({ error: 'Participación no encontrada.' });
  part.status = 'abandoned';
  saveDB(db);
  res.json({ ok: true });
});

module.exports = router;
