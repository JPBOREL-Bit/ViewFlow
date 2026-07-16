// server/util.js
const crypto = require('crypto');

function uid(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function genVerifyCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
}

module.exports = { uid, genVerifyCode };
