// server/mailer.js
// Envío automático de códigos de verificación por Gmail. Si el admin no
// configuró las variables de entorno GMAIL_USER / GMAIL_APP_PASSWORD, esta
// función simplemente no manda nada y el código sigue disponible para que
// el admin lo mande a mano desde el panel (como hasta ahora) — nunca rompe
// el flujo, solo lo hace automático cuando está configurado.

let transporter = null;
let triedSetup = false;

function getTransporter() {
  if (triedSetup) return transporter;
  triedSetup = true;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  } catch (e) {
    console.warn('[viewflow] nodemailer no está instalado — el envío automático de códigos queda desactivado.');
    transporter = null;
  }
  return transporter;
}

async function trySendVerificationEmail(toEmail, code) {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({
      from: `ViewFlow <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: 'Tu código de verificación de ViewFlow',
      text: `Tu código de verificación es: ${code}\n\nDura 10 minutos. Si no lo pediste vos, ignorá este mensaje.`,
      html: `<div style="font-family:sans-serif;"><p>Tu código de verificación es:</p><p style="font-size:28px; font-weight:700; letter-spacing:4px;">${code}</p><p style="color:#666; font-size:13px;">Dura 10 minutos. Si no lo pediste vos, ignorá este mensaje.</p></div>`
    });
    return true;
  } catch (e) {
    console.warn('[viewflow] Falló el envío automático de email:', e.message);
    return false;
  }
}

module.exports = { trySendVerificationEmail };
