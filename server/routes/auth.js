// server/routes/auth.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB, addLog } = require('../db');
const { hashPassword, checkPassword, setSessionCookie, clearSessionCookie, createSession, publicAccount, requireAuth } = require('../auth');
const { uid, genVerifyCode } = require('../util');
const { trySendVerificationEmail } = require('../mailer');

function findByEmail(db, email) {
  return db.accounts.find(a => a.email.toLowerCase() === String(email || '').toLowerCase());
}

// Genera un "Viewer_N" único que nadie tenga todavía.
function generateUniqueViewerName(db) {
  const taken = new Set(db.accounts.map(a => (a.visibleUser || '').toLowerCase()));
  let candidate;
  do {
    const n = Math.floor(Math.random() * 90000) + 10000; // 5 dígitos
    candidate = `Viewer_${n}`;
  } while (taken.has(candidate.toLowerCase()));
  return candidate;
}

// ---- Registro ----
router.post('/register', async (req, res) => {
  const { role, name, visibleUser, email, phone, ytUser, password, acceptedTerms } = req.body || {};
  if (!['creator', 'viewer'].includes(role)) return res.status(400).json({ error: 'Rol inválido.' });
  if (!name || !email || !password) return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if (!acceptedTerms) return res.status(400).json({ error: 'Tenés que aceptar los Términos y la Política de Privacidad para registrarte.' });
  if (role === 'creator' && !visibleUser) return res.status(400).json({ error: 'Elegí un usuario visible.' });

  const db = getDB();
  if (findByEmail(db, email)) return res.status(409).json({ error: 'Ese Gmail ya tiene una cuenta registrada.' });

  let finalVisibleUser;
  if (role === 'viewer') {
    // Los viewers NO eligen su usuario: se les asigna uno único tipo Viewer_15.
    finalVisibleUser = generateUniqueViewerName(db);
  } else {
    const taken = db.accounts.some(a => (a.visibleUser || '').toLowerCase() === String(visibleUser).trim().toLowerCase());
    if (taken) return res.status(409).json({ error: 'Ese usuario visible ya está en uso, elegí otro.' });
    finalVisibleUser = String(visibleUser).trim();
  }

  const method = 'gmail';
  const acc = {
    id: uid(role),
    role,
    status: 'pending',
    name: String(name).trim(),
    email: String(email).trim(),
    passwordHash: hashPassword(password),
    phone: phone ? String(phone).trim() : '',
    visibleUser: finalVisibleUser,
    ytUser: ytUser ? String(ytUser).trim() : '',
    theme: 'light',
    credits: 0,
    ledger: [],
    verifyCode: genVerifyCode(),
    verifyCodeAt: Date.now(),
    acceptedTermsAt: Date.now(),
    createdAt: Date.now()
  };
  db.accounts.push(acc);
  db.verifyRequests.push({ id: uid('vr'), accountId: acc.id, method: 'gmail', target: acc.email, purpose: 'account', createdAt: Date.now() });
  addLog(db, { type: 'user', message: `Nueva cuenta registrada: ${acc.visibleUser} (${role === 'creator' ? 'creador' : 'viewer'}, ${acc.email}) — pendiente de verificación por Gmail`, accountName: acc.visibleUser });
  saveDB(db);
  const sent = await trySendVerificationEmail(acc.email, acc.verifyCode);
  res.json({ ok: true, message: sent ? 'Cuenta creada. Te mandamos un código de verificación por Gmail.' : 'Cuenta creada. Te vamos a mandar un código de verificación para activarla.', assignedUsername: role === 'viewer' ? finalVisibleUser : undefined });
});

// ---- Verificación de cuenta con código de un solo uso (Gmail o teléfono) ----
const VERIFY_CODE_MINUTES = 120;
const RESEND_COOLDOWN_SECONDS = 60;

router.post('/verify-account', (req, res) => {
  const { email, password, code } = req.body || {};
  const db = getDB();
  const acc = findByEmail(db, email);
  if (!acc || !checkPassword(password || '', acc.passwordHash)) return res.status(401).json({ error: 'Gmail o contraseña incorrectos.' });
  if (acc.status === 'blocked') return res.status(403).json({ error: 'Tu cuenta está bloqueada.' });
  if (!acc.verifyCode) return res.status(400).json({ error: 'No tenés un código pendiente. Pedí uno nuevo con "Reenviar código".' });
  if (Date.now() - acc.verifyCodeAt > VERIFY_CODE_MINUTES * 60 * 1000) {
    return res.status(400).json({ error: 'code_expired', message: 'Ese código venció (dura 120 minutos). Pedí uno nuevo con "Reenviar código".' });
  }
  if (acc.verifyCode !== String(code || '').trim()) return res.status(400).json({ error: 'El código de verificación no coincide.' });

  acc.status = 'approved';
  acc.verifyCode = null;
  acc.verifyCodeAt = null;
  db.verifyRequests = db.verifyRequests.filter(r => r.accountId !== acc.id);
  addLog(db, { type: 'user', message: `${acc.visibleUser} verificó su cuenta con el código de un solo uso — cuenta activada`, accountName: acc.visibleUser });
  saveDB(db);
  res.json({ ok: true, message: 'Cuenta verificada. Ya podés iniciar sesión.' });
});

