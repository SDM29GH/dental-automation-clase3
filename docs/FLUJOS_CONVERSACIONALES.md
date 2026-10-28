# Flujos conversacionales — WhatsApp

Todo el texto que ve el paciente está en `src/services/mensajes.ts`. Este
documento describe **qué decide el sistema y por qué**, con el copy real.

---

## 1. Cómo se interpreta un mensaje

```
mensaje entrante
   │
   ├─ ¿viene de nosotros o de un grupo?  → se ignora
   ├─ ¿id de WhatsApp ya procesado?      → se ignora (idempotencia)
   │
   ├─ capa 1: ¿es un botón?              → intención explícita, coste 0
   ├─ capa 2: ¿coincide con una regla?   → confianza ≥ 0.9 ⇒ se usa
   ├─ capa 3: LLM (sólo si hay API key)  → mensajes ambiguos
   └─ si nada funciona                   → OTRO ⇒ escala a la asistente
```

| Intención | Señales típicas | Acción |
|-----------|-----------------|--------|
| `CONFIRMAR` | "sí", "ahí estaré", "confirmo", botón *Sí asistiré* | cita → `CONFIRMADA`, respuesta de confirmación |
| `REPROGRAMAR` | "no puedo ir, cámbiamelo para el jueves", "mejor el viernes a las 4", botón *Necesito cambiarla* | mueve cita + evento, recalcula recordatorios |
| `CANCELAR` | "cancelo", "ya no voy a poder", botón *Cancelar cita* | cita → `CANCELADA_POR_PACIENTE`, evento cancelado |
| `DUDA` | "¿cuánto cuesta?", "¿llevan tarjeta?", "¿dónde están?" | respuesta frecuente + aviso a la asistente |
| `OTRO` | lo que no se entiende | pide reformular + alerta ALTA |

**Precedencia:** reprogramar gana sobre cancelar. "No puedo el martes, mejor el
jueves" es una reprogramación, no una baja.

---

## 2. Recordatorio de 24 h (con botones)

```
Hola Ana 👋, te recordamos tu cita de mañana:

📅 Jueves, 29 de octubre, 10:00
🦷 Dra. Laura

¿Sigues viniendo?
```

*Botones:* **Sí, asistiré** · **Necesito cambiarla**

Si Evolution rechaza los botones (plantilla no aprobada, versión vieja), el
sistema reintenta automáticamente como texto plano. El recordatorio nunca se
pierde por un detalle de la API.

### Si pulsa "Sí, asistiré"

```
¡Gracias Ana! ✅

Tu cita quedó confirmada:

📅 Jueves, 29 de octubre, 10:00
🦷 Dra. Laura

Te enviaremos un recordatorio el día anterior.
```

→ `Cita.estado = CONFIRMADA`. Los recordatorios que pedían confirmación se
marcan `OMITIDO` ("el paciente ya confirmó"); el aviso de 2 h sí se envía.

---

## 3. Reprogramación en lenguaje natural

**Paciente:** `no puedo ir, cámbiamelo para el jueves`

Proceso:

1. Se registra el mensaje entrante (`Mensaje`, dirección `IN`).
2. Se busca la próxima cita activa del teléfono (ventana de 72 h).
3. NLU: intención `REPROGRAMAR`; `normalizarFecha("jueves")` calcula la fecha en
   la zona del consultorio; `normalizarHora` toma la hora si la mencionó.
4. **Se mueve el evento existente** en Google Calendar (patch), no se crea otro.
5. La cita se actualiza **en sitio**: nueva `fecha`, estado `REAGENDADA`, y se
   añade la entrada a `metadata.historial` (fecha anterior, nueva, nota, momento).
6. Se reprograman los recordatorios con `upsert` por disparador.
7. Respuesta:

```
Listo Ana 👍

Movimos tu cita a:

📅 Jueves, 29 de octubre, 10:00
🦷 Dra. Laura

Si ese horario tampoco te sirve, responde a este mensaje y lo ajustamos.
```

Reglas del cálculo de fecha:

