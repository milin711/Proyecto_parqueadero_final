const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");
const auth = require("../middleware/auth");
const { SECRET, EXPIRA_SEG, CODIGO_MINUTOS } = require("../config");
const { enviar, plantillaCodigo } = require("../mailer");
const { error } = require("../utils");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normEmail = (e) => String(e || "").trim().toLowerCase();

const sesion = (u) => ({
  token: jwt.sign({ id: u.id, rol: u.rol }, SECRET, { expiresIn: EXPIRA_SEG }),
  expiraEn: EXPIRA_SEG,
  usuario: { id: u.id, nombre: u.nombre, rol: u.rol },
});

// POST /api/v1/auth/login
router.post("/login", (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) return error(res, 400, "usuario y password son obligatorios");

  const u = db.prepare("SELECT * FROM usuario WHERE usuario = ? COLLATE NOCASE").get(String(usuario).trim());
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return error(res, 401, "Credenciales inválidas");
  res.json(sesion(u));
});

// POST /api/v1/auth/registro  ->  crea una cuenta de persona (rol CLIENTE); luego debe iniciar sesión
router.post("/registro", (req, res) => {
  const nombre = String(req.body?.nombre || "").trim();
  const usuario = String(req.body?.usuario || "").trim().toLowerCase();
  const email = normEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (nombre.length < 2 || nombre.length > 60) return error(res, 400, "Escribe tu nombre (2 a 60 letras)");
  if (!/^[a-z0-9_.]{3,20}$/.test(usuario))
    return error(res, 400, "El usuario debe tener de 3 a 20 caracteres: letras, números, punto o guion bajo");
  if (!EMAIL_RE.test(email) || email.length > 100) return error(res, 400, "Escribe un correo válido");
  if (password.length < 6) return error(res, 400, "La contraseña debe tener al menos 6 caracteres");
  if (db.prepare("SELECT id FROM usuario WHERE usuario = ?").get(usuario))
    return error(res, 409, "Ese usuario ya existe, elige otro");
  if (db.prepare("SELECT id FROM usuario WHERE email = ? COLLATE NOCASE").get(email))
    return error(res, 409, "Ese correo ya está registrado");

  const info = db.prepare("INSERT INTO usuario (nombre, usuario, email, password_hash, rol) VALUES (?,?,?,?,'CLIENTE')")
    .run(nombre, usuario, email, bcrypt.hashSync(password, 10));
  res.status(201).json({ mensaje: "Cuenta creada. Ya puedes iniciar sesión.", usuario: { id: info.lastInsertRowid, nombre, usuario } });
});

// ---------- Recuperación de contraseña por correo ----------

// POST /api/v1/auth/recuperar  { email }  ->  envía un código de 6 dígitos (siempre responde igual)
router.post("/recuperar", async (req, res) => {
  const email = normEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) return error(res, 400, "Escribe un correo válido");
  const generica = { mensaje: "Si el correo está registrado, te enviamos un código. Revisa tu bandeja (y el spam)." };

  try {
    const u = db.prepare("SELECT * FROM usuario WHERE email = ? COLLATE NOCASE").get(email);
    if (u) {
      const ultimo = db.prepare("SELECT creado_en FROM recuperacion WHERE usuario_id = ? ORDER BY id DESC LIMIT 1").get(u.id);
      const ultHora = db.prepare("SELECT COUNT(*) n FROM recuperacion WHERE usuario_id = ? AND creado_en > ?")
        .get(u.id, new Date(Date.now() - 3600e3).toISOString()).n;
      const muyPronto = ultimo && Date.now() - new Date(ultimo.creado_en) < 60e3; // 1 solicitud por minuto
      if (!muyPronto && ultHora < 5) {                                              // y máximo 5 por hora
        const codigo = String(crypto.randomInt(100000, 1000000));
        db.prepare("DELETE FROM recuperacion WHERE creado_en < ?").run(new Date(Date.now() - 864e5).toISOString()); // limpia códigos viejos
        db.prepare("INSERT INTO recuperacion (usuario_id, codigo_hash, expira_en, creado_en) VALUES (?,?,?,?)")
          .run(u.id, bcrypt.hashSync(codigo, 8), new Date(Date.now() + CODIGO_MINUTOS * 60e3).toISOString(), new Date().toISOString());
        await enviar({ para: u.email, ...plantillaCodigo(u.nombre, codigo, CODIGO_MINUTOS) });
      }
    }
  } catch (e) {
    console.error("No se pudo enviar el correo de recuperación:", e.message); // no se revela al cliente
  }
  res.json(generica);
});

// POST /api/v1/auth/restablecer  { email, codigo, password }  ->  cambia la contraseña
router.post("/restablecer", (req, res) => {
  const email = normEmail(req.body?.email);
  const codigo = String(req.body?.codigo || "").trim();
  const password = String(req.body?.password || "");
  if (password.length < 6) return error(res, 400, "La contraseña debe tener al menos 6 caracteres");
  const invalido = () => error(res, 400, "Código inválido o vencido");

  const u = db.prepare("SELECT * FROM usuario WHERE email = ? COLLATE NOCASE").get(email);
  const r = u && db.prepare("SELECT * FROM recuperacion WHERE usuario_id = ? ORDER BY id DESC LIMIT 1").get(u.id);
  if (!r || r.intentos >= 5 || new Date(r.expira_en) < new Date()) return invalido();

  if (!/^\d{6}$/.test(codigo) || !bcrypt.compareSync(codigo, r.codigo_hash)) {
    db.prepare("UPDATE recuperacion SET intentos = intentos + 1 WHERE id = ?").run(r.id);
    return invalido();
  }
  db.transaction(() => {
    db.prepare("UPDATE usuario SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), u.id);
    db.prepare("DELETE FROM recuperacion WHERE usuario_id = ?").run(u.id); // el código sirve una sola vez
  })();
  res.json({ mensaje: "Contraseña actualizada. Ya puedes iniciar sesión." });
});

// ---------- Correo de la cuenta (para poder recuperar la contraseña) ----------

// GET /api/v1/auth/yo  ->  datos de mi cuenta
router.get("/yo", auth, (req, res) => {
  const u = db.prepare("SELECT id, nombre, usuario, email, rol FROM usuario WHERE id = ?").get(req.user.id);
  if (!u) return error(res, 404, "Usuario no existe");
  res.json(u);
});

// PUT /api/v1/auth/correo  { email }  ->  guarda o cambia mi correo
router.put("/correo", auth, (req, res) => {
  const email = normEmail(req.body?.email);
  if (!EMAIL_RE.test(email) || email.length > 100) return error(res, 400, "Escribe un correo válido");
  if (db.prepare("SELECT id FROM usuario WHERE email = ? COLLATE NOCASE AND id <> ?").get(email, req.user.id))
    return error(res, 409, "Ese correo ya está en uso");
  db.prepare("UPDATE usuario SET email = ? WHERE id = ?").run(email, req.user.id);
  res.json({ email });
});

module.exports = router;
