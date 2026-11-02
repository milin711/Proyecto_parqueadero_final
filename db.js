const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { TARIFA_HORA } = require("./config");

const db = new Database("parqueadero.db");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS usuario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  usuario TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'OPERADOR'
);
CREATE TABLE IF NOT EXISTS parqueadero (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  direccion TEXT,
  capacidad_total INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cupo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parqueadero_id INTEGER NOT NULL REFERENCES parqueadero(id),
  codigo TEXT NOT NULL,
  piso INTEGER NOT NULL DEFAULT 1,
  tipo TEXT NOT NULL DEFAULT 'CARRO',
  estado TEXT NOT NULL DEFAULT 'LIBRE' CHECK (estado IN ('LIBRE','OCUPADO','MANTENIMIENTO')),
  UNIQUE (parqueadero_id, codigo)
);
CREATE TABLE IF NOT EXISTS registro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cupo_id INTEGER NOT NULL REFERENCES cupo(id),
  placa TEXT NOT NULL,
  tipo_vehiculo TEXT NOT NULL,
  hora_entrada TEXT NOT NULL,
  hora_salida TEXT,
  valor_total INTEGER,
  metodo_pago TEXT,
  estado TEXT NOT NULL DEFAULT 'EN_CURSO' CHECK (estado IN ('EN_CURSO','FINALIZADO'))
);
`);

// ---- Migraciones (seguras para bases de datos ya existentes) ----
if (!db.prepare("PRAGMA table_info(registro)").all().some((c) => c.name === "usuario_id"))
  db.exec("ALTER TABLE registro ADD COLUMN usuario_id INTEGER REFERENCES usuario(id)");

if (!db.prepare("PRAGMA table_info(usuario)").all().some((c) => c.name === "email"))
  db.exec("ALTER TABLE usuario ADD COLUMN email TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_usuario_email ON usuario(email COLLATE NOCASE) WHERE email IS NOT NULL");
db.exec(`CREATE TABLE IF NOT EXISTS recuperacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id),
  codigo_hash TEXT NOT NULL,
  expira_en TEXT NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
)`);

db.exec("CREATE TABLE IF NOT EXISTS tarifa (tipo TEXT PRIMARY KEY, valor_hora INTEGER NOT NULL)");
if (db.prepare("SELECT COUNT(*) c FROM tarifa").get().c === 0) {
  const t = db.prepare("INSERT INTO tarifa (tipo, valor_hora) VALUES (?,?)");
  for (const [tipo, v] of Object.entries(TARIFA_HORA)) t.run(tipo, v);
}

// ---- Distribución de cupos: 100 en total ----
// CR 01..CR 50 (carro) · MT 01..MT 35 (moto) · OT 01..OT 15 (otro)
const DISTRIBUCION = [
  { tipo: "CARRO", prefijo: "CR", total: 50 },
  { tipo: "MOTO", prefijo: "MT", total: 35 },
  { tipo: "OTRO", prefijo: "OT", total: 15 },
];
const codigoCupo = (prefijo, n) => `${prefijo} ${String(n).padStart(2, "0")}`;

// Convierte una base de datos ya existente (cupos A1, B1, M1...) a la nueva distribución,
// conservando el historial: los cupos viejos se renombran, no se borran.
if (db.pragma("user_version", { simple: true }) < 1) {
  db.transaction(() => {
    if (db.prepare("SELECT COUNT(*) c FROM cupo").get().c > 0) {
      db.exec("UPDATE cupo SET codigo = '#' || id"); // evita choques de UNIQUE al renombrar
      const upd = db.prepare("UPDATE cupo SET codigo = ?, tipo = ? WHERE id = ?");
      const ins = db.prepare("INSERT INTO cupo (parqueadero_id, codigo, piso, tipo) VALUES (?,?,1,?)");
      const pid = db.prepare("SELECT id FROM parqueadero ORDER BY id LIMIT 1").get()?.id ?? 1;
      for (const { tipo, prefijo, total } of DISTRIBUCION) {
        const viejos = db.prepare("SELECT id FROM cupo WHERE tipo = ? ORDER BY id").all(tipo);
        viejos.forEach((c, i) => upd.run(codigoCupo(prefijo, i + 1), tipo, c.id));
        for (let n = viejos.length + 1; n <= total; n++) ins.run(pid, codigoCupo(prefijo, n), tipo);
      }
      db.exec("UPDATE parqueadero SET capacidad_total = (SELECT COUNT(*) FROM cupo)");
    }
    db.pragma("user_version = 1");
  })();
}

// Datos iniciales (solo la primera vez)
if (db.prepare("SELECT COUNT(*) c FROM usuario").get().c === 0) {
  db.prepare("INSERT INTO usuario (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)")
    .run("Administrador", "admin", bcrypt.hashSync("admin123", 10), "ADMIN");
  db.prepare("INSERT INTO parqueadero (nombre, direccion, capacidad_total) VALUES (?,?,?)")
    .run("Parqueadero Central", "Calle 10 # 5-20", 100);
  const ins = db.prepare("INSERT INTO cupo (parqueadero_id, codigo, piso, tipo) VALUES (1,?,1,?)");
  db.transaction(() => {
    for (const { tipo, prefijo, total } of DISTRIBUCION)
      for (let n = 1; n <= total; n++) ins.run(codigoCupo(prefijo, n), tipo);
  })();
  console.log("Datos iniciales creados. Usuario: admin / Contraseña: admin123");
}

module.exports = db;
