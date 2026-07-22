// server/recaptcha.js
async function verifyCaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return true; // no configurado: no bloqueamos
  if (!token) return false;
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`
    });
    const data = await res.json();
    return !!data.success;
  } catch (e) {
    return true; // si Google falla, no tumbamos el registro/login por eso
  }
}
module.exports = { verifyCaptcha };
