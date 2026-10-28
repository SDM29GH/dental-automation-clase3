# Arquitectura — DentalCare Retention Engine

## 1. Contexto y restricciones

| Restricción | Consecuencia en el diseño |
|-------------|---------------------------|
| Un consultorio, Dra. Laura + 1 asistente | Un solo proceso, sin microservicios ni orquestador |
| La agenda real vive en Google Calendar | Calendar es fuente de verdad externa; Postgres es la copia operativa |
| Volumen bajo (decenas de citas/semana) | Cola persistente en Postgres en lugar de Redis + BullMQ |
| Presupuesto casi nulo | NLU por reglas primero; LLM opcional y local (Ollama) posible |
| Datos de salud | Nada de contenido clínico por WhatsApp; consentimiento explícito |
| Fuera de alcance | Facturación y expediente clínico |

## 2. Vista de componentes

```
        ┌──────────────────────┐        ┌───────────────────────────┐
        │  Google Calendar     │◄──────►│  services/google-calendar │
        │  (agenda real)       │ OAuth2 └─────────────┬─────────────┘
        └──────────────────────┘                      │ upsert / patch
                                                      ▼
┌──────────────┐  webhook   ┌──────────────────────────────────────────┐
│ Evolution API│───────────►│  app.ts  POST /webhook/whatsapp          │
│ (WhatsApp)   │◄───────────│    └─► handlers/whatsapp.handler.ts      │
└──────────────┘  sendText  │          ├─ services/nlu.ts              │
                  sendButtons│         ├─ repositories/citas           │
                             │          └─ services/mensajes.ts        │
                             │                                          │
                             │  app.ts  GET /panel   (HTML estático)    │
                             │          /api/panel/*  ─► services/panel │
                             │                                          │
                             │  scheduler/index.ts (node-cron)          │
                             │    ├─ recordatorios.service.ts ──┐       │
                             │    ├─ seguimiento.service.ts     │       │
                             │    └─ alertas.ts                 │       │
                             └──────────────────────────────────┼───────┘
                                                                ▼
                                                     ┌────────────────────┐
                                                     │ PostgreSQL (Prisma)│
                                                     │ citas · recordatorios│
                                                     └────────────────────┘
```

**Capas y dependencias.** `handlers` no conoce Prisma: depende de `CitasRepository`
(interfaz) y de funciones de servicio inyectadas. Eso permite probar el flujo
completo con dobles en memoria (`tests/helpers/fakes.ts`) y cambiar de ORM sin
tocar la lógica conversacional.

## 3. Modelo de datos

```
Paciente ──< Cita >── Tratamiento
              │
              ├──< RecordatorioEnvio   (cola persistente)
              ├──< Sesion              (historial de sesiones completadas)
              └──< Mensaje             (auditoría de conversación)
```

Decisiones relevantes:

- **`Paciente.telefono` es único y opcional.** Un evento de Calendar puede crear
  un paciente sin teléfono; simplemente no recibirá mensajes hasta que la
  asistente lo complete.
- **`Cita.calendarioEventId` es único.** Es la llave de idempotencia con Google
  Calendar: sincronizar mil veces no duplica citas.
- **`RecordatorioEnvio` tiene `@@unique([citaId, disparador])`.** Un paciente no
  puede recibir dos veces el recordatorio de 24 h de la misma cita.
- **`Cita.metadata` (JSON)** guarda `historial` de reprogramaciones y el motivo de
  cancelación, sin migraciones para cada nuevo dato de auditoría.
- **Enums antes que modelos** en el `.prisma`; los valores por defecto van sin
  comillas (`@default(AGENDADA)`), si no Prisma falla con un P1012 engañoso.

## 4. Motor de recordatorios

**Diseño: cola persistente, no cola en memoria.**

```
programarRecordatorios(citaId, fecha)
        │  upsert 4 filas (PENDIENTE, programadoPara)
        ▼
cron */5 → procesarRecordatoriosPendientes()
        │  SELECT ... WHERE estado=PENDIENTE AND programadoPara <= now
        │  filtrar (cancelada / sin consentimiento / ya confirmó / ya pasó)
        │  enviar → UPDATE ENVIADO → INSERT Mensaje
        ▼
        ERROR → intentos++ (hasta 3) → FALLIDO
```

