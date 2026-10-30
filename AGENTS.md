# AGENTS.md — Contexto persistente del proyecto

> **Léeme completo antes de tocar código.** Este archivo es el contrato de trabajo
> entre las personas y los agentes de IA que mantienen **DentalCare Retention Engine**.
> Si una instrucción de una tarea contradice este documento, pregunta antes de
> implementar. Última revisión: 2026-10-30.

---

## 1. Qué estamos construyendo

Un motor de automatización para un consultorio dental pequeño (Dra. Laura + una
asistente) que reduce tres pérdidas concretas:

1. **Inasistencias** a citas agendadas.
2. **Abandono de tratamientos multisesión** (endodoncia, ortodoncia, prótesis)
   cuando el paciente deja de sentir dolor.
3. **Tiempo perdido** enviando recordatorios manuales por WhatsApp.

La interfaz principal es un **panel web para la asistente**; el paciente sólo ve
mensajes de WhatsApp claros, cortos y accionables. El sistema **no diagnostica**,
**no cobra** y **no lleva expediente clínico**.

## 2. Usuarios y promesa

| Usuario | Necesita | Éxito |
|---|---|---|
| Dra. Laura | Que la agenda no tenga huecos y que los pacientes vuelvan | Menos inasistencias, tratamientos completados |
| Asistente | Confiar en el sistema sin revisar todo a mano | Sólo atiende excepciones y dudas |
| Paciente | Confirmar o mover su cita sin fricción | Resuelve en menos de 30 segundos, en su idioma |

**Promesa del producto:** el consultorio se ve profesional y cercano; el paciente
siente que lo acompañan, no que lo persiguen.

## 3. Reglas de negocio que no se negocian

1. **Google Calendar es la fuente de verdad de la agenda.** Postgres es un espejo
   operativo. Si se mueve o cancela una cita, primero se intenta Calendar y luego
   la base; un fallo de Calendar se registra, no se oculta.
2. **Sin consentimiento no hay mensaje.** `Paciente.consentWhatsapp` debe ser
   `true`. Escribir a quien no autorizó es un problema legal, no técnico.
3. **Horario de envío: 08:00–21:00** en `TIMEZONE` (por defecto
   `America/Mexico_City`). Fuera de esa ventana, el mensaje se difiere; nunca se
   descarta.
4. **Nada clínico en los mensajes.** No se interpretan síntomas, no se recomiendan
   tratamientos, no se dan diagnósticos ni precios cerrados. Las dudas se escalan
   a la asistente.
5. **El bot no finge.** Si no entiende, pide ayuda humana y avisa. Es mejor una
   escalada honesta que una respuesta inventada.
6. **Reprogramar mueve el mismo evento** de Calendar, no crea otro. Se respetan
   domingo cerrado, fechas pasadas y la hora original si el paciente no propone una.
7. **Idempotencia siempre.** Evolution puede reintentar el mismo webhook; un
   `proveedorId` repetido no debe duplicar estados, mensajes ni acciones.
8. **Tono:** español de México, tuteo, frases cortas, un solo llamado a la acción.
   Emojis con moderación (máximo dos por mensaje). Nunca culpar al paciente.

## 4. Stack y mapa del código

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20+ / TypeScript ESM, `strict: true` |
| Base de datos | PostgreSQL 16 + Prisma 6 |
| Cola de recordatorios | Tabla `recordatorios_envios` + `node-cron` (sin Redis) |
| WhatsApp | Evolution API v2 (Baileys autohospedado) |
| NLU | Botones → reglas deterministas → LLM opcional |
| Agenda | Google Calendar API (OAuth2 + refresh token) |
| Panel | Express + HTML/CSS/JS sin framework, servido en `/panel` |
| Pruebas | Vitest + Supertest, sin infraestructura externa |

