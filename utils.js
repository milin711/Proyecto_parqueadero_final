const db = require("./db");

const error = (res, status, mensaje) => res.status(status).json({ error: mensaje });

// Tarifas vigentes (editables por el ADMIN) -> { CARRO: 2000, MOTO: 1000, OTRO: 500 }
const getTarifas = () =>
  Object.fromEntries(db.prepare("SELECT tipo, valor_hora v FROM tarifa").all().map((r) => [r.tipo, r.v]));

const minutosEntre = (desdeISO, hastaISO) =>
  Math.max(1, Math.ceil((new Date(hastaISO) - new Date(desdeISO)) / 60000));

// Por hora o fracción
const calcularValor = (minutos, tipo, tarifas = getTarifas()) =>
  Math.ceil(minutos / 60) * (tarifas[tipo] ?? tarifas.OTRO);

const normalizarPlaca = (p) => String(p || "").trim().toUpperCase();

module.exports = { error, getTarifas, minutosEntre, calcularValor, normalizarPlaca };
