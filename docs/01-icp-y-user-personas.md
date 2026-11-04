# docs/01-icp-y-user-personas.md

# Parte 1 — ICP y user personas del consultorio dental (Dra. Laura)

> **Documento de fundamentación** para el entregable de la Clase 3 del curso
> *Fundamentos de Product Engineering con IA — Infra for AI Products: Deploying
> to Production*.
>
> Objetivo: fundamentar la solución de automatización (recordatorios, confirmación,
> seguimiento de tratamientos) con un **ICP** claro y **personas** que guíen el
> diseño, antes de escribir la SPEC de la característica nueva.

---

## 1. Resumen ejecutivo

El consultorio dental en estudio (**Consultorio Dra. Laura**) es una práctica
pequeña: **una sola dentista (Dra. Laura) + una sola asistente**. La agenda vive en
**Google Calendar** y funciona bien; la comunicación con los pacientes se hace por
**WhatsApp, de forma manual**. El problema central: **~30 % de los pacientes no
asiste a su cita** (hipótesis del proyecto, no medición) y los **tratamientos de
varias sesiones** (endodoncias, ortodoncia, prótesis) se abandonan a mitad, porque
el paciente deja de sentir dolor y nadie le da seguimiento.

La asistente dedica buena parte de la mañana a enviar recordatorios por WhatsApp
uno por uno.

Este documento define:

1. El **ICP** (Ideal Customer Profile) del consultorio.
2. Las **user personas** principales: la Dra. Laura (decisora) y la asistente
   (operadora diaria).
3. La **persona secundaria del paciente**.
4. Los **supuestos** explícitos que completé y que deben validarse.
5. Las **implicaciones para la automatización**.

---

## 2. ICP del consultorio dental (Ideal Customer Profile)

### 2.1 Atributos del ICP

| Atributo | Descripción | Estado |
|---|---|---|
| **Tipo de práctica** | Consultorio dental privado con atención de especialidades múltiples: endodoncia, ortodoncia, prótesis, implantes y controles. Una silla de tratamiento principal (supuesto). | Supuesto |
| **Tamaño** | 1 dentista fundadora + 1 asistente clínica. Pacientes activos estimados: **~150–250** (supuesto). Volumen de citas: **~15–25 por semana** (supuesto). | Supuesto |
| **Estructura de personal** | Dra. Laura (dueña, decisora y cirujana) + asistente (1). No hay segundo dentista ni recepcionista dedicada (supuesto). | Supuesto |
| **Herramientas actuales** | Google Calendar (agenda, funciona bien, **no se reemplaza**), WhatsApp (número del consultorio, uso manual), sin software de gestión/consultorio (supuesto), sin expediente clínico digital (fuera de alcance por diseño). | Supuesto |
| **Nivel de madurez tecnológica** | Bajo/nulo: uso de smartphone, calendario y WhatsApp. No ha usado software de salud ni bots (supuesto). | Supuesto |
| **Presupuesto probable** | Mínimo / casi nulo: no compra SaaS de automatización, retención o gestión clínica (supuesto: sin presupuesto de ~300–1,000 USD/mes para esta clase de herramientas). | Supuesto |
| **Zona / mercado** | Zona urbana de México (supuesto: Ciudad de México o área metropolitana). Configuración técnica: `TIMEZONE=America/Mexico_City`, `WHATSAPP_PAIS=52` (supuesto). | Supuesto |

### 2.2 Por qué este consultorio es un buen candidato

1. **Volumen controlable**: decenas de citas a la semana → una solución simple
   (tabla + cron, sin Redis/BullMQ, sin microservicios) es suficiente y de bajo
   costo.
2. **Dolor cuantificable**: ~30 % de inasistencias (hipótesis) y abandono de
   tratamientos son pérdidas directas de ingreso con un solo operador.
3. **Presupuesto ajustado**: excluye soluciones SaaS caras de salud; la vía viable
   es low-cost / no-code / reglas deterministas + LLM opcional.
