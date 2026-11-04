# SPEC-002 — Seguimiento proactivo ante abandono en tratamientos multisesión

| Campo | Valor |
|---|---|
| **ID** | SPEC-002 |
| **Estado** | Propuesta · Clase 3 (validación con la Dra. Laura) |
| **Versión** | 1.0 |
| **Fecha** | 2026-11-04 |
| **Dueño del producto** | Dra. Laura (consultorio dental) |
| **Usuario operativo** | Asistente del consultorio |
| **Autores** | Equipo del proyecto + IA (ver Apéndice A) |
| **Documentos relacionados** | `SPEC-001 — Recordatorios inteligentes`, `README.md`, `docs/FLUJOS_CONVERSACIONALES.md`, `docs/ARCHITECTURE.md` |
| **Código relacionado** | `src/scheduler/seguimiento.service.ts`, `src/services/protocolos.ts`, `src/services/nlu.ts`, `src/services/mensajes.ts` |

---

## 1. Problema

### 1.1 Contexto

El consultorio de la Dra. Laura atiende con **una sola asistente** y una sola
dentista. Su agenda está en Google Calendar; la comunicación con pacientes en
WhatsApp es manual.

El **SPEC-001** ya cubrió la primera pérdida: **inasistencias** (escalera de
recordatorios, confirmación con botones, reprogramación). El **motor de seguimiento
multisesión** (`seguimiento.service.ts`) ya avisa al paciente *antes* de que venza el
intervalo del protocolo y alerta a la asistente cuando hay retraso.

Sin embargo, la **segunda pérdida del proyecto — el abandono de tratamientos
multisesión— sigue incompleta como flujo gestionado**: cuando el paciente deja de
sentir dolor y no retoma la serie de sesiones, no existe hoy una **secuencia de
re-activación** formalizada ni un criterio explícito de "abandono" que ordene las
intervenciones (mensaje de retención → re-actuación → escalamiento humano).

### 1.2 Dolencias concretas

1. **El dolor se apaga y el tratamiento se abandona.** El paciente no siente molestia
   y deja de asistir; el conducto, la ortodoncia o la prótesis quedan sin cerrar.
2. **El aviso existe pero no hay "plan B" automatizado.** El aviso anticipado se envía,
   pero si el paciente no responde, la decisión de re-activar o escalar la toma la
   asistente de forma ad hoc, con riesgo de olvidos y de mensajes repetidos.
3. **La asistente entra en modo reactivo.** Toda la carga de seguimiento multisesión
   pasa a ser trabajo manual y no estructurado.

### 1.3 Declaración del problema

> Cuando un paciente abandona un tratamiento multisesión por desaparición del dolor,
> la clínica no tiene un flujo automatizado que (a) refuerce la retención antes del
> cierre del protocolo, (b) re-active al paciente si no retoma, y (c) escale a la
> asistente cuando el retraso lo amerita.

### 1.4 Por qué una solución genérica no basta

- Un recordatorio de cita genérico no entiende el estado clínico del tratamiento.
- Un mensaje masivo no respeta el protocolo (aviso anticipado, umbrales) ni el
  consentimiento.
- Un bot que negocia o presiona al paciente sería contraproducente; la escalación a
  humano es la salida correcta para lo dudoso.

---

## 2. Objetivo y métricas

### 2.1 Resultado esperado

Que el **flujo de retención** garantice que, dentro del protocolo clínico, el paciente
reciba el mensaje de seguimiento correcto en el momento correcto, que no reciba
duplicados, y que cuando el tratamiento se retrase de forma significativa se
active una alerta con la asistente — sin que la Dra. Laura tenga que "hacer
mano" el seguimiento.

### 2.2 Métricas de éxito de la característica (NUEVA SPEC)

