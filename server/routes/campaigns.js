// server/routes/campaigns.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB, addLog } = require('../db');
const { requireAuth, checkPassword, parseDevice } = require('../auth');
const { uid } = require('../util');
const { campaignCost, viewerRewardFor } = require('../pricing');
const { reduceSecondsByPlan } = require('../subscriptions');
const { FREE_CAMPAIGN, ensureEconomyState, freeCampaignActive, findFraudMatch } = require('../economy');

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

const PLATFORMS = ['youtube'];
function urlMatchesPlatform(url, platform) {
  return !!extractYouTubeId(url);
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
// ---- Estado del beneficio de campaña gratuita (para mostrar en el panel) ----
router.get('/free/status', requireAuth('creator'), (req, res) => {
  const db = getDB();
  ensureEconomyState(db);
  const acc = db.accounts.find(a => a.id === req.account.id);
  const alreadyClaimed = db.freeCampaignClaims.some(c => c.creatorId === acc.id);
  res.json({
    active: freeCampaignActive(db),
    alreadyClaimed,
    remainingCampaigns: Math.max(0, db.settings.freeCampaignProgram.maxCampaigns - db.settings.freeCampaignProgram.usedCampaigns),
    remainingFund: Math.max(0, db.settings.freeCampaignProgram.fundTotal - db.settings.freeCampaignProgram.fundUsed),
    program: FREE_CAMPAIGN
  });
});

// ---- Reclamar la campaña gratuita (una sola vez por creador, con chequeo antifraude) ----
router.post('/free', requireAuth('creator'), (req, res) => {
  const { title, url } = req.body || {};
  const db = getDB();
  ensureEconomyState(db);
  const acc = db.accounts.find(a => a.id === req.account.id);

  if (!freeCampaignActive(db)) {
    return res.status(400).json({ error: 'El beneficio de campaña gratuita ya no está disponible (se agotó el cupo, el fondo, o pasaron los 30 días).' });
  }
  if (db.freeCampaignClaims.some(c => c.creatorId === acc.id)) {
    return res.status(400).json({ error: 'Ya usaste tu campaña gratuita — es un beneficio de una sola vez por creador.' });
  }
  if (!title || !url) return res.status(400).json({ error: 'Faltan título o URL.' });
  if (!extractYouTubeId(url)) return res.status(400).json({ error: 'Solo se admiten links de YouTube (video o Shorts).' });

  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  const device = parseDevice(req.headers['user-agent']);
  const fraudSignal = findFraudMatch(db, acc, ip, device, db.freeCampaignClaims);
  if (fraudSignal) {
    addLog(db, { type: 'alert', message: `Intento de reclamar campaña gratuita bloqueado: ${acc.visibleUser} coincide con un reclamo anterior por ${fraudSignal}`, accountName: acc.visibleUser, ip });
    saveDB(db);
    return res.status(403).json({ error: 'No se pudo validar tu elegibilidad para el beneficio gratuito (ya fue usado desde una cuenta relacionada).' });
  }

  const camp = {
    id: uid('camp'), creatorId: acc.id, title: String(title).trim(), url: String(url).trim(), platform: 'youtube',
    seconds: FREE_CAMPAIGN.seconds, views: FREE_CAMPAIGN.views, viewsDone: 0,
    credits: FREE_CAMPAIGN.creditsPerCampaign, rewardPerView: FREE_CAMPAIGN.creditsPerCampaign / FREE_CAMPAIGN.views,
    viewerPool: FREE_CAMPAIGN.creditsPerCampaign, status: 'active', createdAt: Date.now(), fundedFree: true
  };
  db.campaigns.push(camp);
  db.settings.freeCampaignProgram.fundUsed += FREE_CAMPAIGN.creditsPerCampaign;
  db.settings.freeCampaignProgram.usedCampaigns += 1;
  db.freeCampaignClaims.push({ id: uid('fcc'), creatorId: acc.id, email: acc.email, phone: acc.phone || null, ip, device, claimedAt: Date.now() });
  addLog(db, { type: 'campaign', message: `${acc.visibleUser} reclamó su campaña gratuita (fondo: ${db.settings.freeCampaignProgram.fundUsed}/${db.settings.freeCampaignProgram.fundTotal} créditos, ${db.settings.freeCampaignProgram.usedCampaigns}/${db.settings.freeCampaignProgram.maxCampaigns} campañas)`, accountName: acc.visibleUser });
  if (!freeCampaignActive(db)) {
    addLog(db, { type: 'alert', message: 'El beneficio de campaña gratuita se agotó (cupo o fondo consumido) — se desactivó automáticamente.', accountName: null });
  }
  saveDB(db);
  res.json({ ok: true, campaign: camp });
});

router.post('/', requireAuth('creator'), (req, res) => {
  const { title, url, seconds, views, platform } = req.body || {};
  const db = getDB();
  const settings = db.settings;
  const s = parseInt(seconds, 10);
  const v = parseInt(views, 10);
  const plat = 'youtube';

  if (!title || !url) return res.status(400).json({ error: 'Faltan título o URL.' });
  if (!urlMatchesPlatform(url, plat)) {
    return res.status(400).json({ error: 'Solo se admiten links de YouTube (video o Shorts).' });
  }
  if (!s || s < 30) return res.status(400).json({ error: 'El tiempo mínimo de una campaña es 30 segundos.' });
  if (!v || v < (settings.minCampaignViews || 10)) return res.status(400).json({ error: `El mínimo de viewers es ${settings.minCampaignViews || 10}.` });

  const acc = db.accounts.find(a => a.id === req.account.id);
  const { total, viewerPool, perView } = campaignCost(s, v);
  if ((acc.credits || 0) < total) {
    return res.status(400).json({ error: `Créditos insuficientes. Necesitás ${total} y tenés ${acc.credits || 0}.` });
  }

  const camp = {
    id: uid('camp'), creatorId: acc.id, title: String(title).trim(), url: String(url).trim(), platform: plat,
    seconds: s, views: v, viewsDone: 0, credits: total, rewardPerView: perView, viewerPool,
    status: 'active', createdAt: Date.now()
  };
  db.campaigns.push(camp);
  debitAccount(acc, total, 'Campaña creada: ' + camp.title);
  addLog(db, { type: 'campaign', message: `${acc.visibleUser} creó la campaña "${camp.title}" en ${plat} (${v} viewers, ${s}s, ${total} créditos)`, accountName: acc.visibleUser });
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

// ---- Pausar campaña (solo si todavía no arrancó — 0 vistas hechas) ----
router.put('/:id/pause', requireAuth('creator'), (req, res) => {
  const db = getDB();
  const camp = db.campaigns.find(c => c.id === req.params.id && c.creatorId === req.account.id);
  if (!camp) return res.status(404).json({ error: 'Campaña no encontrada.' });
  if (camp.status !== 'active') return res.status(400).json({ error: 'Solo se pueden pausar campañas activas.' });
  if (camp.viewsDone > 0) return res.status(400).json({ error: 'Esta campaña ya empezó a recibir vistas — no se puede pausar ni modificar, solo eliminar.' });
  camp.status = 'paused';
  addLog(db, { type: 'campaign', message: `${req.account.visibleUser} pausó la campaña "${camp.title}"`, accountName: req.account.visibleUser });
  saveDB(db);
  res.json({ ok: true });
});

router.put('/:id/resume', requireAuth('creator'), (req, res) => {
  const db = getDB();
  const camp = db.campaigns.find(c => c.id === req.params.id && c.creatorId === req.account.id);
  if (!camp) return res.status(404).json({ error: 'Campaña no encontrada.' });
  if (camp.status !== 'paused') return res.status(400).json({ error: 'Esta campaña no está pausada.' });
  camp.status = 'active';
  addLog(db, { type: 'campaign', message: `${req.account.visibleUser} reanudó la campaña "${camp.title}"`, accountName: req.account.visibleUser });
  saveDB(db);
  res.json({ ok: true });
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
  addLog(db, { type: 'campaign', message: `${acc.visibleUser} eliminó la campaña "${camp.title}" (no se reembolsaron los créditos)`, accountName: acc.visibleUser });
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

  const acc = db.accounts.find(a => a.id === req.account.id);
  const planReducedSeconds = reduceSecondsByPlan(camp.seconds, acc.subPlan || 'free');
  const part = {
    id: uid('part'), campaignId: camp.id, viewerId: req.account.id,
    status: 'active', startedAt: Date.now(), deadline: Date.now() + 60 * 60 * 1000,
    seconds: camp.seconds, effectiveSeconds: planReducedSeconds, videoDuration: null, reward: camp.rewardPerView,
    platform: camp.platform || 'youtube'
  };
  db.participations.push(part);
  saveDB(db);
  res.json({ ok: true, participation: part, videoId: extractYouTubeId(camp.url) });
});

// ---- Participar: informar la duración real del video (si es más corto que
// lo pedido, el viewer solo tiene que mirarlo entero, pero cobra igual el
// tiempo completo que fijó el creador — lo paga el creador de todas formas) ----
router.post('/:id/participate/duration', requireAuth('viewer'), (req, res) => {
  const { participationId, duration } = req.body || {};
  const db = getDB();
  const part = db.participations.find(p => p.id === participationId && p.viewerId === req.account.id && p.status === 'active');
  if (!part) return res.status(404).json({ error: 'Participación no encontrada.' });
  const d = Math.floor(Number(duration));
  if (d > 0) {
    part.videoDuration = d;
    part.effectiveSeconds = Math.min(part.effectiveSeconds, d);
    saveDB(db);
  }
  res.json({ ok: true, effectiveSeconds: part.effectiveSeconds });
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
  const requiredMs = (part.effectiveSeconds || camp.seconds) * 1000;
  const elapsedOk = (Date.now() - part.startedAt) >= requiredMs - 1500; // pequeño margen de red
  if (!elapsedOk) return res.status(400).json({ error: 'Todavía no se cumplió el tiempo requerido.' });

  part.status = 'completed';
  camp.viewsDone += 1;
  if (camp.viewsDone >= camp.views) camp.status = 'finished';
  const acc = db.accounts.find(a => a.id === req.account.id);
  creditAccount(acc, camp.rewardPerView, 'Participación: ' + camp.title);
  addLog(db, { type: 'campaign', message: `${acc.visibleUser} ganó ${camp.rewardPerView} créditos por participar en "${camp.title}"`, accountName: acc.visibleUser });

  if (acc.referredBy && !acc.referralRewardGiven) {
    const isFirstCompletion = db.participations.filter(p => p.viewerId === acc.id && p.status === 'completed').length === 1;
    if (isFirstCompletion) {
      const referrer = db.accounts.find(a => a.id === acc.referredBy);
      if (referrer) {
        creditAccount(referrer, 50, `Referido: ${acc.visibleUser} completó su primera campaña`);
        acc.referralRewardGiven = true;
        addLog(db, { type: 'referral', message: `${referrer.visibleUser} ganó 50 créditos por referir a ${acc.visibleUser} (completó su primera campaña)`, accountName: referrer.visibleUser });
      }
    }
  }

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
  const acc = db.accounts.find(a => a.id === req.account.id);
  const camp = db.campaigns.find(c => c.id === part.campaignId);
  addLog(db, { type: 'campaign', message: `${acc ? acc.visibleUser : req.account.id} salió antes de tiempo de "${camp ? camp.title : part.campaignId}" — no recibe créditos`, accountName: acc ? acc.visibleUser : null });
  saveDB(db);
  res.json({ ok: true });
});

module.exports = router;