4. **Confianza del dueño en la agenda**: Google Calendar es fuente de verdad y
   funciona bien → no hay objeción de reemplazo de agenda.
5. **Capacidad de adopción**: un solo decisor (Dra. Laura) + una operadora diaria;
   se puede diseñar un flujo con pocas piezas.

### 2.3 Por qué NO es un buen candidato (filtro de contraste)

Este consultorio **no** sería candidato si:

- Tuviera más de una dentista o varias sucursales (necesitaría multi-instancia).
- Ya usara software de gestión clínica con historial clínico (se sale del alcance).
- Tuviera presupuesto SaaS significativo y volumen alto (p. ej. más de 3 dentistas).
- Necesitara facturación integrada o atención internacional con requisitos
  regulatorios distintos.

---

## 3. User personas

### 3.1 Persona principal #1 — Dra. Laura (la decisora)

| Atributo | Detalle |
|---|---|
| **Nombre ficticio** | Dra. Laura (identidad real del consultorio, tratada como persona) |
| **Edad aproximada** | 38 años (supuesto) |
| **Rol** | Cirujana dental / especialista endodoncista, fundadora y única dentista. Decide clínica y operativamente. |
| **Contexto de trabajo** | Atiende ella misma las especialidades (endodoncia, ortodoncia, prótesis, implantes, controles). La asistente agenda y gestiona WhatsApp. |
| **Jornada típica** | Bloques clínicos con pacientes complejos (endodoncia: 2–4 sesiones; ortodoncia: controles) y controles; la asistente cubre agenda/WhatsApp; jornada estimada ~08:00–20:00 (supuesto). |
| **Frustraciones concretas** | (a) La silla vacía: ~30 % de inasistencias (hipótesis) = ingresos perdidos. (b) Abandono de tratamientos multisesión cuando el dolor se apaga. (c) La asistente se consume las mañanas en recordatorios manuales. (d) No tiene visibilidad de quién confirmó / no asistió sin revisar chats. |
| **Qué la haría adoptar la solución** | Ver una reducción medible de inasistencias; recuperar huecos; que la asistente gane tiempo; que Google Calendar siga siendo la fuente de verdad; que el bot no dé consejos clínicos ni negocie tratamientos; que los mensajes sean en español, sin culpar. |
| **Qué la haría rechazarla** | Complejidad de otra herramienta; costo; sensación de "bot farmacéutico"; que se reemplace su agenda; que el bot diagnostique o prometa resultados. |

### 3.2 Persona principal #2 — La asistente (la operadora diaria)

| Atributo | Detalle |
|---|---|
| **Nombre ficticio** | Mariana G. (nombre ficticio, supuesto) |
| **Edad aproximada** | 30 años (supuesto) |
| **Rol** | Asistente dental / recepcionista clínica. Opera el panel, la agenda, los recordatorios y las excepciones. |
| **Contexto de trabajo** | Jornada completa dedicada a recordatorios uno por uno; gestiona agenda en Google Calendar; responde conversaciones; prepara citas. |
| **Jornada típica** | ~07:30–21:00, con bloques del scheduler: 07:30 resumen de agenda, 08:00 sincronización + recordatorios, 09:00 alertas de citas sin confirmar, 18:00 seguimiento de tratamientos. Ventana de envío de WhatsApp: 08:00–21:00 (regla de negocio). |
| **Frustraciones concretas** | (a) No puede escalar: la carga manual crece con el número de pacientes. (b) Persigue a quien ya confirmó (recordatorios contradictorios). (c) Reprogramar una cita es manual: mover evento en Calendar, avisar paciente, recalcular recordatorios. (d) Conversaciones sin respuesta quedan a medias sin alerta clara. (e) Pacientes sin consentimiento reciben mensajes o no. |
| **Qué la haría adoptar la solución** | Panel en tablet con agenda del día, pendientes y tratamientos en riesgo, acciones en un clic; que el bot no invente citas ni mensajes; errores de WhatsApp en lenguaje humano; que pueda responder manualmente desde el panel respetando consentimiento. |
| **Qué la haría rechazarla** | Complejidad técnica; que tenga que revisar 40 chats; que el panel requiera muchas contraseñas/roles; que el flujo de reprogramación sea fricción. |

