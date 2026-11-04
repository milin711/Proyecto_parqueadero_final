const express = require("express");
const db = require("../db");
const roles = require("../middleware/roles");
const { error, getTarifas, minutosEntre, calcularValor, normalizarPlaca } = require("../utils");

const router = express.Router();
const STAFF = roles("ADMIN", "OPERADOR");

// POST /api/v1/registros/entrada  ->  todos los roles (queda ligado al usuario que lo registra)
router.post("/entrada", (req, res) => {
  const tarifas = getTarifas();
  const placa = normalizarPlaca(req.body?.placa);
  const { tipoVehiculo } = req.body || {};
  const cupoId = Number(req.body?.cupoId);
  if (!/^[A-Z0-9]{5,7}$/.test(placa)) return error(res, 400, "Placa inválida");
  if (!(tipoVehiculo in tarifas)) return error(res, 400, "tipoVehiculo inválido");
  if (!cupoId) return error(res, 400, "cupoId es obligatorio");

  const crear = db.transaction(() => {
    const cupo = db.prepare("SELECT * FROM cupo WHERE id = ?").get(cupoId);
    if (!cupo) return { status: 404, msg: "Cupo no existe" };
    if (cupo.estado !== "LIBRE") return { status: 409, msg: "El cupo no está disponible" };

    const dentro = db.prepare(
      "SELECT id FROM registro WHERE placa = ? AND estado = 'EN_CURSO'"
    ).get(placa);
    if (dentro) return { status: 409, msg: "La placa ya está registrada dentro" };

    const horaEntrada = new Date().toISOString();
    const info = db.prepare(
      "INSERT INTO registro (cupo_id, placa, tipo_vehiculo, hora_entrada, usuario_id) VALUES (?,?,?,?,?)"
    ).run(cupo.id, placa, tipoVehiculo, horaEntrada, req.user.id);
    db.prepare("UPDATE cupo SET estado = 'OCUPADO' WHERE id = ?").run(cupo.id);

    return {
      ok: { registroId: info.lastInsertRowid, placa, cupo: cupo.codigo, horaEntrada, estado: "EN_CURSO" },
    };
  });

  const r = crear();
  if (r.ok) return res.status(201).json(r.ok);
  error(res, r.status, r.msg);
});

// GET /api/v1/registros/mios  ->  vehículos del usuario: tiempo y valor a pagar en este instante
router.get("/mios", (req, res) => {
  const tarifas = getTarifas();
  const ahora = new Date().toISOString();
  const activos = db.prepare(`
    SELECT r.*, c.codigo FROM registro r JOIN cupo c ON c.id = r.cupo_id
    WHERE r.usuario_id = ? AND r.estado = 'EN_CURSO' ORDER BY r.hora_entrada DESC`).all(req.user.id);
  const recientes = db.prepare(`
    SELECT r.*, c.codigo FROM registro r JOIN cupo c ON c.id = r.cupo_id
    WHERE r.usuario_id = ? AND r.estado = 'FINALIZADO' ORDER BY r.hora_salida DESC LIMIT 5`).all(req.user.id);

  res.json({
    activos: activos.map((r) => {
      const min = minutosEntre(r.hora_entrada, ahora);
      return {
        registroId: r.id, placa: r.placa, cupo: r.codigo, tipoVehiculo: r.tipo_vehiculo,
        horaEntrada: r.hora_entrada, tiempoTranscurridoMin: min,
        tarifaHora: tarifas[r.tipo_vehiculo] ?? tarifas.OTRO,
        valorEstimado: calcularValor(min, r.tipo_vehiculo, tarifas),
      };
    }),
    recientes: recientes.map((r) => ({
      registroId: r.id, placa: r.placa, cupo: r.codigo, horaEntrada: r.hora_entrada,
      horaSalida: r.hora_salida, valorTotal: r.valor_total,
    })),
  });
});

// GET /api/v1/registros/activo/:placa  ->  ADMIN y OPERADOR
router.get("/activo/:placa", STAFF, (req, res) => {
  const placa = normalizarPlaca(req.params.placa);
  const r = db.prepare(`
    SELECT r.*, c.codigo FROM registro r JOIN cupo c ON c.id = r.cupo_id
    WHERE r.placa = ? AND r.estado = 'EN_CURSO'`).get(placa);
  if (!r) return error(res, 404, "La placa no tiene registro abierto");

  const min = minutosEntre(r.hora_entrada, new Date().toISOString());
  res.json({
    registroId: r.id, placa: r.placa, cupo: r.codigo, horaEntrada: r.hora_entrada,
    tiempoTranscurridoMin: min, valorEstimado: calcularValor(min, r.tipo_vehiculo),
  });
});

// PATCH /api/v1/registros/:id/salida  ->  ADMIN y OPERADOR
router.patch("/:id/salida", STAFF, (req, res) => {
  const metodoPago = req.body?.metodoPago ?? null;

  const cerrar = db.transaction(() => {
    const r = db.prepare(`
      SELECT r.*, c.codigo FROM registro r JOIN cupo c ON c.id = r.cupo_id
      WHERE r.id = ?`).get(req.params.id);
    if (!r) return { status: 404, msg: "Registro no existe" };
    if (r.estado === "FINALIZADO") return { status: 409, msg: "El registro ya fue finalizado" };

    const horaSalida = new Date().toISOString();
    const min = minutosEntre(r.hora_entrada, horaSalida);
    const valor = calcularValor(min, r.tipo_vehiculo);

    db.prepare(`UPDATE registro SET hora_salida = ?, valor_total = ?, metodo_pago = ?,
                estado = 'FINALIZADO' WHERE id = ?`).run(horaSalida, valor, metodoPago, r.id);
    db.prepare("UPDATE cupo SET estado = 'LIBRE' WHERE id = ?").run(r.cupo_id);

    return {
      ok: {
        registroId: r.id, placa: r.placa, cupo: r.codigo, horaEntrada: r.hora_entrada,
        horaSalida, tiempoTotalMin: min, valorTotal: valor, estado: "FINALIZADO",
      },
    };
  });

  const r = cerrar();
  if (r.ok) return res.json(r.ok);
  error(res, r.status, r.msg);
});

// GET /api/v1/registros  ->  ADMIN y OPERADOR
router.get("/", STAFF, (req, res) => {
  const { placa, estado, desde, hasta } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 10));
  const where = [];
  const params = [];

  if (placa) { where.push("r.placa LIKE ?"); params.push(`%${normalizarPlaca(placa)}%`); }
  if (estado) {
    if (!["EN_CURSO", "FINALIZADO"].includes(estado)) return error(res, 400, "estado inválido");
    where.push("r.estado = ?"); params.push(estado);
  }
  if (desde) { where.push("r.hora_entrada >= ?"); params.push(new Date(desde).toISOString()); }
  if (hasta) {
    const h = new Date(hasta); h.setHours(23, 59, 59, 999);
    where.push("r.hora_entrada <= ?"); params.push(h.toISOString());
  }

  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const totalItems = db.prepare(`SELECT COUNT(*) n FROM registro r ${w}`).get(...params).n;
  const filas = db.prepare(`
    SELECT r.*, c.codigo FROM registro r JOIN cupo c ON c.id = r.cupo_id
    ${w} ORDER BY r.hora_entrada DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size);

  res.json({
    items: filas.map((r) => ({
      registroId: r.id, placa: r.placa, cupo: r.codigo, tipoVehiculo: r.tipo_vehiculo, horaEntrada: r.hora_entrada,
      horaSalida: r.hora_salida, valorTotal: r.valor_total, estado: r.estado,
    })),
    page, size, totalItems,
  });
});

module.exports = router;
