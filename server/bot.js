// server/bot.js
function getSupportBotReply(text, acc, settings) {
  const t = text.toLowerCase();
  const has = (...words) => words.some(w => t.includes(w));

  if (has('crédito', 'creditos', 'credito', 'cuánto vale', 'cuanto vale')) {
    return `100 créditos equivalen a $1 USD. Al comprar créditos se suma un ${settings.purchaseTaxPct}% de impuesto sobre el total.`;
  }
  if (has('retir', 'cobrar', 'plata', 'dinero')) {
    return `Podés retirar tus créditos cuando quieras (mínimo ${settings.minWithdrawCredits} créditos). Se descuenta un ${settings.withdrawTaxPct}% de impuesto, y podés usar coma para los decimales.`;
  }
  if (has('código', 'codigo', 'verifica')) {
    return 'Para comprar o retirar necesitás un código de verificación. Pedilo por Gmail y vamos a mandártelo apenas el administrador lo confirme.';
  }
  if (has('tienda', 'comprar', 'paquete')) {
    return `En la Tienda podés elegir un paquete predefinido o uno personalizado. El precio ya incluye el impuesto. El mínimo de compra es 100 créditos, y la solicitud vence sola si no se paga en 1 hora.`;
  }
  if (has('campaña', 'campana', 'crear campaña', 'crear campana')) {
    return `Para crear una campaña necesitás mínimo ${settings.minCampaignViews} viewers y 30 segundos de duración.`;
  }
  if (has('tiktok')) {
    return 'ViewFlow trabaja solo con YouTube (videos normales y Shorts).';
  }
  if (has('contraseña', 'password', 'olvide', 'olvidé')) {
    return 'Podés cambiar tu contraseña desde tu Perfil, o usar "Olvidé mi contraseña" en la pantalla de inicio de sesión.';
  }
  if (has('segundo plano', 'pestaña', 'pestana', 'pausa')) {
    return 'El video se pausa automáticamente si salís de la pestaña, y no se puede pausar ni adelantar mientras participás. Tenés que quedarte mirando con la pestaña activa.';
  }
  if (has('hola', 'buenas', 'ayuda', 'consulta')) {
    return `Hola${acc.visibleUser ? ' ' + acc.visibleUser : ''}, soy el asistente de ViewFlow. Puedo responderte sobre créditos, retiros, la tienda, campañas y verificación. Para algo más específico, el administrador te responde por acá.`;
  }
  return null;
}

module.exports = { getSupportBotReply };