### 3.3 Cómo se complementan

- **Dra. Laura** (decisora): duda de confianza ("si el panel dice confirmada, es
  verdad"), no quiere vigilancia constante, no quiere otra herramienta.
- **Asistente** (operadora): duda de operación ("¿qué hago con este chat?"),
  necesita que el sistema filtre excepciones y le deje acciones en un clic.

---

## 4. Persona secundaria del paciente — el que falta o abandona

### 4.1 Perfil

| Atributo | Detalle |
|---|---|
| **Nombre ficticio** | Carlos (nombre ficticio, supuesto) |
| **Edad aproximada** | 28–40 años (supuesto) |
| **Contexto** | Paciente que inició un tratamiento multisesión (p. ej. endodoncia) y **abandonó a mitad**, o que **falló una cita** (no asistió). |
| **Motivos probables de inasistencia/abandono** | (i) Desaparición del dolor (el motor se apaga). (ii) Miedo al tratamiento (endodoncia, dolor). (iii) Costo / disposición económica. (iv) Olvido (agenda sin recordatorio eficaz). (v) Horario (conflicto con agenda). |

### 4.2 Qué tipo de mensaje / recordatorio tendría más efecto

- Mensaje breve, empático, sin culpabilizar ("es normal que el dolor baje", "no
  estás sola en el tratamiento").
- **Acción simple de un toque**: "¿Te agendamos la siguiente sesión?" con opciones o
  respuesta corta.
- Envío **antes** del intervalo esperado (aviso anticipado del protocolo), no solo
  el recordatorio de cita.
- Sin datos clínicos; solo fecha, hora, nombre del tratamiento y tono humano.

---

## 5. Supuestos explícitos (para validar)

Lista de datos completados por el consultor y marcados como **supuestos**:

| Dato | Supuesto | Validación requerida |
|---|---|---|
| Ciudad / zona geográfica del consultorio | Zona urbana de México (CDMX/metrópoli; supuesto) | Dirección real del consultorio |
| Número de pacientes activos | ~150–250 (supuesto) | Export de pacientes activos |
| Ticket promedio / valor de tratamiento | Supuesto: ~$1,000–1,500 MXN por consulta o tratamiento (financiación/consulta); endodoncia/ortodoncia valores mayores (supuesto) | Historial de ingresos |
| Canal preferido de recordatorio | WhatsApp (número del consultorio) (supuesto) | Encuesta/observación |
| Tasa real de no-show | **Hipótesis del proyecto: ~30 %** (no es medición) | Análisis de registros históricos |
| % de abandono de tratamientos multisesión | Supuesto: alta (p. ej. ~50–60 % de los iniciados no completan; supuesto) | Historial de sesiones/protocolos |
| Presupuesto del consultorio para automatización | Mínimo / casi nulo (supuesto) | Presupuesto real |
| Número de sillones / capacidad | 1 sillón principal (supuesto) | Observación clínica |
| Frecuencia de citas | ~15–25 por semana (supuesto) | Agenda real |

---

## 6. Implicaciones para la automatización (en pocas líneas)

El flujo debe resolver, como mínimo:

1. **Recordatorios automáticos desde Google Calendar por WhatsApp** con consentimiento
   explícito, ventana de envío 08:00–21:00, escalera de 3 días / 24 h / 2 h / mismo
   día, botones de confirmación y reprogramación, y omisión por consentimiento/estado.
2. **Seguimiento de tratamientos multisesión**: avisos proactivos antes del intervalo,
   secuencia de re-activación ante abandono y escalamiento a la asistente; sin
   diagnóstico ni datos clínicos por WhatsApp.

Sin diseñar todavía los pasos técnicos: eso corresponde a la SPEC de la característica
nueva (Parte 2 de esta entrega).
