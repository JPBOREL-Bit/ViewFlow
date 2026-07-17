// server/server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const { ensureAdminSeed, getDB, saveDB } = require('./db');
const { attachAccount } = require('./auth');
const { purgeExpired } = require('./routes/store');
const { startExchangeRateJob } = require('./exchange-rate');

const authRoutes = require('./routes/auth');
const campaignRoutes = require('./routes/campaigns');
const { router: storeRoutes } = require('./routes/store');
const { router: withdrawalRoutes } = require('./routes/withdrawals');
const messageRoutes = require('./routes/messages');
const donationRoutes = require('./routes/donations');
const adminRoutes = require('./routes/admin');

ensureAdminSeed();
startExchangeRateJob();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(attachAccount);

// Nunca cachear respuestas de la API (evita filtrar datos de sesión por el navegador/proxy).
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/admin', adminRoutes);

// Settings públicos (solo lo necesario para pintar la landing, nada sensible).
app.get('/api/public-settings', (req, res) => {
  const db = getDB();
  const { siteTitle, siteTagline, siteDesc } = db.settings;
  res.json({ siteTitle, siteTagline, siteDesc });
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

app.listen(PORT, () => {
  console.log(`[viewflow] servidor corriendo en http://localhost:${PORT}`);
});