Escalera y contenido:

| Disparador | Cuándo | Pide confirmación | Contenido |
|-----------|--------|-------------------|-----------|
| `D_MINUS_3D` | 72 h antes | sí (botones) | "¿Nos confirmas que podrás asistir?" |
| `D_MINUS_24H` | 24 h antes | sí (botones) | "Tu cita es mañana" |
| `D_MINUS_2H` | 2 h antes | no | "Tu cita es en 2 horas" |
| `D_MINUS_0H` | a la hora | no | "¡Hoy es tu cita!" |

Guardas que evitan los tres pecados clásicos (spam, mensajes nocturnos, mensajes
a quien ya confirmó):

1. **Horario de envío 08:00–21:00 (zona del consultorio).** Lo que vence de noche
   se reprograma a las 08:00; nunca se envía de madrugada.
2. **`estado = CONFIRMADA`** ⇒ se omiten los recordatorios que piden confirmación.
3. **`consentWhatsapp = false`** ⇒ se omite y se alerta a la asistente una sola vez.
4. **Cita cancelada/completada o ya pasada** ⇒ se omite.
5. **`D_MINUS_3D`** sólo se envía si aún faltan más de 48 h (una cita creada ayer
   para mañana no recibe el de 3 días, y el de 24 h ya cubre el aviso).

**Reconciliación:** cada mañana a las 08:00 se recalcula la escalera de todas las
citas futuras (`reconciliarRecordatorios`). Es idempotente y repara cualquier
desajuste provocado por cambios hechos a mano en Google Calendar.

## 5. NLU: tres capas, de barato a caro

| Capa | Cuándo | Coste | Determinista |
|------|--------|-------|--------------|
| 1. Botón (`confirmar_cita`, `reprogramar_cita`, `cancelar_cita`) | respuesta con botones | 0 | sí |
| 2. Reglas en español | frases frecuentes ("cámbiamelo para el jueves", "ya no voy a poder", "¿llevan tarjeta?") | 0 | sí |
| 3. LLM (OpenAI-compatible) | sólo si la confianza de la regla es < 0.9 **y** hay `LLM_API_KEY` | ~0.001 USD | no |

Reglas de diseño:

- Las reglas **siempre** corren primero: si aciertan con confianza ≥ 0.9, el LLM
  no se invoca. La mayoría del tráfico no cuesta nada.
- La extracción de fecha/hora (`normalizarFecha`, `normalizarHora`) es local, no
  del modelo: "jueves", "mañana", "15 de noviembre", "6 de la tarde" se resuelven
  con código, y el LLM sólo aporta intención cuando hace falta.
- Si el LLM falla (timeout, JSON inválido, 500) se degrada a reglas; si tampoco
  hay regla, la intención es `OTRO` y el caso se escala a la asistente.
- El prompt recibe la fecha de hoy, el día de la semana y la zona; y prohíbe
  inventar fechas cuando el paciente no las menciona.

## 6. Motor de seguimiento multisesión

El abandono no ocurre cuando el paciente decide no volver, sino cuando deja de
dolerle y nadie le escribe. El job de las 18:00 recorre las citas `COMPLETADA`
con tratamiento y sin continuación agendada:

```
dias = hoy − última sesión
protocolo = obtenerProtocolo(tipo)

si dias < (diasEntreSesiones − avisoAnticipado)  → no molestar
si ya tiene cita futura del mismo tipo            → omitir
si se le escribió en los últimos 5 días           → omitir
si dias < diasEntreSesiones                       → aviso amable (antes de que venza)
si dias ≥ diasEntreSesiones                       → recordatorio con el motivo clínico
si retraso ≥ umbralAlerta (en el día exacto o cada 7) → alerta a la asistente
si retraso ≥ umbralCritico                        → alerta ALTA: "requiere llamada"
```

Protocolos (editables en `services/protocolos.ts`):

