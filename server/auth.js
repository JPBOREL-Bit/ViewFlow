// server/auth.js
// Toda la lógica de sesión vive acá, en el servidor. El navegador solo recibe
// una cookie httpOnly firmada; nunca ve el secreto ni puede leer el token.
// Cada login crea un registro de sesión por dispositivo (server/db.js →
// sessions[]), lo que permite listar/cerrar/confiar dispositivos y limitar
// cuántos pueden estar conectados a la vez.

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDB, saveDB } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[viewflow] ADVERTENCIA: falta JWT_SECRET en el .env. Usando un valor temporal solo para esta corrida — configuralo antes de producción.');
}
const SECRET = JWT_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'vf_session';
const MAX_DEVICES = 5;
const TRUSTED_DAYS = 30;

function parseDevice(uaString) {
  const ua = uaString || '';
  let browser = 'Navegador';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = 'Dispositivo';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'Mac';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} en ${os}`;
}

function signSession(accountId, sessionId, trusted) {
  return jwt.sign({ sub: accountId, sid: sessionId }, SECRET, { expiresIn: trusted ? '30d' : '1d' });
}

// trusted=false ⇒ cookie de sesión del navegador (se borra sola al cerrar
// TODAS las pestañas); trusted=true ⇒ persiste 30 días.
function setSessionCookie(res, accountId, sessionId, trusted) {
  const token = signSession(accountId, sessionId, trusted);
  const opts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  };
  if (trusted) opts.maxAge = TRUSTED_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, opts);
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Crea el registro de sesión de este dispositivo, respetando el máximo de
// dispositivos conectados a la vez. Devuelve { session } o { error }.
function createSession(accountId, req) {
  const db = getDB();
  const now = Date.now();
  db.sessions = db.sessions.filter(s => s.trusted || (now - s.lastActiveAt) < 24 * 60 * 60 * 1000); // limpia sesiones no confiables viejas
  const activeCount = db.sessions.filter(s => s.accountId === accountId).length;
  if (activeCount >= MAX_DEVICES) {
    return { error: `Alcanzaste el máximo de ${MAX_DEVICES} dispositivos conectados. Cerrá sesión en otro dispositivo desde "Dispositivos" para poder entrar acá.` };
  }
  const session = {
    id: crypto.randomBytes(10).toString('hex'),
    accountId,
    device: parseDevice(req.headers['user-agent']),
    ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim(),
    location: null,
    trusted: false,
    createdAt: now,
    lastActiveAt: now
  };
  db.sessions.push(session);
  saveDB(db);
  return { session };
}

// Middleware: adjunta req.account y req.sessionId si hay una sesión válida
// y su registro sigue existiendo (no fue cerrada desde otro dispositivo).
function attachAccount(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, SECRET);
    const db = getDB();
    const session = db.sessions.find(s => s.id === payload.sid && s.accountId === payload.sub);
    if (!session) return next(); // la sesión fue revocada en otro lado
    const acc = db.accounts.find(a => a.id === payload.sub);
    if (acc) {
      req.account = acc;
      req.sessionId = session.id;
      session.lastActiveAt = Date.now();
      saveDB(db);
    }
  } catch (err) { /* token inválido o vencido: seguimos sin sesión */ }
  next();
}

// Middleware: exige sesión válida y (opcionalmente) un rol específico.
function requireAuth(role) {
  return (req, res, next) => {
    if (!req.account) return res.status(401).json({ error: 'No autenticado.' });
    if (role && req.account.role !== role) return res.status(403).json({ error: 'No autorizado.' });
    next();
  };
}

function hashPassword(plain) { return bcrypt.hashSync(plain, 10); }
function checkPassword(plain, hash) { return bcrypt.compareSync(plain, hash); }

// Nunca devolvemos el hash de contraseña, ni verifyCode salvo al propio admin.
function publicAccount(acc) {
  const { passwordHash, verifyCode, verifyCodeAt, ...safe } = acc;
  return safe;
}

module.exports = {
  attachAccount, requireAuth, setSessionCookie, clearSessionCookie, createSession,
  hashPassword, checkPassword, publicAccount, COOKIE_NAME, MAX_DEVICES
};