| Métrica | **Línea base** | **Meta** |
|---|---|---|
| **% de tratamientos multisesión completados** (iniciados que terminan el protocolo) | **Supuesto: ~40 %** (no medida) | **≥ 70 %** a los 6 meses de operación |
| **Tasa de abandono de tratamientos** (no completar el protocolo) | **Supuesto: ~60 %** (derivado) | **Reducción ≥ 20 puntos %** |
| **Tiempo diario de la asistente dedicado a seguimiento manual** | **Supuesto: 30–45 min/día** | **≤ 10 min/día** |
| **Tasa de respuesta / agendamiento al seguimiento proactivo** | **Supuesto: 0 (no se medía)** | **≥ 30 %** del seguimiento enviado responde o agenda |

> Las dos primeras ya aparecen como métricas del proyecto en `SPEC-001` y `README.md`;
> aquí se consolidan las de retención con línea base y meta explícitas para esta
> característica.

### 2.3 Métricas de guarda (no sacrificar)

- **0 mensajes de seguimiento fuera de horario (08:00–21:00)** y **0 duplicados**.
- **0 mensajes sin consentimiento**.
- **0 alertas / mensajes clínicos** (diagnóstico, recomendación de tratamiento) enviados por el bot.
- Que la agenda en Google Calendar siga siendo la fuente de verdad.

---

## 3. Usuarios y trabajos por hacer

### 3.1 Dra. Laura (dueña)

- **Quiere:** que los tratamientos se completen y que la agenda no pierda huecos.
- **Necesita:** confianza de que el seguimiento está activo sin vigilancia manual.

### 3.2 Asistente (operadora diaria)

- **Quiere:** que el sistema gestione el seguimiento; ella solo intervenga en
  excepciones y en las decisiones humanas.

### 3.3 Paciente

- **Quiere:** sentirse acompañado en el tratamiento, sin presión excesiva.

### 3.4 Historias de usuario

- **HU-6:** Como paciente con tratamiento en curso, quiero recibir el seguimiento
  proactivo antes de que venza el intervalo para no abandonar por desaparición del dolor.
- **HU-7:** Como asistente, quiero que el sistema detecte el abandono temprano y me
  alerte con contexto, sin que yo tenga que revisar el historial manualmente.
- **HU-8:** Como paciente, quiero responder "no puedo / cámbiame" desde el seguimiento
  y que se recalculen los recordatorios.

---

## 4. Alcance

### 4.1 Dentro del alcance

- Disparador de seguimiento proactivo usando los protocolos existentes
  (`diasEntreSesiones`, `avisoAnticipado`, `umbralAlerta`, `umbralCritico`).
- Secuencia de **re-activación** (un único mensaje) cuando el paciente no ha
  retomado y el retraso lo amerita.
- **Escalamiento** a la asistente (alerta) cuando el retraso supera el umbral crítico.
- Integración con la respuesta del paciente (re-agendado / pausa) y recalculo de
  recordatorios.

### 4.2 Fuera del alcance

- Diagnóstico, recomendación de tratamiento o presión de compra por WhatsApp.
- Facturación, expediente clínico, lista de espera automática, llamadas/voz.
- Cambios a los protocolos clínicos sin aprobación de la Dra. Laura.

---

## 5. Diseño de la solución

### 5.1 Principios de diseño

1. **Retención antes que castigo:** el mensaje de seguimiento es proactivo y no
   culpa.
2. **Protocolo como código configurable:** los umbrales viven en `protocolos.ts`.
3. **Una sola acción por disparador:** anti-spam y deduplicación.
4. **Excepción = humano:** la alerta a la asistente es el terminal de la
   automatización.

### 5.2 Flujo de retención / re-activación

```
Tratamiento en curso (última sesión completada)
        │
        ▼
Dentro del aviso anticipado (dias < diasEntreSesiones − avisoAnticipado)?
        ├─ No → no molestar (regla existente)
        └─ Sí → enviar mensaje proactivo (consentimiento + teléfono) → registrar
                                                    │
                                                    ▼
                                   ¿Paciente respondió / agendó continuación?
                                   ├─ Sí → cierre del ciclo (dejar de escribir hasta nuevo tratamiento)
              └─ No → ¿retraso ≥ umbral crítico?
                        ├─ No → volver al job en el próximo disparador
                        └─ Sí → enviar UNA re-actuación → alerta ALTA a la asistente
```

### 5.3 Integración con el ciclo existente

