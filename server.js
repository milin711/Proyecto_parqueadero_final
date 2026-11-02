const express = require("express");
const cors = require("cors");
const path = require("path");
const { PORT } = require("./config");
const { error } = require("./utils");
require("./db"); // inicializa la base de datos

const app = express();
app.use(cors());
app.use(express.json());

// Interfaz web (carpeta /public) -> se abre en http://localhost:3000
app.use(express.static(path.join(__dirname, "public")));

// Todos los endpoints viven en /routes
app.use("/api/v1", require("./routes"));

app.use((req, res) => error(res, 404, "Ruta no encontrada"));

app.listen(PORT, () => {
  console.log(`App lista en http://localhost:${PORT}`);
  console.log(`API en http://localhost:${PORT}/api/v1`);
});
