// server/db.js
// Almacenamiento del lado del servidor. Este archivo vive SOLO en el backend.
// El navegador nunca lo lee ni lo descarga: todo pasa por la API con
// autenticación. Usamos un archivo JSON como base de datos simple para este
// prototipo; el mismo patrón de funciones (getDB/saveDB) se puede reemplazar
// más adelante por Postgres/Mongo sin tocar las rutas de la API.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function defaultDB() {
  return {
    accounts: [],       // { id, role, status, name, email, passwordHash, phone, visibleUser, ytUser, credits, ledger:[], theme:'light'|'dark', verifyCode, verifyCodeAt, createdAt }
    campaigns: [],       // { id, creatorId, title, url, seconds, views, viewsDone, credits, status, createdAt }
    participations: [],  // { id, campaignId, viewerId, status, credits, startedAt }
    purchases: [],        // { id, creatorId, credits, usd, ars, holderName, alias, method, status, createdAt, expiresAt }
    withdrawals: [],      // { id, viewerId, credits, netCredits, usd, ars, alias, holderName, status, createdAt }
    donations: [],          // { id, creatorId, credits, status, perViewerAmount, createdAt }
    messages: [],             // { id, accountId, sender, text, ts, read }
    verifyRequests: [],        // { id, accountId, method, target, createdAt }
    activityLog: [],            // { id, accountId, ts, text } — avisos internos para el admin (ej. cambios de perfil)
    settings: {
      usdRate: 1200,
      creditToUsd: 0.01,
      purchaseTaxPct: 15,
      withdrawTaxPct: 15,
      minWithdrawCredits: 10,
      minCampaignViews: 10,
      paymentAlias: 'viewflow.pagos',
      paymentContactEmail: 'pagos@viewflow.local',
      autoUsdRateEnabled: true,
      usdRateUpdatedAt: 0,
      siteTitle: 'ViewFlow',
      siteTagline: 'Impulsá tu contenido, de verdad',
      siteDesc: 'Conectamos creadores que buscan crecimiento real con viewers que ganan créditos por su tiempo.',
      maintenanceMode: false,
      maintenanceMessage: 'ViewFlow se encuentra en mantenimiento. Volvé a intentarlo en un rato.'
    },
    sessions: [] // { id, accountId, device, ip, location, trusted, createdAt, lastActiveAt }
  };
}

// Completa campos nuevos en una base ya existente, sin pisar lo que ya hay.
function migrate(db) {
  const fresh = defaultDB();
  db.settings = { ...fresh.settings, ...(db.settings || {}) };
  if (!Array.isArray(db.donations)) db.donations = [];
  if (!Array.isArray(db.verifyRequests)) db.verifyRequests = [];
  if (!Array.isArray(db.activityLog)) db.activityLog = [];
  if (!Array.isArray(db.sessions)) db.sessions = [];
  (db.accounts || []).forEach(a => {
    if (!a.theme) a.theme = 'light';
    if (!Array.isArray(a.ledger)) a.ledger = [];
    if (typeof a.credits !== 'number') a.credits = 0;
  });
  return db;
}

function ensureDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB(), null, 2));
  }
}

function getDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try { return migrate(JSON.parse(raw)); } catch (e) { return defaultDB(); }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Registra un evento en el log de actividad del admin. No guarda por sí solo:
// hay que llamar a saveDB(db) después (así se puede combinar con otros
// cambios en una sola escritura). type sirve para poder filtrar por color.
function addLog(db, { type, message, accountName, ip }) {
  if (!Array.isArray(db.activityLog)) db.activityLog = [];
  db.activityLog.unshift({
    id: crypto.randomBytes(6).toString('hex'),
    ts: Date.now(),
    type: type || 'info',
    message: String(message || '').slice(0, 400),
    accountName: accountName || null,
    ip: ip || null
  });
  if (db.activityLog.length > 3000) db.activityLog.length = 3000;
}

function ensureAdminSeed() {
  const db = getDB();
  const email = (process.env.ADMIN_EMAIL || 'admin@viewflow.local').toLowerCase();
  const already = db.accounts.find(a => a.role === 'admin');
  if (already) return;
  const rawPassword = process.env.ADMIN_PASSWORD || 'changeme123';
  const passwordHash = bcrypt.hashSync(rawPassword, 10);
  db.accounts.push({
    id: 'admin-1', role: 'admin', status: 'approved',
    name: 'Administrador', email, passwordHash,
    phone: '', visibleUser: 'Admin', ytUser: '', theme: 'light',
    credits: 0, ledger: [], verifyCode: null, verifyCodeAt: null,
    createdAt: Date.now()
  });
  saveDB(db);
  console.log(`[viewflow] Cuenta de admin creada: ${email} (definí ADMIN_EMAIL / ADMIN_PASSWORD en .env)`);
}

module.exports = { getDB, saveDB, defaultDB, ensureAdminSeed, addLog, DB_PATH };