```
src/
  config/        Validación de entorno con Zod (única puerta de configuración)
  services/      WhatsApp, Calendar, NLU, mensajes, protocolos, panel, alertas
  repositories/  Acceso a datos (Prisma) y tipos de dominio
  handlers/      Webhook de WhatsApp y orquestación de intenciones
  scheduler/     Recordatorios, seguimiento multisesión y tareas cron
  routes/        API HTTP del panel
  utils/         Fechas/zona horaria, Prisma, logger, cifrado
prisma/          schema.prisma, migraciones y seed
public/          Panel: index.html, styles.css, app.js
scripts/         OAuth, sincronización, seed, demo
tests/           unit/ e integration/; helpers/fakes.ts para dobles
specs/           Especificaciones SDD (la verdad del producto)
docs/            Arquitectura, flujos y calidad
```

## 5. Comandos que debes conocer

```bash
npm install                 # dependencias
npm run dev                 # servidor con recarga en caliente
npm run typecheck           # TypeScript sin emitir
npm test                    # suite completa (Vitest)
npm run test:unit           # sólo unitarias
npm run test:integration    # sólo integración
npm run build               # compila a dist/
npm run demo                # conversación de ejemplo sin BD ni APIs
npm run db:migrate          # migraciones de Prisma
npm run db:seed             # tratamientos + pacientes demo
npm run sync:calendar       # espejo Calendar → Postgres
npm run oauth               # obtiene GOOGLE_REFRESH_TOKEN (flujo loopback)
```

En PowerShell no uses `&&`; usa `;` o ejecuta los comandos por separado.

## 6. Flujo obligatorio: Spec Driven Development

**No se implementa nada sin una spec.** El código es una consecuencia de la spec,
no al revés. El ciclo es:

```
Problema → Spec → Criterios de aceptación → Pruebas → Implementación → Verificación → Spec actualizada
```

### 6.1 Antes de escribir código

1. Lee este archivo y la spec relevante en `specs/`.
2. Si la funcionalidad no tiene spec, **escríbela primero** (aunque sea mínima).
3. Si la spec existente contradice el código, investiga: puede ser deuda técnica
   o una spec desactualizada. No “arregles” el código para que coincida sin
   actualizar la spec y avisar.

### 6.2 Anatomía de una spec

Cada spec vive en `specs/NNN-nombre-corto/spec.md` y contiene, como mínimo:

- **Problema:** quién sufre qué, con evidencia o hipótesis explícita.
- **Objetivo y métricas:** resultado esperado y cómo se mide.
- **Alcance / fuera de alcance.**
- **Diseño de la solución:** flujo, estados, datos, errores y límites.
- **3 a 5 criterios de aceptación verificables** en formato
  `Dado / Cuando / Entonces`, cada uno con su **verificación** (prueba,
  comando o comprobación manual reproducible).
- **Riesgos, dependencias y preguntas abiertas.**

Una spec sin criterios verificables es una idea, no una spec. Los criterios deben
poder fallar: si ninguna implementación posible los incumple, no sirven.

### 6.3 Implementación

1. Escribe primero la prueba de aceptación (o el test unitario que la cubre).
2. Implementa lo mínimo para que pase, sin romper las reglas del punto 3.
3. Si descubres que la spec estaba incompleta, **actualízala en el mismo cambio**
   y explica por qué.
4. No dejes código muerto, `TODO` sin dueño ni features “por si acaso”.

### 6.4 Verificación

Antes de decir “listo”, ejecuta y revisa:

```bash
npm run typecheck
npm test
npm run build
```

Si el cambio toca UI, ábrela y pruébala en el navegador (no basta con leer el
HTML). Si toca WhatsApp o Calendar, prueba con dobles; no envíes mensajes reales
ni muevas eventos reales sin autorización explícita.

### 6.5 Cierre

- Actualiza la spec (estado, criterios, historial) si cambió el comportamiento.
- Actualiza README/PASO_A_PASO si cambió un comando, variable o flujo visible.
- Resume qué se hizo, qué se verificó y qué quedó pendiente.

## 7. Convenciones de código

- **ESM:** imports relativos con extensión `.js` (`import { x } from "./x.js"`).
- **TypeScript estricto:** evita `any`; usa tipos del dominio o Zod en los bordes.
- **Fechas:** siempre a través de `src/utils/time.ts`. Guarda UTC en la base;
  interpreta y muestra en `TIMEZONE`. No uses `new Date("YYYY-MM-DD")` para fechas
  locales: produce corrimientos de día.