// ---- Reenviar código de verificación (cooldown de 1 minuto) ----
router.post('/verify-account/resend', async (req, res) => {
  const { email, password } = req.body || {};
  const db = getDB();
  const acc = findByEmail(db, email);
  if (!acc || !checkPassword(password || '', acc.passwordHash)) return res.status(401).json({ error: 'Gmail o contraseña incorrectos.' });
  if (acc.status !== 'pending') return res.status(400).json({ error: 'Esta cuenta no está esperando verificación.' });
  if (acc.verifyCodeAt && Date.now() - acc.verifyCodeAt < RESEND_COOLDOWN_SECONDS * 1000) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - acc.verifyCodeAt)) / 1000);
    return res.status(429).json({ error: `Esperá ${waitSec}s antes de pedir otro código.` });
  }
  acc.verifyCode = genVerifyCode();
  acc.verifyCodeAt = Date.now();
  db.verifyRequests = db.verifyRequests.filter(r => r.accountId !== acc.id);
  db.verifyRequests.push({ id: uid('vr'), accountId: acc.id, method: 'gmail', target: acc.email, purpose: 'account', createdAt: Date.now() });
  saveDB(db);
  const sent = await trySendVerificationEmail(acc.email, acc.verifyCode);
  res.json({ ok: true, message: sent ? 'Te mandamos un código nuevo por Gmail.' : 'Código nuevo generado — el administrador te lo va a enviar en breve.' });
});

// ---- Login ----
const FAILED_ATTEMPT_WINDOW_MIN = 10;
const MAX_FAILED_ATTEMPTS = 5;
const IP_BAN_MINUTES = 10;

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const db = getDB();
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  const now = Date.now();

  db.ipBans = db.ipBans.filter(b => b.bannedUntil > now);
  const activeBan = ip && db.ipBans.find(b => b.ip === ip);
  if (activeBan) {
    const waitMin = Math.ceil((activeBan.bannedUntil - now) / 60000);
    return res.status(429).json({ error: `Demasiados intentos fallidos desde esta conexión. Probá de nuevo en ${waitMin} minuto(s).` });
  }

  const acc = findByEmail(db, email);
  if (!acc || !checkPassword(password || '', acc.passwordHash)) {
    addLog(db, { type: 'alert', message: `Intento de inicio de sesión fallido con el Gmail "${email || '—'}" (contraseña incorrecta o cuenta inexistente)`, accountName: email || null, ip });
    if (ip) {
      db.loginAttempts = db.loginAttempts.filter(a => now - a.ts < FAILED_ATTEMPT_WINDOW_MIN * 60 * 1000);
      db.loginAttempts.push({ ip, ts: now });
      const recentForIp = db.loginAttempts.filter(a => a.ip === ip).length;
      if (recentForIp >= MAX_FAILED_ATTEMPTS) {
        db.ipBans.push({ ip, bannedUntil: now + IP_BAN_MINUTES * 60 * 1000 });
        addLog(db, { type: 'alert', message: `IP baneada por ${IP_BAN_MINUTES} minutos tras ${recentForIp} contraseñas incorrectas seguidas`, accountName: null, ip });
        db.loginAttempts = db.loginAttempts.filter(a => a.ip !== ip);
      }
    }
    saveDB(db);
    return res.status(401).json({ error: 'Gmail o contraseña incorrectos.' });
  }
  if (acc.status === 'pending') return res.status(403).json({ error: 'pending', message: 'Tu cuenta todavía no está verificada. Usá "Verificación" con el código que te mandamos.' });
  if (acc.status === 'rejected') return res.status(403).json({ error: 'Tu solicitud fue rechazada.' });
  if (acc.status === 'blocked') return res.status(403).json({ error: 'Tu cuenta está bloqueada.' });

  const { session, error } = await createSession(acc.id, req);
  if (error) return res.status(429).json({ error });
  setSessionCookie(res, acc.id, session.id, false);
  const freshDb = getDB(); // createSession ya escribió la sesión nueva — releemos para no pisarla
  const freshAcc = freshDb.accounts.find(a => a.id === acc.id);
  addLog(freshDb, { type: 'user', message: `${freshAcc.visibleUser} (${freshAcc.role}) inició sesión`, accountName: freshAcc.visibleUser, ip });
  saveDB(freshDb);
  res.json({ ok: true, account: publicAccount(acc) });
});

