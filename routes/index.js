const express = require("express");
const auth = require("../middleware/auth");

const router = express.Router();

// Públicas (login y registro de personas)
router.use("/auth", require("./auth.routes"));

// Protegidas (requieren Authorization: Bearer <token>). El rol se valida dentro de cada ruta.
router.use("/parqueaderos", auth, require("./parqueaderos.routes"));
router.use("/cupos", auth, require("./cupos.routes"));
router.use("/registros", auth, require("./registros.routes"));
router.use("/tarifas", auth, require("./tarifas.routes"));

module.exports = router;
