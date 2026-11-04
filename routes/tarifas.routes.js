const express = require("express");
const db = require("../db");
const roles = require("../middleware/roles");
const { error, getTarifas } = require("../utils");

const router = express.Router();

// GET /api/v1/tarifas  ->  todos los roles
router.get("/", (req, res) => res.json(getTarifas()));

// PUT /api/v1/tarifas/:tipo  ->  solo ADMIN   body: { valorHora }
router.put("/:tipo", roles("ADMIN"), (req, res) => {
  const tipo = String(req.params.tipo).toUpperCase();
  const valor = Number(req.body?.valorHora);
  if (!(tipo in getTarifas())) return error(res, 404, "Tipo de vehículo no existe");
  if (!Number.isInteger(valor) || valor < 0 || valor > 1000000)
    return error(res, 400, "valorHora debe ser un número entero entre 0 y 1.000.000");
  db.prepare("UPDATE tarifa SET valor_hora = ? WHERE tipo = ?").run(valor, tipo);
  res.json({ tipo, valorHora: valor });
});

module.exports = router;
