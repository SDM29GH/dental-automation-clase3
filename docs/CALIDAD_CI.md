# Calidad y CI

## Qué se ejecuta y qué garantiza

| Comprobación | Comando | Qué detecta |
|--------------|---------|-------------|
| Tipos | `npm run typecheck` | contratos rotos entre capas, campos de Prisma inexistentes, `null` no controlados |
| Pruebas | `npm test` | regresión funcional en NLU, handler, fechas, recordatorios, protocolos y panel |
| Build | `npm run build` | problemas de ESM/rutas de importación que sólo aparecen al compilar |
| Migración | `npm run db:migrate` | esquema inválido o deriva entre `schema.prisma` y la base |

No hay ESLint instalado a propósito: con `strict: true` y 110 pruebas que ejercitan
el flujo real, el retorno de un linter genérico no compensa el peso de otra
dependencia. Si el equipo crece, se añade `typescript-eslint` sin tocar el código.

## Pirámide de pruebas

```
                    ┌──────────────────────────┐
                    │ integración HTTP (21)    │  supertest contra la app real,
                    │ tests/integration        │  con dobles en memoria
                    ├──────────────────────────┤
                    │ unitarias (89)           │  funciones puras y flujos
                    │ tests/unit               │  con repositorio falso
                    └──────────────────────────┘
```

| Archivo | Cubre |
|---------|-------|
| `tests/unit/time.test.ts` | conversión zona ↔ UTC, cambio de horario de verano, "hoy" del consultorio, formato en español |
| `tests/unit/nlu.test.ts` | fechas y horas en lenguaje natural, precedencia de reglas, botones, extracción sin LLM |
| `tests/unit/handler.test.ts` | parseo de payloads de Evolution (sobre y plano), confirmar/reprogramar/cancelar/duda, idempotencia, fallo de WhatsApp, escalado, cálculo de nueva fecha |
| `tests/unit/recordatorios.test.ts` | escalera de 4 disparadores, copy por disparador, horario de silencio |
| `tests/unit/protocolos.test.ts` | protocolos clínicos, coherencia de umbrales, textos de seguimiento, respuestas frecuentes |
| `tests/unit/whatsapp.test.ts` | normalización del teléfono y lada de país al enviar |
| `tests/integration/webhook.test.ts` | `POST /webhook/whatsapp` (200/401, sobre y payload plano), `/health`, 404 JSON |
| `tests/integration/panel.test.ts` | API del panel (resumen, rangos, estados válidos e inválidos, reprogramar, respuesta manual, teléfono), autenticación Basic y servido del HTML |

**Sin infraestructura.** Ninguna prueba necesita PostgreSQL, Redis, WhatsApp ni
Google: el handler depende de interfaces (`CitasRepository`, servicios) y los
dobles viven en `tests/helpers/fakes.ts`. Eso permite correr la suite completa en
cualquier máquina y en CI en menos de 5 segundos.

## Lo que se verificó además contra servicios reales

Durante el desarrollo se validó manualmente, con PostgreSQL 16 en Docker:

- `prisma migrate dev` aplicada y esquema en sincronía.
- Webhook real: confirmación y reprogramación, verificadas en `citas`,
  `recordatorios_envios` y `mensajes`.
- Motor de recordatorios: envío, **diferimiento nocturno a las 08:00** y
  **omisión por falta de consentimiento** (con alerta).
- Motor de seguimiento: tratamiento de endodoncia con 21 días de retraso →
  mensaje al paciente + alerta crítica a la asistente.
- Panel: navegación por las 5 pestañas en Chromium (Playwright), mover y confirmar
  una cita, activar/desactivar consentimiento y errores de WhatsApp con Evolution
  caído. Sin errores de consola ni peticiones fallidas inesperadas.

Pendiente de verificación con credenciales del consultorio: Evolution API (QR) y
Google Calendar (OAuth). El código falla de forma explícita y controlada cuando
faltan, y `/health` lo reporta.

## Integración continua (GitHub Actions)

`.github/workflows/ci.yml` ejecuta en cada push y pull request:

1. `npm ci`
2. `npx prisma generate`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

No levanta Postgres porque la suite no lo necesita. Si en el futuro se añaden
pruebas de base de datos, se activa el servicio `postgres:16-alpine` y se ejecuta
`npx prisma migrate deploy` antes de esas pruebas.

## Convenciones del código

1. **Fronteras explícitas.** El handler no importa Prisma; depende de
   `CitasRepository`. Cambiar de ORM no toca la lógica conversacional.
2. **Funciones puras primero.** `parsearMensajeEntrante`, `resolverNuevaFecha`,
   `normalizarFecha`, `calcularMomento`: se prueban sin mocks.
3. **Copy centralizado.** Todo texto de paciente en `services/mensajes.ts`; toda
   regla clínica en `services/protocolos.ts`.
4. **Configuración validada.** Nada de `process.env` suelto: todo pasa por
   `config` (Zod) y el arranque falla con la lista de variables faltantes.
5. **Fechas con zona explícita.** `utils/time.ts` es la única puerta de entrada a
   la zona del consultorio. Nunca `new Date()` con aritmética de horas para
   "fechas de pared".
6. **Errores externos contenidos.** Toda llamada a WhatsApp/Google/LLM está en
   `try/catch` y degrada: la cita cambia de estado aunque el mensaje no salga.
7. **Comentarios con el "por qué".** Especialmente en las decisiones discutibles
   (sin Redis, reglas antes que LLM, mover la cita en sitio).

## Requisitos para fusionar

- [x] `npm run typecheck` sin errores
- [x] `npm test` en verde
- [x] `npm run build` compila
- [x] Migración de Prisma incluida si cambia el esquema
- [x] `.env.example` actualizado si hay variables nuevas
- [x] README/docs actualizados si cambia el comportamiento