| Caso | Comportamiento |
|------|----------------|
| El paciente da día y hora | se respeta |
| Da sólo el día ("el jueves") | conserva la hora original de la cita |
| No da fecha | propone 3 días después, misma hora |
| La fecha propuesta ya pasó | pasa al fallback de 3 días |
| La fecha cae en domingo | se mueve al lunes (consultorio cerrado) |
| Fecha absurda (> 120 días) | fallback de 3 días |

---

## 4. Cancelación

**Paciente:** `cancelo mi cita, no voy a poder`

```
Entendido Ana. Tu cita quedó cancelada.

Cuando quieras retomarla, responde a este mensaje y te damos opciones de horario. Cuídate mucho.
```

→ `CANCELADA_POR_PACIENTE`, evento de Google con `status: cancelled`, los
recordatorios pendientes se omiten y la asistente recibe alerta **alta** (una
cancelación es una silla vacía que hay que recuperar).

---

## 5. Preguntas administrativas

Se responde al instante y **también** se avisa a la asistente, porque casi toda
duda termina necesitando a una persona.

| Pregunta detectada | Respuesta base |
|--------------------|----------------|
| tarjeta, efectivo, transferencia, meses sin intereses | "Aceptamos efectivo, tarjeta de débito/crédito y transferencia…" |
| precio, costo, presupuesto | "El costo depende del tratamiento y de una valoración previa…" |
| horario, a qué hora abren | "Atendemos de lunes a sábado…" |
| dirección, ubicación, estacionamiento | "La asistente te envía la ubicación exacta…" |
| seguro, factura, reembolso | "Trabajamos con algunas aseguradoras y emitimos factura…" |
| cualquier otra duda | "La asistente revisará tu pregunta y te responde en breve 🙏" |

Nunca se da un precio cerrado ni un diagnóstico por WhatsApp.

---

## 6. Mensaje que no se entiende

```
Perdón, no entendí tu mensaje 🙏

Puedes escribirme, por ejemplo:
• "Sí, confirmo"
• "No puedo, cámbiamela para el jueves"

O si prefieres, la asistente te responde en un momento.
```

→ Alerta `⚠️ [ALTA] Mensaje de paciente sin interpretar` con teléfono y texto
original. La asistente tiene el contexto completo en la base (`Mensaje`).

---

## 7. Sin cita asociada

Si el teléfono no tiene ninguna cita reciente (paciente nuevo, número equivocado,
mensaje desde otro teléfono):

```
Gracias por escribirnos. No encontré una cita reciente asociada a este número.

Para ayudarte, envíanos tu nombre completo y la fecha de tu cita, y la asistente te responde en breve.
```

→ Se escala; nunca se confirma ni se cancela "a ciegas".

---

## 8. Seguimiento multisesión (proactivo)

### Aviso antes del intervalo (endodoncia, día 5)

```
Hola Ana 👋, te escribimos del consultorio de la Dra. Laura.

Ya casi toca tu siguiente sesión de endodoncia. ¿Cómo ha evolucionado el diente? ¿Sigues con alguna molestia?

Si todo va bien, te agendamos la siguiente sesión para terminar el tratamiento. ¿Te viene bien esta semana?
```

### Con retraso (endodoncia, día 21)

```
Hola Ana 👋, del consultorio de la Dra. Laura.

Han pasado 21 días desde tu última sesión de endodoncia y el tratamiento aún no está terminado.
Aunque ya no sientas dolor, el conducto sigue abierto y puede reinfectarse.

¿Te agendamos esta semana para cerrarlo?
```

Y en paralelo, alerta interna:

```
⚠️ [ALTA] Riesgo de abandono de tratamiento
Ana Ruiz lleva 21 días sin sesión de Endodoncia (tratamiento de conducto).
Ya se le escribió sin respuesta: requiere llamada.
```

### Si el paciente responde

