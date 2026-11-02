# ParkControl API

## Ejecutar

```bash
npm install
npm start
```

Corre en `http://localhost:3000/api/v1`. La primera vez crea `parqueadero.db` con
100 cupos (CR 01–CR 50 carros, MT 01–MT 35 motos, OT 01–OT 15 otros) y un usuario: **admin / admin123**.

## Roles

| Rol | Cómo se obtiene | Qué puede hacer |
|---|---|---|
| `CLIENTE` (persona) | Se registra en la pantalla de inicio ("Soy usuario" → "Crea tu cuenta") | Registrar el ingreso de su vehículo, ver cupos libres, ver cuánto lleva dentro y cuánto pagaría ahora |
| `ADMIN` | Usuario `admin` (pestaña "Administrador") | Todo lo del operador + editar tarifas, datos del parqueadero y crear/editar/eliminar cupos |
| `OPERADOR` | Se inserta en la tabla `usuario` con rol `OPERADOR` | Registrar entradas y salidas, historial, poner cupos en mantenimiento |

Nuevos endpoints: `POST /auth/registro`, `GET /registros/mios`, `GET /tarifas`, `PUT /tarifas/:tipo` (ADMIN),
`PUT /parqueaderos/:id` (ADMIN), `POST|PUT|DELETE /cupos` (ADMIN).

## Probar con curl

```bash
# 1. Login (guarda el token)
curl -X POST localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","password":"admin123"}'

TOKEN="pega_aqui_el_token"

# 2. Resumen de ocupación
curl localhost:3000/api/v1/parqueaderos/1/resumen -H "Authorization: Bearer $TOKEN"

# 3. Cupos libres
curl "localhost:3000/api/v1/cupos?parqueaderoId=1&estado=LIBRE" -H "Authorization: Bearer $TOKEN"

# 4. Registrar entrada
curl -X POST localhost:3000/api/v1/registros/entrada \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"placa":"ABC123","tipoVehiculo":"CARRO","cupoId":1}'

# 5. Buscar registro activo
curl localhost:3000/api/v1/registros/activo/ABC123 -H "Authorization: Bearer $TOKEN"

# 6. Registrar salida
curl -X PATCH localhost:3000/api/v1/registros/1/salida \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"metodoPago":"EFECTIVO"}'

# 7. Historial
curl "localhost:3000/api/v1/registros?estado=FINALIZADO&page=1&size=10" -H "Authorization: Bearer $TOKEN"
```

## Recuperar contraseña por correo

1. Al registrarse, la persona escribe su **correo**. En el login, "¿Olvidaste tu contraseña?" pide ese correo y envía un código de 6 dígitos (vence en 15 min, sirve una sola vez, máx. 5 intentos y 1 solicitud por minuto).
2. Con el código la persona crea una contraseña nueva y vuelve a iniciar sesión.
3. El **admin** guarda su correo en *Admin → Mi correo de recuperación* (la cuenta `admin` viene sin correo).

**Enviar correos reales:** copia `.env.example` como `.env` y completa `SMTP_USER` y `SMTP_PASS`
(con Gmail usa una *contraseña de aplicación*: https://myaccount.google.com/apppasswords). Reinicia con `npm start`.
Sin `.env`, el servidor funciona en **modo pruebas**: en vez de enviar el correo, imprime el código en la consola.
Nunca subas tu `.env` a GitHub.

## Tarifas

Por hora o fracción: CARRO $2.000, MOTO $1.000, **OTRO $500**.
Se guardan en la base de datos y el ADMIN las edita desde la app (Admin → Tarifas).
`config.js` solo define los valores iniciales de una base nueva.
