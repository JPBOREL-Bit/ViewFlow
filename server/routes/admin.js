// server/routes/admin.js
const express = require('express');
const router = express.Router();
const { getDB, saveDB, defaultDB } = require('../db');
const { requireAuth, publicAccount, checkPassword } = require('../auth');
const { uid } = require('../util');
const { purgeExpired } = require('./store');

router.use(requireAuth('admin'));

function creditAccount(acc, amount, detail) {
  acc.credits = Math.round(((acc.credits || 0) + amount) * 100000) / 100000;
  acc.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'in', amount, detail });
}

// ---- Dashboard general ----
router.get('/overview', (req, res) => {
  const db = getDB();
  purgeExpired(db); saveDB(db);
  const creators = db.accounts.filter(a => a.role === 'creator');
  const viewers = db.accounts.filter(a => a.role === 'viewer');
  const admin = db.accounts.find(a => a.role === 'admin');
  const totalCreditsInCirculation = db.accounts.reduce((s, a) => s + (a.credits || 0), 0);
  const creatorsCreditsTotal = creators.reduce((s, a) => s + (a.credits || 0), 0);
  const viewersCreditsTotal = viewers.reduce((s, a) => s + (a.credits || 0), 0);
  res.json({
    creators: creators.length,
    viewers: viewers.length,
    blocked: db.accounts.filter(a => a.status === 'blocked').length,
    pending: db.accounts.filter(a => a.status === 'pending').length,
    activeCampaigns: db.campaigns.filter(c => c.status === 'active').length,
    finishedCampaigns: db.campaigns.filter(c => c.status === 'finished').length,
    pendingPurchases: db.purchases.filter(p => p.status === 'pending').length,
    pendingWithdrawals: db.withdrawals.filter(w => w.status === 'pending').length,
    pendingDonations: db.donations.filter(d => d.status === 'pending').length,
    pendingVerify: db.verifyRequests.length,
    unreadMessages: db.messages.filter(m => m.sender === 'user' && !m.read).length,
    adminCredits: admin ? admin.credits : 0,
    totalCreditsInCirculation,
    creatorsCreditsTotal,
    viewersCreditsTotal
  });
});

// ---- Usuarios ----
router.get('/users', (req, res) => {
  const db = getDB();
  res.json({ accounts: db.accounts.map(a => ({ ...publicAccount(a), verifyCode: a.role === 'admin' ? undefined : a.verifyCode })) });
});

// ---- Detalle de un usuario: solo lectura para el admin (no puede editar datos del usuario) ----
router.get('/users/:id/detail', (req, res) => {
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada.' });
  const detail = { ...publicAccount(acc), verifyCode: acc.verifyCode };
  if (acc.role === 'creator') {
    detail.campaigns = db.campaigns.filter(c => c.creatorId === acc.id);
    detail.purchases = db.purchases.filter(p => p.creatorId === acc.id);
    detail.donationsSent = (db.donations || []).filter(d => d.fromId === acc.id);
  } else if (acc.role === 'viewer') {
    detail.participations = db.participations.filter(p => p.viewerId === acc.id);
    detail.withdrawals = db.withdrawals.filter(w => w.viewerId === acc.id);
    detail.donationsSent = (db.donations || []).filter(d => d.fromId === acc.id);
  }
  res.json({ account: detail });
});

router.put('/users/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected', 'blocked'].includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada.' });
  acc.status = status;
  saveDB(db);
  res.json({ ok: true });
});

router.put('/users/:id/credits', (req, res) => {
  const { amount } = req.body || {};
  const db = getDB();
  const acc = db.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada.' });
  const val = Number(amount);
  if (!val) return res.json({ ok: true });
  if (val > 0) creditAccount(acc, val, 'Ajuste manual del administrador');
  else { acc.credits = (acc.credits || 0) + val; acc.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'out', amount: Math.abs(val), detail: 'Ajuste manual del administrador' }); }
  saveDB(db);
  res.json({ ok: true, credits: acc.credits });
});