| Tratamiento | Días entre sesiones | Aviso anticipado | Alerta | Crítico |
|-------------|--------------------|------------------|--------|---------|
| Endodoncia | 7 | 2 | 3 | 10 |
| Ortodoncia | 15 | 4 | 5 | 21 |
| Prótesis | 10 | 3 | 4 | 14 |
| Implante | 14 | 3 | 5 | 21 |
| Control | 30 | 7 | 10 | 45 |

## 7. Sincronización con Google Calendar

- **Dirección:** Calendar → Postgres cada mañana (y al arrancar); Postgres →
  Calendar cuando el paciente confirma (no aplica), reprograma (patch del evento)
  o cancela (status `cancelled`).
- **Identidad:** `evento.id` ↔ `Cita.calendarioEventId` (único).
- **Parseo:** `"Nombre - motivo"`; el motivo se clasifica por palabras clave en
  `tipo` (`ENDODONCIA`, `ORTODONCIA`, ...). Sin ese formato el evento se ignora y
  se registra un aviso, en lugar de crear pacientes basura.
- **Pacientes nuevos:** se crean sin teléfono y sin consentimiento. Nunca se
  inventan números; la asistente los completa desde el panel (pestaña Pacientes),
  que guarda los últimos 10 dígitos y antepone `WHATSAPP_PAIS` al enviar.
- **Reprogramación:** se mueve el evento existente; no se borra ni se crea otro.
  La cita conserva su historial y `metadata.historial` deja la auditoría.

## 8. Panel de la asistente

Es la interfaz que reemplaza "WhatsApp Web + Google Calendar + memoria". No es
un SPA: `public/` sirve HTML/CSS/JS sin bundler y `services/panel.ts` concentra
las consultas y acciones.

```
Navegador ──Basic auth──► GET /panel        (public/index.html + app.js)
                        └► /api/panel/*     (routes/panel.routes.ts)
                                              └─► services/panel.ts
                                                    ├─ Prisma (lecturas)
                                                    ├─ citasRepository.reprogramarCita
                                                    ├─ google-calendar (patch del evento)
                                                    └─ whatsappService (envío manual)
```

Decisiones:

- **Sin build ni framework.** Para una sola pantalla operativa, React o Vite
  añaden un paso de compilación y un `node_modules` que la clínica tendría que
  mantener. HTML + `fetch` + delegación de eventos cubre todo lo necesario.
- **La UI no calcula reglas de negocio.** Las acciones llaman a la API; la API
  reutiliza los mismos servicios que el webhook y el scheduler (reprogramar,
  completar sesión, programar recordatorios). No hay una segunda implementación
  que se desincronice.
- **Autenticación Basic** (`PANEL_USER` / `PANEL_PASSWORD`, comparación con
  `timingSafeEqual`). Sin contraseña configurada, sólo se aceptan peticiones
  desde loopback: el panel no queda abierto a internet por olvido. El
  `express.static` de `/panel` y la API comparten el mismo middleware.
- **Errores accionables.** Evolution caído se traduce a "revisa el servidor de
  WhatsApp"; las acciones manuales usan timeout corto (5 s, sin reintentos) para
  no dejar a la asistente esperando. El detalle técnico va al log.
- **La franja superior** resume lo que requiere atención (citas sin confirmar,
  tratamientos en riesgo, conversaciones sin responder, WhatsApp caído) y enlaza
  a la pestaña correspondiente.
- **Conversaciones:** el historial sale de `Mensaje`; la respuesta manual exige
  el mismo `consentWhatsapp` que el bot y se registra con tipo
  `manual:asistente`, así que también aparece en la auditoría.
- **Teléfonos:** los pacientes llegan de Calendar sin número. La pestaña
  Pacientes permite agregarlo o corregirlo; se guardan los últimos 10 dígitos
  (formato del webhook) y al enviar se antepone `WHATSAPP_PAIS` (52 por defecto),
  porque Evolution exige el número completo.

## 9. Modos de fallo y degradación