router.post('/logout', (req, res) => {
  if (req.sessionId) {
    const db = getDB();
    db.sessions = db.sessions.filter(s => s.id !== req.sessionId);
    saveDB(db);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth(), (req, res) => {
  res.json({ account: publicAccount(req.account) });
});

// ---- Olvidé mi contraseña ----
router.post('/forgot/request', (req, res) => {
  const { email } = req.body || {};
  const db = getDB();
  const acc = findByEmail(db, email);
  if (!acc) return res.status(404).json({ error: 'No encontramos ninguna cuenta con ese Gmail.' });
  acc.verifyCode = genVerifyCode();
  acc.verifyCodeAt = Date.now();
  db.verifyRequests.push({ id: uid('vr'), accountId: acc.id, method: 'gmail', target: acc.email, createdAt: Date.now() });
  saveDB(db);
  res.json({ ok: true, message: `Se ha enviado el código de verificación al correo ${acc.email}` });
});

router.post('/forgot/verify', (req, res) => {
  const { email, code } = req.body || {};
  const db = getDB();
  const acc = findByEmail(db, email);
  if (!acc || !acc.verifyCode || acc.verifyCode !== String(code || '').trim()) {
    return res.status(400).json({ error: 'El código de verificación no coincide.' });
  }
  res.json({ ok: true });
});

router.post('/forgot/reset', (req, res) => {
  const { email, code, newPassword } = req.body || {};
  const db = getDB();
  const acc = findByEmail(db, email);
  if (!acc || !acc.verifyCode || acc.verifyCode !== String(code || '').trim()) {
    return res.status(400).json({ error: 'El código de verificación no coincide.' });
  }
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  acc.passwordHash = hashPassword(newPassword);
  acc.verifyCode = null;
  acc.verifyCodeAt = null;
  saveDB(db);
  res.json({ ok: true, message: 'Contraseña actualizada. Ya podés iniciar sesión.' });
});

// ---- Cambiar contraseña (logueado, con verificación) ----
router.post('/change-password/request-code', requireAuth(), (req, res) => {
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  acc.verifyCode = genVerifyCode();
  acc.verifyCodeAt = Date.now();
  db.verifyRequests.push({ id: uid('vr'), accountId: acc.id, method: 'gmail', target: acc.email, createdAt: Date.now() });
  saveDB(db);
  res.json({ ok: true, message: `Se ha enviado el código de verificación al correo ${acc.email}` });
});

router.post('/change-password', requireAuth(), (req, res) => {
  const { code, newPassword } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  if (!acc.verifyCode || acc.verifyCode !== String(code || '').trim()) {
    return res.status(400).json({ error: 'El código de verificación no coincide.' });
  }
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  acc.passwordHash = hashPassword(newPassword);
  acc.verifyCode = null;
  saveDB(db);
  res.json({ ok: true });
});

// ---- Perfil: editar datos (pide contraseña actual) ----
router.put('/profile', requireAuth(), (req, res) => {
  const { name, phone, visibleUser, ytUser, currentPassword } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  if (!checkPassword(currentPassword || '', acc.passwordHash)) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  const before = { name: acc.name, phone: acc.phone, visibleUser: acc.visibleUser, ytUser: acc.ytUser };
  if (name) acc.name = String(name).trim();
  if (phone !== undefined) acc.phone = String(phone).trim();
  if (visibleUser && acc.role === 'creator' && visibleUser.trim() !== acc.visibleUser) {
    const taken = db.accounts.some(a => a.id !== acc.id && (a.visibleUser || '').toLowerCase() === visibleUser.trim().toLowerCase());
    if (taken) return res.status(409).json({ error: 'Ese usuario visible ya está en uso.' });
    acc.visibleUser = visibleUser.trim();
  }
  if (ytUser !== undefined) acc.ytUser = String(ytUser).trim();
  const changed = Object.keys(before).filter(k => before[k] !== acc[k]);
  if (changed.length) {
    const summary = changed.map(k => `${k}: "${before[k]}" → "${acc[k]}"`).join(', ');
    addLog(db, { type: 'user', message: `${acc.visibleUser || acc.name} (${acc.role}) actualizó su perfil — ${summary}`, accountName: acc.visibleUser });
  }
  saveDB(db);
  res.json({ ok: true, account: publicAccount(acc) });
});

// ---- Preferencia de estilo (claro/oscuro) — no requiere contraseña, es solo estético ----
router.put('/theme', requireAuth(), (req, res) => {
  const { theme } = req.body || {};
  if (!['light', 'dark'].includes(theme)) return res.status(400).json({ error: 'Tema inválido.' });
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.account.id);
  acc.theme = theme;
  saveDB(db);
  res.json({ ok: true, theme });
});

module.exports = router;
