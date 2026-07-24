// server/server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const { ensureAdminSeed, getDB, saveDB, addLog } = require('./db');
const { attachAccount } = require('./auth');
const { purgeExpired } = require('./routes/store');
const { startExchangeRateJob } = require('./exchange-rate');

const authRoutes = require('./routes/auth');
const campaignRoutes = require('./routes/campaigns');
const { router: storeRoutes } = require('./routes/store');
const { router: withdrawalRoutes } = require('./routes/withdrawals');
const messageRoutes = require('./routes/messages');
const donationRoutes = require('./routes/donations');
const deviceRoutes = require('./routes/devices');
const adminRoutes = require('./routes/admin');

ensureAdminSeed();
startExchangeRateJob();

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', true); // Render está detrás de un proxy — necesario para obtener la IP real del visitante

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(attachAccount);

// Nunca cachear respuestas de la API (evita filtrar datos de sesión por el navegador/proxy).
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Modo mantenimiento: si está activo, solo el admin puede seguir usando la
// API. El resto recibe un 503 con aviso — el frontend interpreta esto y
// muestra la pantalla de "en mantenimiento" en vez del panel.
const MAINTENANCE_ALLOWLIST = ['/auth/login', '/auth/me', '/auth/logout', '/public-settings', '/version', '/health'];
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  if (MAINTENANCE_ALLOWLIST.includes(req.path)) return next();
  const db = getDB();
  if (db.settings.maintenanceMode && (!req.account || req.account.role !== 'admin')) {
    return res.status(503).json({ error: 'maintenance', message: db.settings.maintenanceMessage || 'ViewFlow se encuentra en mantenimiento. Volvé a intentarlo en un rato.' });
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/subscriptions', require('./routes/subscriptions').router);
app.use('/api/devices', deviceRoutes);
app.use('/api/admin', adminRoutes);

// Settings públicos (solo lo necesario para pintar la landing, nada sensible).
app.get('/api/public-settings', (req, res) => {
  const db = getDB();
  const { siteTitle, siteTagline, siteDesc, maintenanceMode, maintenanceMessage } = db.settings;
  const ONLINE_WINDOW_MS = 5 * 60 * 1000;
  const now = Date.now();
  const approved = db.accounts.filter(a => a.status === 'approved');
  const totalCreators = approved.filter(a => a.role === 'creator').length;
  const totalViewers = approved.filter(a => a.role === 'viewer').length;
  const activeAccountIds = new Set(
    db.sessions.filter(s => now - s.lastActiveAt < ONLINE_WINDOW_MS).map(s => s.accountId)
  );
  const onlineCreators = approved.filter(a => a.role === 'creator' && activeAccountIds.has(a.id)).length;
  const onlineViewers = approved.filter(a => a.role === 'viewer' && activeAccountIds.has(a.id)).length;
  res.json({
    siteTitle, siteTagline, siteDesc, maintenanceMode, maintenanceMessage,
    stats: { totalCreators, totalViewers, onlineCreators, onlineViewers }
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Endpoint liviano para detectar si hay datos nuevos (usa la fecha de
// modificación del archivo de datos). El frontend lo consulta cada pocos
// segundos y solo avisa "hay contenido nuevo" — nunca refresca solo.
const fs = require('fs');
const { DB_PATH } = require('./db');
app.get('/api/version', (req, res) => {
  try {
    const stat = fs.statSync(DB_PATH);
    res.json({ updatedAt: stat.mtimeMs });
  } catch (e) {
    res.json({ updatedAt: 0 });
  }
});

// Frontend estático (las páginas separadas: landing, creator, viewer, admin).
app.use(express.static(path.join(__dirname, '..', 'public')));

// Link de invitación por path: viewflow.onrender.com/CODIGO (código de un
// creador) → fuerza el registro como creador. Va DESPUÉS de los archivos
// estáticos para no pisar ninguna ruta real (css/, js/, *.html, etc.), y
// solo redirige si el código realmente existe.
app.get('/:code', (req, res, next) => {
  const db = getDB();
  const acc = db.accounts.find(a => a.role === 'creator' && (a.refCode || '').toLowerCase() === req.params.code.toLowerCase());
  if (!acc) return next();
  res.redirect(`/?ref=${encodeURIComponent(acc.refCode)}&forceRole=creator`);
});

app.use((req, res) => res.status(404).json({ error: 'No encontrado.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// Purga solicitudes de compra vencidas (más de 1h) cada 5 minutos, además de
// purgarse al vuelo en cada request relevante.
setInterval(() => {
  const db = getDB();
  if (purgeExpired(db)) saveDB(db);
}, 5 * 60 * 1000);

// Chequea cada hora si ya empezó una semana nueva — si es así, reparte el
// Pool acumulado entre los viewers elegibles. También hay un botón manual
// en el panel de admin por si el servidor estuvo dormido (plan free de
// Render) justo cuando tocaba repartir.
const { ensureEconomyState, startOfWeek, distributePool } = require('./economy');
function creditAccountForPool(acc, amount, detail) {
  acc.credits = Math.round(((acc.credits || 0) + amount) * 100000) / 100000;
  acc.ledger.push({ id: 'ldg-' + Math.random().toString(36).slice(2, 10), ts: Date.now(), type: 'in', amount, detail });
}
setInterval(() => {
  const db = getDB();
  ensureEconomyState(db);
  if (startOfWeek(Date.now()) > db.pool.weekStart) {
    distributePool(db, addLog, creditAccountForPool);
    saveDB(db);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`[viewflow] servidor corriendo en http://localhost:${PORT}`);
});