| Respuesta | Interpretación | Efecto |
|-----------|----------------|--------|
| "sí, agendemos" | `CONFIRMAR` | se confirma la cita existente o se escala para agendar |
| "no siento nada, ya no voy" | `CANCELAR` | se cancela y se avisa a la Dra. Laura (caso clínico) |
| "¿cuánto falta?" | `DUDA` | respuesta administrativa + escalado |

---

## 9. Guardas de convivencia

1. **Horario de silencio:** nada se envía entre 21:00 y 08:00; lo vencido se
   reprograma a las 08:00 del día siguiente.
2. **Consentimiento:** sin `consentWhatsapp` no se envía nada proactivo; se alerta
   a la asistente para pedirlo.
3. **Un mensaje por disparador y cita** (restricción única en base de datos).
4. **No se persigue a quien ya confirmó** con recordatorios de confirmación.
5. **Anti-spam en seguimiento:** mínimo 5 días entre mensajes al mismo paciente y
   se omite si ya tiene cita de continuación agendada.
6. **Dedupe de webhook:** el `id` del mensaje de WhatsApp se guarda; un reintento
   de Evolution no ejecuta dos veces una reprogramación.
7. **Sin contenido clínico:** sólo fecha, hora, nombre y tipo general de tratamiento.

---

## 10. Textos por disparador

| Disparador | Tipo | Destinatario | Función en `mensajes.ts` |
|------------|------|--------------|--------------------------|
| `D_MINUS_3D` | recordatorio + confirmación | paciente | `recodatorioTresDias` |
| `D_MINUS_24H` | recordatorio + confirmación | paciente | `recordatorio24Horas` |
| `D_MINUS_2H` | recordatorio | paciente | `recordatorio2Horas` |
| `D_MINUS_0H` | recordatorio | paciente | `recordatorioHoy` |
| confirmación | respuesta | paciente | `confirmacionRecibida` |
| reprogramación | respuesta | paciente | `citaReprogramada` |
| cancelación | respuesta | paciente | `citaCancelada` |
| duda | respuesta | paciente | `respuestaFrecuente` |
| no entendido | respuesta | paciente | `noEntendido` |
| seguimiento | proactivo | paciente | `mensajeSeguimiento` / `protocolos.ts` |
| resumen, sin confirmar, abandono | interno | asistente | `alertas.ts` |

---

## 11. Conversación real (salida de `npm run demo`)

```
📥 Paciente: hola, ¿llevan tarjeta?
➡️  RESPONDIDA · DUDA

📥 Paciente: no puedo ir, cámbiamelo para el jueves
➡️  REPROGRAMADA · REPROGRAMAR
🗓️  Recordatorios reprogramados

📥 Paciente: sí, ahí estaré
➡️  CONFIRMADA · CONFIRMAR

📥 Paciente: mejor cancelo, no voy a poder
➡️  CANCELADA · CANCELAR
```

Ese recorrido se ejecuta sin base de datos, sin WhatsApp y sin Google: son los
mismos handlers de producción con dobles en memoria.

---

## 12. Cuándo entra la asistente (panel)

El bot resuelve lo predecible; el panel existe para lo que no lo es:

| Situación | Dónde aparece | Qué hace la asistente |
|-----------|---------------|-----------------------|
| Cita sin confirmar a 48 h | pestaña **Pendientes** | llama, escribe o mueve la cita |
| Paciente escribió y el bot no supo qué hacer | franja superior + **Conversaciones** (`sin responder` tras 15 min sin respuesta) | lee el hilo y responde desde el panel |
| Tratamiento pasado de intervalo sin siguiente cita | **Tratamientos** (severidad `retraso`/`critico`) | envía el seguimiento o llama |
| Falta consentimiento de WhatsApp | alerta del scheduler (24 h antes) + interruptor en **Pacientes** | pide autorización y la activa |
| WhatsApp/Evolution caído | franja superior | revisa la instancia; el panel no bloquea la agenda |

Responder desde el panel **no** salta las reglas: el mensaje se envía por el
mismo número, exige `consentWhatsapp` y queda registrado en `Mensaje` con tipo
`manual:asistente` para conservar la auditoría. Si la asistente responde, la
conversación deja de contarse como pendiente.
