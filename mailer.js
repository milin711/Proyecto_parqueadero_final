const nodemailer = require("nodemailer");
const { SMTP } = require("./config");

const transporter = SMTP.host && SMTP.user
  ? nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, auth: { user: SMTP.user, pass: SMTP.pass } })
  : null;

const configurado = () => !!transporter;

// Envía un correo. Sin SMTP configurado imprime el mensaje en la consola (modo pruebas).
async function enviar({ para, asunto, texto, html }) {
  if (!transporter) {
    console.log(`\n[CORREO SIMULADO] Para: ${para}\nAsunto: ${asunto}\n${texto}\n(Configura SMTP en el archivo .env para enviar correos reales)\n`);
    return { simulado: true };
  }
  await transporter.sendMail({ from: SMTP.from, to: para, subject: asunto, text: texto, html });
  return { simulado: false };
}

const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plantillaCodigo = (nombre, codigo, minutos) => ({
  asunto: `Tu código de recuperación: ${codigo}`,
  texto: `Hola ${nombre},\n\nTu código para restablecer la contraseña de ParkControl es: ${codigo}\nEs válido por ${minutos} minutos.\n\nSi no lo solicitaste, ignora este mensaje.`,
  html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;border:1px solid #e1e4e8;border-radius:16px;overflow:hidden">
    <div style="background:#b3202e;color:#fff;padding:20px 24px"><b style="font-size:20px">ParkControl</b><br><span style="opacity:.9">Recuperación de contraseña</span></div>
    <div style="padding:24px;color:#1f2328"><p>Hola <b>${escHtml(nombre)}</b>,</p><p>Usa este código para crear una contraseña nueva:</p>
    <p style="font-size:34px;letter-spacing:8px;font-weight:700;text-align:center;background:#f5f6f7;border-radius:12px;padding:14px;margin:18px 0">${codigo}</p>
    <p style="color:#5f6672;font-size:13px">Es válido por ${minutos} minutos. Si no lo solicitaste, ignora este mensaje: tu contraseña no cambiará.</p></div></div>`,
});

module.exports = { enviar, configurado, plantillaCodigo };