| Falla | Efecto | Mitigación |
|-------|--------|------------|
| Evolution API caída | no se envía el mensaje | la cita **sí** cambia de estado; el mensaje queda `FALLIDO` en `Mensaje`; el recordatorio reintenta hasta 3 veces |
| Webhook duplicado (reintento de Evolution) | riesgo de doble acción | dedupe por `key.id` en `Mensaje.proveedorId` |
| Google Calendar caído | no se refleja el cambio en la agenda | se registra el error, la cita se actualiza en Postgres y la reconciliación de las 08:00 vuelve a intentarlo |
| LLM caído o lento | peor interpretación | timeout 12 s, fallback a reglas, luego escalado humano |
| Postgres caído | el proceso no arranca | `iniciar()` falla rápido y ruidoso en lugar de simular salud |
| Recordatorio vencido de noche | molestia al paciente | diferido a las 08:00 |
| Cita reprogramada | recordatorios obsoletos | `programarRecordatorios` hace upsert por disparador |
| WhatsApp caído desde el panel | el mensaje no sale, pero la agenda no se bloquea | la cita se mueve igual; la UI avisa y sugiere avisar a mano |
| Panel expuesto sin contraseña | datos de pacientes accesibles | sólo loopback; en producción `PANEL_PASSWORD` + HTTPS |

## 10. Seguridad y privacidad

- **Webhook autenticado opcionalmente** con `x-webhook-secret`, comparado con
  `timingSafeEqual`.
- **Panel autenticado** con Basic (`PANEL_PASSWORD`) fuera de localhost; el
  navegador recuerda las credenciales. Nunca exponerlo sin TLS.
- **Secretos sólo en `.env`** (fuera de git); la configuración se valida con Zod
  al arrancar y falla con la lista de variables faltantes.
- **Refresh token de Google** de larga duración: guardarlo cifrado en el VPS y
  revocarlo si se compromete.
- **Contenido:** sólo fecha, hora, nombre y tipo general de tratamiento. Sin
  diagnósticos, sin presupuestos cerrados, sin datos de terceros.
- **Consentimiento** obligatorio antes de cualquier mensaje proactivo (también
  para los envíos manuales desde el panel).
- **Retención:** los mensajes se guardan para auditoría; si se requiere, se puede
  purgar `Mensaje` a los 12 meses sin perder métricas de citas.

## 11. Despliegue

```bash
docker compose up -d postgres evolution-api
npm run db:migrate        # primera vez
docker compose up -d app  # migra (si hay migraciones) y arranca
```

- Un VPS de 2 vCPU / 2 GB basta para el consultorio completo.
- **Respaldo:** `pg_dump` diario de `dental_care`; el volumen `evolution_instances`
  guarda la sesión de WhatsApp (perderlo implica escanear el QR otra vez).
- La app corre sin privilegios (`USER appuser`) en la imagen final.
- `/health` devuelve 503 si Postgres o la instancia de WhatsApp no responden, para
  que el monitoreo externo (Uptime Kuma, Healthchecks) avise de verdad.

## 12. Costos estimados (mensual)

| Concepto | Opción local | Opción nube |
|----------|--------------|-------------|
| VPS 2 vCPU / 2 GB | 6–12 USD | 6–12 USD |
| PostgreSQL | incluido | 0–15 USD (gestionado) |
| WhatsApp | Evolution autohospedada, 0 USD | Twilio ~0,005–0,02 USD/mensaje |
| LLM | 0 USD (Ollama) | ~0,50–2 USD con `gpt-4o-mini` para cientos de mensajes |
| Google Calendar API | gratis dentro de cuota | — |

## 13. Lo que deliberadamente no se construyó

- **Facturación y cobros.** Fuera de alcance; se integra después con un sistema
  contable si hace falta.
- **Expediente clínico.** El sistema no sabe qué se hizo clínicamente, sólo cuándo
  es la siguiente cita.
- **Agendamiento autónomo de espacios libres.** El bot propone una fecha y la
  asistente confirma la disponibilidad real; automatizar el *free/busy* completo
  requiere reglas de silla y duración que la clínica aún no formaliza.
- **Notificaciones push / app móvil.** El panel web responsive cubre el uso en
  tablet y teléfono; una app nativa no aporta nada a dos personas.
- **Recordatorios por voz o SMS.** WhatsApp es el canal real del consultorio;
  añadir canales multiplicaría las plantillas y el consentimiento.
