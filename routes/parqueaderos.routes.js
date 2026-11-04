const express = require("express");
const db = require("../db");
const roles = require("../middleware/roles");
const { error } = require("../utils");

const router = express.Router();

// GET /api/v1/parqueaderos/:id/resumen  ->  todos los roles
router.get("/:id/resumen", (req, res) => {
  const p = db.prepare("SELECT * FROM parqueadero WHERE id = ?").get(req.params.id);
  if (!p) return error(res, 404, "Parqueadero no existe");

  const filas = db.prepare(
    "SELECT estado, COUNT(*) n FROM cupo WHERE parqueadero_id = ? GROUP BY estado"
  ).all(p.id);
  const cuenta = Object.fromEntries(filas.map((f) => [f.estado, f.n]));
  const libres = cuenta.LIBRE || 0;
  const ocupados = cuenta.OCUPADO || 0;
  const mantenimiento = cuenta.MANTENIMIENTO || 0;
  const total = libres + ocupados + mantenimiento;

  res.json({
    parqueaderoId: p.id, nombre: p.nombre, direccion: p.direccion, total, libres, ocupados, mantenimiento,
    porcentajeOcupacion: total ? Math.round((ocupados / total) * 100) : 0,
  });
});

// PUT /api/v1/parqueaderos/:id  ->  solo ADMIN   body: { nombre, direccion }
router.put("/:id", roles("ADMIN"), (req, res) => {
  const nombre = String(req.body?.nombre || "").trim();
  const direccion = String(req.body?.direccion || "").trim();
  if (nombre.length < 2 || nombre.length > 60) return error(res, 400, "Nombre inválido (2 a 60 caracteres)");
  if (direccion.length > 100) return error(res, 400, "Dirección demasiado larga");
  const r = db.prepare("UPDATE parqueadero SET nombre = ?, direccion = ? WHERE id = ?").run(nombre, direccion, req.params.id);
  if (!r.changes) return error(res, 404, "Parqueadero no existe");
  res.json({ id: Number(req.params.id), nombre, direccion });
});

module.exports = router;
