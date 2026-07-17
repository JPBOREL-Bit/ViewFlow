// server/auth.js
// Toda la lógica de sesión vive acá, en el servidor. El navegador solo recibe
// una cookie httpOnly firmada; nunca ve el secreto ni puede leer el token.

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDB } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[viewflow] ADVERTENCIA: falta JWT_SECRET en el .env. Usando un valor temporal solo para esta corrida — configuralo antes de producción.');
}
const SECRET = JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
const COOKIE_NAME = 'vf_session';

function signSession(accountId) {
  return jwt.sign({ sub: accountId }, SECRET, { expiresIn: '7d' });
}

function setSessionCookie(res, accountId) {
  const token = signSession(accountId);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Middleware: adjunta req.account si hay una sesión válida (no bloquea).
function attachAccount(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, SECRET);
    const db = getDB();
    const acc = db.accounts.find(a => a.id === payload.sub);
    if (acc) req.account = acc;
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
  attachAccount, requireAuth, setSessionCookie, clearSessionCookie,
  hashPassword, checkPassword, publicAccount, COOKIE_NAME
};