- **Zod en la frontera:** valida entorno, bodies HTTP y payloads externos.
- **Errores:** no filtres secretos ni tokens en logs. Convierte errores técnicos
  en mensajes accionables para la asistente (`PanelError`).
- **Prisma:** no borres datos en producción sin confirmación; usa migraciones,
  no `db push`, fuera de desarrollo.
- **UI:** HTML semántico, CSS con variables existentes, JS sin framework. Sigue
  la skill `diseno-marca`.
- **Idioma:** nombres de dominio y mensajes en español; evita spanglish innecesario.
- **Commits:** mensajes en español, imperativo y con alcance
  (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).

## 8. Seguridad y privacidad

- **Nunca** commitees `.env`, tokens, contraseñas, QR ni teléfonos reales.
- El panel debe tener `PANEL_PASSWORD` en producción y servirse por HTTPS o VPN.
  Sin contraseña, sólo se permite loopback (desarrollo).
- El webhook de Evolution puede exigir `x-webhook-secret`; no lo desactives en
  producción.
- Los logs no deben incluir contenido clínico ni credenciales.
- Los datos de pacientes son personales: minimiza lo que guardas y lo que envías.
- Antes de producción: elimina pacientes de demostración y configura respaldos.

## 9. UI y marca

La identidad visual no es decoración: transmite calma y competencia a una
asistente que la usa durante ocho horas. Antes de crear o modificar una pantalla,
carga la skill **`diseno-marca`** (`.opencode/skills/diseno-marca/SKILL.md`).

Reglas rápidas:

- Paleta teal/menta definida en `public/styles.css`; no inventes colores nuevos.
- Tipografía del sistema, tamaños legibles en tablet, nada de fuentes decorativas.
- Estados con texto además de color (no sólo un punto verde).
- Botones táctiles de al menos 44×44 px; foco visible; contraste AA.
- Mensajes de error: qué pasó y qué hacer, sin culpar a la persona.

## 10. Definición de terminado

Un cambio está terminado cuando:

- [ ] Tiene spec (nueva o actualizada) y criterios de aceptación verificables.
- [ ] Las pruebas nuevas cubren el criterio; las existentes siguen pasando.
- [ ] `npm run typecheck`, `npm test` y `npm run build` pasan.
- [ ] La UI se probó en el navegador si aplica.
- [ ] No hay secretos, datos reales ni artefactos generados en el diff.
- [ ] README/PASO_A_PASO actualizados si cambió algo visible.
- [ ] El resumen final dice qué se verificó y qué no.

## 11. Estado actual y límites conocidos

- La suite corre sin PostgreSQL, WhatsApp ni Google: usa dobles en `tests/helpers`.
- `GET /health` devuelve 503 si Evolution no responde; es esperado en local.
- Evolution API usa Baileys (no oficial): existe riesgo de bloqueo del número.
  Para producción estable, evaluar WhatsApp Cloud API.
- La app de Google debe estar publicada (no en “Testing”) o el refresh token
  caduca a los 7 días.
- El panel es de una sola instancia; no hay multiusuario ni auditoría fina.
- La primera puesta en marcha real requiere escanear el QR de WhatsApp y crear
  credenciales OAuth; ver `PASO_A_PASO.md`.

## 12. Dónde mirar

| Necesitas… | Archivo |
|---|---|
| Entender el producto | `README.md` |
| Ponerlo en marcha paso a paso | `PASO_A_PASO.md` |
| Arquitectura y decisiones | `docs/ARCHITECTURE.md` |
| Flujos conversacionales | `docs/FLUJOS_CONVERSACIONALES.md` |
| Calidad y pirámide de pruebas | `docs/CALIDAD_CI.md` |
| La funcionalidad principal, especificada | `specs/001-recordatorios-inteligentes/spec.md` |
| Diseñar o revisar UI | `.opencode/skills/diseno-marca/SKILL.md` |

---

## Historial

| Fecha | Cambio |
|---|---|
| 2026-10-30 | Creación del contexto persistente y del flujo SDD obligatorio. |