router.delete('/users/:id', (req, res) => {
  const db = getDB();
  db.accounts = db.accounts.filter(a => a.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---- Campañas ----
router.get('/campaigns', (req, res) => {
  const db = getDB();
  const list = db.campaigns.map(c => ({ ...c, creatorName: (db.accounts.find(a => a.id === c.creatorId) || {}).visibleUser }));
  res.json({ campaigns: list });
});
router.delete('/campaigns/:id', (req, res) => {
  const db = getDB();
  db.campaigns = db.campaigns.filter(c => c.id !== req.params.id);
  db.participations = db.participations.filter(p => p.campaignId !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---- Pagos pendientes (compras de créditos) ----
router.get('/purchases', (req, res) => {
  const db = getDB();
  purgeExpired(db); saveDB(db);
  const list = db.purchases.map(p => ({ ...p, creatorName: (db.accounts.find(a => a.id === p.creatorId) || {}).visibleUser }));
  res.json({ purchases: list });
});
router.put('/purchases/:id/approve', (req, res) => {
  const db = getDB();
  const p = db.purchases.find(x => x.id === req.params.id);
  if (!p || p.status !== 'pending') return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
  const creator = db.accounts.find(a => a.id === p.creatorId);
  const admin = db.accounts.find(a => a.role === 'admin');
  creditAccount(creator, p.credits, 'Compra de créditos aprobada');
  if (admin && p.taxCredits) creditAccount(admin, p.taxCredits, `Impuesto de compra (${db.settings.purchaseTaxPct}%)`);
  p.status = 'approved';
  saveDB(db);
  res.json({ ok: true });
});
router.put('/purchases/:id/reject', (req, res) => {
  const db = getDB();
  const p = db.purchases.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  p.status = 'rejected';
  saveDB(db);
  res.json({ ok: true });
});

// ---- Retiros ----
router.get('/withdrawals', (req, res) => {
  const db = getDB();
  const list = db.withdrawals.map(w => ({ ...w, viewerName: (db.accounts.find(a => a.id === w.viewerId) || {}).visibleUser }));
  res.json({ withdrawals: list });
});
router.put('/withdrawals/:id/approve', (req, res) => {
  const db = getDB();
  const w = db.withdrawals.find(x => x.id === req.params.id);
  if (!w || w.status !== 'pending') return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
  const admin = db.accounts.find(a => a.role === 'admin');
  const taxCredits = Math.round((w.credits - w.netCredits) * 100) / 100;
  if (admin && taxCredits) creditAccount(admin, taxCredits, `Impuesto de retiro (${db.settings.withdrawTaxPct}%)`);
  w.status = 'paid';
  saveDB(db);
  res.json({ ok: true });
});
router.put('/withdrawals/:id/reject', (req, res) => {
  const db = getDB();
  const w = db.withdrawals.find(x => x.id === req.params.id);
  if (!w || w.status !== 'pending') return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
  const viewer = db.accounts.find(a => a.id === w.viewerId);
  creditAccount(viewer, w.credits, 'Retiro rechazado — reembolso');
  w.status = 'rejected';
  saveDB(db);
  res.json({ ok: true });
});
// El alias/CBU no coincide con el nombre del titular: no se paga, y se
// devuelve el saldo con un 5% de penalización (según el aviso que ve el
// viewer al pedir el retiro).
router.put('/withdrawals/:id/reject-mismatch', (req, res) => {
  const db = getDB();
  const w = db.withdrawals.find(x => x.id === req.params.id);
  if (!w || w.status !== 'pending') return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
  const viewer = db.accounts.find(a => a.id === w.viewerId);
  const admin = db.accounts.find(a => a.role === 'admin');
  const penalty = Math.round(w.credits * 0.05 * 100) / 100;
  const refund = Math.round((w.credits - penalty) * 100) / 100;
  creditAccount(viewer, refund, 'Retiro rechazado (titular no coincide) — reembolso con 5% de penalización');
  if (admin && penalty) creditAccount(admin, penalty, 'Penalización por titular no coincidente (5%)');
  w.status = 'rejected';
  w.rejectReason = 'holder_mismatch';
  saveDB(db);
  res.json({ ok: true, refunded: refund, penalty });
});

// ---- Solicitudes de verificación ----
// El código queda fijo hasta ser validado; al tocar "Mandar código" la
// solicitud se borra de la cola (el admin ya se ocupó de avisarle al usuario).
router.get('/verify-requests', (req, res) => {
  const db = getDB();
  const list = db.verifyRequests.map(r => {
    const acc = db.accounts.find(a => a.id === r.accountId);
    const waitingMs = Date.now() - r.createdAt;
    return {
      ...r,
      userName: acc ? acc.visibleUser : '—',
      userEmail: acc ? acc.email : '—',
      code: acc ? acc.verifyCode : null,
      estimatedWaitMinutes: Math.max(0, 10 - Math.floor(waitingMs / 60000))
    };
  });
  res.json({ requests: list });
});
router.post('/verify-requests/:id/send', (req, res) => {
  const db = getDB();
  const reqItem = db.verifyRequests.find(r => r.id === req.params.id);
  if (!reqItem) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  db.verifyRequests = db.verifyRequests.filter(r => r.id !== reqItem.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---- Mensajes de soporte ----
router.get('/messages', (req, res) => {
  const db = getDB();
  const byUser = {};
  db.messages.forEach(m => {
    if (!byUser[m.accountId]) byUser[m.accountId] = { last: m.ts, unread: 0 };
    if (m.ts > byUser[m.accountId].last) byUser[m.accountId].last = m.ts;
    if (m.sender === 'user' && !m.read) byUser[m.accountId].unread++;
  });
  const convos = Object.keys(byUser).map(id => {
    const acc = db.accounts.find(a => a.id === id);
    return acc ? { accountId: id, name: acc.visibleUser, email: acc.email, role: acc.role, ...byUser[id] } : null;
  }).filter(Boolean).sort((a, b) => b.last - a.last);
  res.json({ conversations: convos });
});
router.get('/messages/:accountId', (req, res) => {
  const db = getDB();
  const thread = db.messages.filter(m => m.accountId === req.params.accountId).sort((a, b) => a.ts - b.ts);
  thread.forEach(m => { if (m.sender === 'user') m.read = true; });
  saveDB(db);
  res.json({ messages: thread });
});
router.post('/messages/:accountId/reply', (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Mensaje vacío.' });
  const db = getDB();
  db.messages.push({ id: uid('msg'), accountId: req.params.accountId, sender: 'admin', text: text.trim(), ts: Date.now(), read: true });
  saveDB(db);
  res.json({ ok: true });
});

// ---- Impuestos ----
router.get('/taxes', (req, res) => {
  const db = getDB();
  const admin = db.accounts.find(a => a.role === 'admin');
  const ledger = (admin.ledger || []).filter(l => l.type === 'in' && l.detail.startsWith('Impuesto'));
  const purchaseTax = ledger.filter(l => l.detail.includes('compra')).reduce((s, l) => s + l.amount, 0);
  const withdrawTax = ledger.filter(l => l.detail.includes('retiro')).reduce((s, l) => s + l.amount, 0);
  const netCredits = purchaseTax + withdrawTax;
  const paidWithdrawals = db.withdrawals.filter(w => w.status === 'paid');
  const totalPaidOutUsd = paidWithdrawals.reduce((s, w) => s + w.usd, 0);
  const approvedPurchasesUsd = db.purchases.filter(p => p.status === 'approved').reduce((s, p) => s + p.usd, 0);
  res.json({
    purchaseTaxCredits: purchaseTax,
    withdrawTaxCredits: withdrawTax,
    netCredits,
    netUsd: Number((netCredits * db.settings.creditToUsd).toFixed(2)),
    netArs: Math.round(netCredits * db.settings.creditToUsd * db.settings.usdRate),
    totalPaidOutUsd: Number(totalPaidOutUsd.toFixed(2)),
    approvedPurchasesUsd: Number(approvedPurchasesUsd.toFixed(2)),
    adminCreditsBalance: admin.credits,
    creditToUsd: db.settings.creditToUsd,
    usdRate: db.settings.usdRate
  });
});

// ---- Configuración ----
router.get('/settings', (req, res) => {
  const db = getDB();
  res.json({ settings: db.settings });
});
router.put('/settings', (req, res) => {
  const db = getDB();
  Object.assign(db.settings, req.body || {});
  saveDB(db);
  res.json({ ok: true, settings: db.settings });
});

// ---- Reiniciar sistema ----
router.post('/reset', (req, res) => {
  const { password } = req.body || {};
  const db = getDB();
  const admin = db.accounts.find(a => a.id === req.account.id);
  if (!checkPassword(password || '', admin.passwordHash)) return res.status(401).json({ error: 'Contraseña incorrecta.' });

  const fresh = defaultDB();
  fresh.accounts = [{ ...admin, credits: 0, ledger: [] }];
  fresh.settings = db.settings; // la configuración del sitio no se borra, solo los datos operativos
  saveDB(fresh);
  res.json({ ok: true, message: 'Sistema reiniciado.' });
});

// ---- Donaciones (de creadores a viewers, o de un viewer a los demás viewers) ----
router.get('/donations', (req, res) => {
  const db = getDB();
  const list = db.donations.map(d => {
    const from = db.accounts.find(a => a.id === d.fromId || a.id === d.creatorId);
    const recipientCount = d.fromRole === 'creator' || d.creatorId
      ? db.accounts.filter(a => a.role === 'viewer' && a.status === 'approved').length
      : db.accounts.filter(a => a.role === 'viewer' && a.status === 'approved' && a.id !== d.fromId).length;
    return {
      ...d,
      fromName: from ? from.visibleUser : '—',
      fromRole: d.fromRole || 'creator',
      previewPerRecipient: recipientCount > 0 ? Math.floor(d.credits / recipientCount) : 0,
      recipientCount
    };
  });
  res.json({ donations: list });
});
router.put('/donations/:id/approve', (req, res) => {
  const db = getDB();
  const d = db.donations.find(x => x.id === req.params.id);
  if (!d || d.status !== 'pending') return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
  const fromId = d.fromId || d.creatorId;
  const fromRole = d.fromRole || 'creator';
  const recipients = fromRole === 'creator'
    ? db.accounts.filter(a => a.role === 'viewer' && a.status === 'approved')
    : db.accounts.filter(a => a.role === 'viewer' && a.status === 'approved' && a.id !== fromId);
  if (recipients.length === 0) return res.status(400).json({ error: 'No hay viewers para repartir la donación.' });
  const perRecipient = Math.floor(d.credits / recipients.length);
  if (perRecipient < 1) return res.status(400).json({ error: 'El monto donado es muy bajo para repartir entre todos.' });
  const from = db.accounts.find(a => a.id === fromId);
  recipients.forEach(v => {
    v.credits = Math.round((v.credits + perRecipient) * 100000) / 100000;
    v.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'in', amount: perRecipient, detail: `Donación de ${from ? from.visibleUser : 'un usuario'}` });
  });
  d.status = 'approved';
  d.perRecipientAmount = perRecipient;
  saveDB(db);
  res.json({ ok: true });
});
router.put('/donations/:id/reject', (req, res) => {
  const db = getDB();
  const d = db.donations.find(x => x.id === req.params.id);
  if (!d || d.status !== 'pending') return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
  const from = db.accounts.find(a => a.id === (d.fromId || d.creatorId));
  if (from) {
    from.credits = Math.round((from.credits + d.credits) * 100000) / 100000;
    from.ledger.push({ id: uid('ldg'), ts: Date.now(), type: 'in', amount: d.credits, detail: 'Donación rechazada — reembolso' });
  }
  d.status = 'rejected';
  saveDB(db);
  res.json({ ok: true });
});

module.exports = router;