- Reusa `ejecutarSeguimientoDiario`, `obtenerProtocolo` y los mensajes existentes.
- No duplica lógica: la re-actuación es un disparador nuevo dentro del job.
- Si el paciente responde con intención de reagendar, el flujo existente
  (NLU → reprogramar) debe continuar; aquí solo se garantiza la coordinación.

---

## 6. Criterios de aceptación (OBLIGATORIO — 4 criterios)

### AC-01 — El aviso proactivo de retención se envía respetando consentimiento y anti-repetición

**Dado** un tratamiento en curso con última sesión completada, sin continuación
agendada, y dentro del aviso anticipado del protocolo (consentimiento y teléfono
del paciente presentes),
**Cuando** el job de seguimiento ejecuta,
**Entonces** envía el mensaje proactivo correspondiente (uno por disparador/ventana)
y lo registra en el historial.

**Verificación**

- Prueba unitaria del job de seguimiento: `tests/unit/seguimiento*.test.ts` (spec
  nueva, fase F2 del plan de reconstrucción).
- Comando: `npx vitest run tests/unit/seguimiento`.

### AC-02 — No se reenvía mientras no corresponde (anti-spam)

**Dado** que el seguimiento ya se envió recientemente para ese tratamiento/paciente,
**Cuando** el job evalúa de nuevo,
**Entonces** no reenvía (anti-repetición con mínimo de días / idempotencia).

**Verificación**: prueba unitaria del job con paciente ya contactado recientemente.

### AC-03 — Escalamiento ante abandono temprano con alerta a la asistente

**Dado** que el retraso del tratamiento supera el umbral crítico del protocolo,
**Cuando** el job ejecuta,
**Entonces** envía una única re-actuación y genera **alerta ALTA** a la asistente,
sin que el bot inicie diagnóstico ni presión.

**Verificación**: prueba unitaria del job + verificación de `AlertService` (alerta
sin diagnóstico).

### AC-04 — Cobertura de respuesta: si el paciente reagenda/pausa, el flujo continúa

**Dado** que el paciente responde desde el seguimiento con intención de reagendar/pausa,
**Cuando** el NLU resuelve la intención,
**Entonces** se agenda la continuación (máximo un reagendamiento) y se recalculan los
recordatorios para la nueva fecha.

**Verificación**: pruebas existentes de NLU/handler para reprogramar + coordinación
con el job.

---

## 7. Métricas de éxito (OBLIGATORIO)

| Métrica | Línea base | Meta | Cómo se mide |
|---|---|---|---|
| % de tratamientos multisesión completados | ~40 % (supuesto) | ≥ 70 % (6 meses) | `Cita`/`Tratamiento` completados vía panel/DB |
| Tasa de abandono de tratamientos | ~60 % (supuesto) | Reducir ≥ 20 pts % | Evolución de completitud |
| Tiempo diario de la asistente en seguimiento manual | 30–45 min/día (supuesto) | ≤ 10 min/día | Encuesta/observación + conteo de alertas/mensajes |
| Respuesta / agendamiento al seguimiento proactivo | 0 (no medido) | ≥ 30 % | `mensaje` + acciones de reagendado |

---

## 8. Requisitos no funcionales (resumen)

- **Latencia**: el seguimiento se evalúa en el job del scheduler (ventana 18:00).
- **Idempotencia**: un mismo disparador no se procesa dos veces.
- **Consentimiento**: sin consentimiento, omitir (regla del proyecto).
- **Seguridad/privacidad**: mensaje sin contenido clínico.

## 9. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El mensaje de re-actuación se vuelve spam | Medio | Un disparador nuevo + anti-repetición |
| El bot escala ante lo dudoso | Alto | Escalación humana sin diagnóstico |
| Umbrales desajustados | Medio | Protocolos editables en `protocolos.ts` |

## 10. Preguntas abiertas

- Q-6: ¿Conviene una ventana de "re-activación" distinta al aviso anticipado?
- Q-7: ¿Cuántos mensajes de re-actuación se envían antes de escalar (actual: 1)?

## 11. Historial de cambios

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 2026-11-04 | SPEC de la característica nueva (retención/re-activación). |
