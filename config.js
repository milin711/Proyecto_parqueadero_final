const fs = require("fs");
const path = require("path");

// Lee un archivo .env (si existe) para no tener que escribir variables en la terminal.
// Formato:  CLAVE=valor   (líneas que empiezan con # son comentarios)
try {
  for (const l of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* sin .env: se usan los valores por defecto */ }

module.exports = {
  PORT: process.env.PORT || 3000,
  SECRET: process.env.JWT_SECRET || "cambia-esta-clave",
  EXPIRA_SEG: 8 * 60 * 60,
  // Tarifa inicial por hora o fracción (COP). Luego el ADMIN las edita desde la app.
  TARIFA_HORA: { CARRO: 2000, MOTO: 1000, OTRO: 500 },

  // Correo saliente (recuperación de contraseña). Si SMTP_HOST/SMTP_USER están vacíos,
  // el código se muestra en la consola del servidor en lugar de enviarse (modo pruebas).
  SMTP: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || (process.env.SMTP_USER ? `ParkControl <${process.env.SMTP_USER}>` : "ParkControl"),
  },
  CODIGO_MINUTOS: 15, // vigencia del código de recuperación
};
