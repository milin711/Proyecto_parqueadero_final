const express = require("express");
const db = require("../db");
const roles = require("../middleware/roles");
const { error } = require("../utils");

const router = express.Router();
const STAFF = roles("ADMIN", "OPERADOR");
const esPersona = (req) => req.user.rol === "CLIENTE"; // las personas no ven placas de otros
const TIPOS = ["CARRO", "MOTO", "OTRO"];

const cupoDTO = (c, ocultarPlaca) => ({
  id: c.id, codigo: c.codigo, piso: c.piso, estado: c.estado, tipo: c.tipo,
  placaActual: ocultarPlaca ? null : c.placa_actual ?? null,
});

// GET /api/v1/cupos  ->  todos los roles
router.get("/", (req, res) => {
  const { parqueaderoId, estado, piso } = req.query;
  const where = [];
  const params = [];

  if (parqueaderoId) { where.push("c.parqueadero_id = ?"); params.push(Number(parqueaderoId)); }
  if (estado) {
    if (!["LIBRE", "OCUPADO", "MANTENIMIENTO"].includes(estado))
      return error(res, 400, "estado inválido");
    where.push("c.estado = ?"); params.push(estado);
  }
  if (piso) { where.push("c.piso = ?"); params.push(Number(piso)); }

  const sql = `
    SELECT c.*, r.placa AS placa_actual
    FROM cupo c
    LEFT JOIN registro r ON r.cupo_id = c.id AND r.estado = 'EN_CURSO'
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY c.piso, c.codigo`;
  res.json(db.prepare(sql).all(...params).map((c) => cupoDTO(c, esPersona(req))));
});

// POST /api/v1/cupos  ->  solo ADMIN   body: { codigo, piso, tipo, parqueaderoId? }
router.post("/", roles("ADMIN"), (req, res) => {
  const codigo = String(req.body?.codigo || "").trim().toUpperCase().replace(/\s+/g, " ");
  const piso = Number(req.body?.piso ?? 1);
  const tipo = String(req.body?.tipo || "CARRO").toUpperCase();
  const parqueaderoId = Number(req.body?.parqueaderoId || 1);
  if (!/^[A-Z0-9][A-Z0-9 -]{0,7}$/.test(codigo)) return error(res, 400, "Código inválido (1 a 8 letras o números, ej: CR 51)");
  if (!Number.isInteger(piso) || piso < 1 || piso > 20) return error(res, 400, "Piso inválido");
  if (!TIPOS.includes(tipo)) return error(res, 400, "Tipo de cupo inválido");
  if (!db.prepare("SELECT id FROM parqueadero WHERE id = ?").get(parqueaderoId)) return error(res, 404, "Parqueadero no existe");
  if (db.prepare("SELECT id FROM cupo WHERE parqueadero_id = ? AND codigo = ?").get(parqueaderoId, codigo))
    return error(res, 409, "Ya existe un cupo con ese código");

  const info = db.prepare("INSERT INTO cupo (parqueadero_id, codigo, piso, tipo) VALUES (?,?,?,?)")
    .run(parqueaderoId, codigo, piso, tipo);
  res.status(201).json({ id: info.lastInsertRowid, codigo, piso, tipo, estado: "LIBRE" });
});

// GET /api/v1/cupos/:id  ->  todos los roles (la placa solo la ve el personal)
router.get("/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM cupo WHERE id = ?").get(req.params.id);
  if (!c) return error(res, 404, "Cupo no existe");

  const r = esPersona(req) ? null : db.prepare(
    "SELECT id, placa, hora_entrada FROM registro WHERE cupo_id = ? AND estado = 'EN_CURSO'"
  ).get(c.id);

  res.json({
    id: c.id, codigo: c.codigo, piso: c.piso, estado: c.estado, tipo: c.tipo,
    registroActual: r ? { id: r.id, placa: r.placa, horaEntrada: r.hora_entrada } : null,
  });
});

// PUT /api/v1/cupos/:id  ->  solo ADMIN   body: { codigo, piso, tipo }
router.put("/:id", roles("ADMIN"), (req, res) => {
  const c = db.prepare("SELECT * FROM cupo WHERE id = ?").get(req.params.id);
  if (!c) return error(res, 404, "Cupo no existe");
  if (c.estado === "OCUPADO") return error(res, 409, "No puedes editar un cupo ocupado");

  const codigo = String(req.body?.codigo ?? c.codigo).trim().toUpperCase().replace(/\s+/g, " ");
  const piso = Number(req.body?.piso ?? c.piso);
  const tipo = String(req.body?.tipo ?? c.tipo).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{0,7}$/.test(codigo)) return error(res, 400, "Código inválido (1 a 8 letras o números, ej: CR 51)");
  if (!Number.isInteger(piso) || piso < 1 || piso > 20) return error(res, 400, "Piso inválido");
  if (!TIPOS.includes(tipo)) return error(res, 400, "Tipo de cupo inválido");
  if (db.prepare("SELECT id FROM cupo WHERE parqueadero_id = ? AND codigo = ? AND id <> ?").get(c.parqueadero_id, codigo, c.id))
    return error(res, 409, "Ya existe un cupo con ese código");

  db.prepare("UPDATE cupo SET codigo = ?, piso = ?, tipo = ? WHERE id = ?").run(codigo, piso, tipo, c.id);
  res.json({ id: c.id, codigo, piso, tipo, estado: c.estado });
});

// DELETE /api/v1/cupos/:id  ->  solo ADMIN (si nunca tuvo registros)
router.delete("/:id", roles("ADMIN"), (req, res) => {
  const c = db.prepare("SELECT * FROM cupo WHERE id = ?").get(req.params.id);
  if (!c) return error(res, 404, "Cupo no existe");
  if (c.estado === "OCUPADO") return error(res, 409, "El cupo está ocupado");
  if (db.prepare("SELECT 1 FROM registro WHERE cupo_id = ? LIMIT 1").get(c.id))
    return error(res, 409, "Este cupo tiene historial y no se puede eliminar. Ponlo en mantenimiento.");
  db.prepare("DELETE FROM cupo WHERE id = ?").run(c.id);
  res.json({ id: c.id, eliminado: true });
});

// PATCH /api/v1/cupos/:id/estado  ->  ADMIN y OPERADOR
router.patch("/:id/estado", STAFF, (req, res) => {
  const { estado } = req.body || {};
  if (!["LIBRE", "MANTENIMIENTO"].includes(estado))
    return error(res, 400, "estado debe ser LIBRE o MANTENIMIENTO");

  const c = db.prepare("SELECT * FROM cupo WHERE id = ?").get(req.params.id);
  if (!c) return error(res, 404, "Cupo no existe");
  if (c.estado === "OCUPADO") return error(res, 409, "El cupo está ocupado");

  db.prepare("UPDATE cupo SET estado = ? WHERE id = ?").run(estado, c.id);
  res.json({ id: c.id, codigo: c.codigo, estado });
});

module.exports = router;
