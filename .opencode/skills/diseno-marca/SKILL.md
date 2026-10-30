---
name: diseno-marca
description: Guía de marca, UI y tono para DentalCare / Consultorio Dra. Laura. Úsala siempre que crees o revises pantallas del panel, componentes, estados, colores, tipografía, textos para pacientes o accesibilidad. Triggers: marca, branding, UI, panel, colores, tipografía, diseño, accesibilidad, tono, copy, WhatsApp, botones, formularios, estados vacíos.
---

# Diseño de marca — DentalCare

Esta skill define cómo se ve, se siente y se lee el producto. No es un catálogo de
gustos: es un conjunto de decisiones para que la asistente confíe en el panel y el
paciente sienta calma, no presión.

**Fuente de verdad visual:** `public/styles.css`. Si cambias un token allí,
actualiza esta guía en el mismo cambio. No introduzcas colores, sombras ni radios
nuevos sin una razón documentada.

---

## 1. Cuándo usar esta skill

- Crear o modificar una pantalla, tarjeta, tabla, diálogo o toast del panel.
- Diseñar un estado vacío, de error, de carga o de éxito.
- Escribir o revisar mensajes de WhatsApp para pacientes.
- Revisar accesibilidad, contraste, foco o tamaño táctil.
- Decidir la jerarquía de una nueva vista (qué se ve primero).
- Evaluar si una propuesta “se siente” como el consultorio.

**No la uses para:** arquitectura de datos, reglas de negocio, elección de
frameworks o copy legal. Para eso, consulta `AGENTS.md` y la spec correspondiente.

---

## 2. Núcleo de marca

| Atributo | Qué significa en pantalla | Qué evitar |
|---|---|---|
| **Serena** | Fondos claros, espacios en blanco, un acento teal | Saturación, gradientes, animaciones nerviosas |
| **Cercana** | Lenguaje de tú, nombre de pila, saludos breves | Formalidad rígida (“estimado paciente”) |
| **Competente** | Datos exactos, estados claros, acciones obvias | Ambigüedad, botones que no dicen qué hacen |
| **Discreta** | Sólo la información necesaria; nada clínico de más | Morbo, diagnósticos, urgencia falsa |
| **Humana** | Si no se entiende, aparece una persona | Fingir que el bot lo resuelve todo |

**Idea rectora:** *“Todo en orden, sin prisa.”* La asistente debe sentir que el
sistema le quita trabajo, no que le da otra tarea.

---

## 3. Paleta

Tokens actuales (no inventar variantes):

| Token | Hex | Uso |
|---|---|---|
| `--fondo` | `#f2f7f6` | Fondo general de la app |
| `--panel` | `#ffffff` | Tarjetas, barras, superficies |
| `--texto` | `#10302f` | Texto principal, títulos |
| `--suave` | `#5c7a79` | Metadatos, ayudas, texto secundario |
| `--borde` | `#dfeae8` | Bordes de tarjetas, separadores |
| `--marca` | `#0f766e` | Acción primaria, pestaña activa, mensajes OUT |
| `--marca-oscura` | `#0b5d56` | Hover de primario, texto sobre menta |
| `--marca-clara` | `#e4f3f0` | Fondos de apoyo, foco, bloque de hora |
| `--ok` | `#15803d` | Confirmada, conectado, éxito |
| `--ok-fondo` | `#e7f6ec` | Fondo de estado exitoso |
| `--alerta` | `#a35a07` | Pendiente, riesgo, atención |
| `--alerta-fondo` | `#fdf4e4` | Fondo de aviso |
| `--peligro` | `#b42318` | No asistió, error, cancelación |
| `--peligro-fondo` | `#fdeceb` | Fondo de error |

Reglas:

- **Un solo acento fuerte por vista.** El teal marca lo accionable; el naranja y el
  rojo se reservan para atención y error.
- **Nunca uses color como única señal.** Toda píldora de estado lleva texto.
- **Contraste mínimo AA (4.5:1)** para texto normal. `--suave` sobre `--fondo` es
  para texto secundario, no para párrafos largos.
- **Modo claro únicamente.** El consultorio trabaja de día; no hay tema oscuro.

---

## 4. Tipografía

- **Familia:** pila del sistema (`ui-sans-serif, system-ui, -apple-system, "Segoe UI",
  Roboto, "Helvetica Neue", Arial, sans-serif`). Sin fuentes decorativas ni descargas.
- **Base:** 16 px, `line-height: 1.45`.
- **Escala:**

| Rol | Tamaño | Peso | Nota |
|---|---|---|---|
| Métrica grande | `1.7rem` | 700 | Números de resumen |
| Título de tarjeta | `1.02rem` | 700 | Nombre del paciente |
| Cuerpo | `0.9–1rem` | 400–600 | Texto operativo |
| Metadato | `0.82rem` | 400 | Hora, teléfono, ayuda |
| Etiqueta de sección | `0.78rem` | 700 | MAYÚSCULAS, `letter-spacing: .09em` |
| Píldora | `0.72rem` | 700 | Estado |

- **Números de hora:** usa `font-variant-numeric: tabular-nums` para que las horas
  no “bailen” al actualizar la agenda.
- **Longitud de línea:** 60–75 caracteres en textos de ayuda.
- **No uses cursivas** para énfasis; usa peso o color.

---

## 5. Espacio, forma y profundidad

- **Escala de espacio:** 4, 8, 12, 16, 24, 32, 48 px.
- **Radios:** 10 px (botones/inputs), 12 px (filas), 14 px (tarjetas), 999 px (píldoras).
- **Sombra:** la única de `--sombra` (`0 1px 2px…, 0 10px 26px…`). No apiles sombras.
- **Ancho de contenido:** máximo 1080 px; el panel se centra.
- **Densidad:** cómoda, no compacta. La asistente lo usa en tablet, de pie.
- **Bordes:** 1 px `--borde`; el hover puede subir a `#cfdedb`. No uses bordes negros.

---

## 6. Componentes

### 6.1 Barra superior

- Fondo blanco, borde inferior, `position: sticky`.
- Marca: cuadro menta de 40×40 con el diente + nombre del consultorio + subtítulo
  con la fecha. El emoji 🦷 es un marcador provisional; sustituto ideal: diente de
  línea, mismo cuadro, sin degradado.
- Estado de conexión: punto + texto (“WhatsApp conectado” / “sin conexión”). Nunca
  sólo el punto.
- Acción “Actualizar” discreta (`btn-fantasma`).

### 6.2 Pestañas

- Forma de píldora; inactivas transparentes con texto `--suave`; activa con fondo
  `--marca` y texto blanco.
- Contador de pendientes en rojo (`--peligro`), sólo si hay algo que atender.
- En móvil/tablet: scroll horizontal sin barra visible; no se apilan.

### 6.3 Tarjetas y filas

- Tarjeta: fondo blanco, borde, radio 14, sombra suave, padding 16–18.
- Fila de cita: hora en bloque menta a la izquierda, nombre + motivo al centro,
  acciones a la derecha. En pantallas angostas, las acciones bajan debajo.
- **Jerarquía:** nombre > hora > motivo > acciones. El estado va junto al nombre.
- No uses tablas HTML para la agenda; usa grid de tarjetas.

### 6.4 Botones

- **Primario:** fondo `--marca`, texto blanco. Una sola acción primaria por vista.
- **Secundario:** blanco con borde. Para acciones reversibles.
- **Fantasma:** sin borde, para “Cancelar” o acciones terciarias.
- **Peligro:** texto rojo, borde rosado; nunca fondo rojo sólido para acciones
  destructivas (baja el miedo a equivocarse).
- **Tamaño táctil:** mínimo 44×44 px de área. El `.btn` actual mide ~34 px de alto;
  al tocar esa zona, sube `min-height: 44px` (o añade padding) sin romper la densidad.
- **Texto de acción:** verbo + objeto (“Mover y avisar”, “Guardar teléfono”), no
  “Aceptar” ni “OK”.
- **Deshabilitado:** opacidad 0.55 y `cursor: progress`; explica por qué si dura
  más de un segundo.

### 6.5 Píldoras de estado

| Estado | Clase | Color | Texto |
|---|---|---|---|
| Sin confirmar | `.pill.agendada` | Ámbar | “Sin confirmar” |
| Confirmada | `.pill.confirmada` | Verde | “Confirmada” |
| Movida | `.pill.reagendada` | Azul | “Movida” |
| Completada | `.pill.completada` | Teal | “Completada” |
| No asistió | `.pill.no_show` | Rojo | “No asistió” |
| Cancelada | `.pill.cancelada` | Gris | “Cancelada” |

Las píldoras siempre incluyen texto; el color acelera la lectura, no la sustituye.

### 6.6 Diálogos

- `<dialog>` nativo, ancho máximo 440 px, fondo blanco, radio 14, título claro.
- El título dice la acción (“Mover cita”), no “¿Estás seguro?”.
- Debajo, el nombre del paciente y una frase de consecuencia (“Se mueve el mismo
  evento y se recalculan los recordatorios”).
- Acciones alineadas a la derecha: Cancelar (fantasma) + acción (primario).
- Cierra con `Esc`, clic fuera y botón Cancelar. Devuelve el foco al botón que lo abrió.

### 6.7 Toasts y avisos

- Toast: abajo, fondo `--texto`, texto blanco, 3–4 s, `role="status"`.
- Aviso persistente: franja ámbar arriba, con acción (“Revisar configuración”).
- **Nunca** uses un toast para un error que requiere decisión; usa un aviso o diálogo.
- Errores: qué pasó + qué hacer. Ejemplo: “No se pudo avisar al paciente. Revisa
  la conexión de WhatsApp y vuelve a intentar.”

### 6.8 Estados vacíos

- Una frase humana, no un error técnico.
- Ejemplo: “No hay citas pendientes hoy. Buen momento para revisar tratamientos.”
- Si falta configuración, dilo y enlaza la guía; no muestres una pantalla en blanco.

### 6.9 Formularios

- Etiqueta visible arriba, no sólo placeholder.
- Inputs de 44 px de alto, borde `--borde`, foco con anillo `--marca-clara` y borde
  `--marca`.
- Ayuda debajo, en `--suave`, sólo si evita un error.
- Validación en el campo, no en un resumen arriba; mensaje específico.

---

## 7. Voz y tono

### 7.1 Mensajes a pacientes (WhatsApp)

- Español de México, **tuteo**, frases cortas.
- Un solo llamado a la acción por mensaje.
- Saludo con nombre de pila; nunca nombre completo ni apellidos.
- Emojis: máximo dos, funcionales (👋, 📅, 🦷, ✅). Nunca en un mensaje de error.
- Sin diagnósticos, sin precios cerrados, sin culpa, sin urgencia falsa.
- Si hay que mover o cancelar, confirma la nueva fecha con claridad.

**Bien:**
> Hola Ana 👋, tu cita es mañana a las 10:00. ¿Sigues viniendo?

**Mal:**
> Estimada paciente, le recordamos su cita odontológica. Confirme su asistencia a
> la brevedad posible o se aplicará un cargo.

### 7.2 Textos del panel

- Directos, operativos, sin jerga técnica.
- “Confirmada”, no “Estado actualizado a CONFIRMADA”.
- “No se pudo avisar”, no “Error 500 en Evolution”.
- Si algo falla, di qué puede hacer la asistente ahora.

### 7.3 Errores y límites

- No culpes al usuario ni al paciente.
- No prometas lo que el sistema no sabe (“ya quedó registrado en el satélite”).
- Si no se entiende: “Perdón, no entendí tu mensaje. Puedes escribir ‘Sí, confirmo’
  o ‘No puedo, cámbiamela para el jueves’.”

---

## 8. Accesibilidad

- **Contraste:** AA mínimo; revisa texto `--suave` sobre `--panel` y sobre `--fondo`.
- **Foco visible:** anillo de 2 px `--marca` con offset 2 px en todo elemento
  interactivo. No uses `outline: none` sin reemplazo.
- **Teclado:** todos los controles se alcanzan con Tab; los diálogos atrapan el foco
  y lo devuelven al cerrar.
- **Tamaño táctil:** 44×44 px mínimo en tablet.
- **Semántica:** `<button>` para acciones, `<a>` para navegación, `<dialog>` para
  modales, `aria-live="polite"` para la vista y los toasts.
- **No sólo color:** estados con texto, iconos con `aria-hidden` y etiqueta.
- **Movimiento reducido:** respeta `prefers-reduced-motion`; las transiciones son
  de 150–200 ms y nunca esenciales para entender.
- **Zoom:** el layout debe funcionar al 200 % sin scroll horizontal en 1024 px.

---

## 9. Iconografía e ilustración

- Un solo trazo, 1.5–2 px, esquinas redondeadas.
- Iconos funcionales: actualizar, reloj, teléfono, WhatsApp, alerta.
- No uses fotos de stock de sonrisas perfectas ni dientes 3D.
- El diente puede ser un emoji en prototipos; en producción, un SVG simple.
- No inventes mascotas ni personajes.

---

## 10. Movimiento

- Transiciones de 150 ms para hover/foco; 200 ms para aparición de diálogo.
- Nada de rebotes, parallax ni animaciones infinitas.
- La agenda se actualiza cada 30 s: el cambio debe ser silencioso, sin parpadeos.
- Respeta `prefers-reduced-motion: reduce`.

---

## 11. Proceso para diseñar una pantalla nueva

1. **Intención:** ¿qué decisión toma la asistente aquí? Escribe una frase.
2. **Jerarquía:** ¿qué debe ver primero? Un solo foco visual.
3. **Estados:** normal, vacío, cargando, error, sin permiso, éxito.
4. **Componentes:** reutiliza tarjeta, píldora, botón y diálogo existentes.
5. **Copy:** aplica la voz de la sección 7; revisa que no haya jerga.
6. **Accesibilidad:** teclado, foco, contraste, 44 px, texto alternativo.
7. **Prueba en tablet:** 768 px y 1024 px; luego móvil 390 px.
8. **Revisa la checklist** de la sección 13.

---

## 12. Errores de marca que debes evitar

| No hagas | Haz |
|---|---|
| Gradientes morados o “tech startup” | Teal sólido y fondos menta |
| Tarjetas con sombras profundas | Sombra única y sutil |
| Texto gris claro sobre blanco | `--texto` o `--suave` con contraste |
| Botones “OK” / “Aceptar” | Verbo + objeto |
| Estados sólo con color | Píldora con texto |
| Mensajes que culpan (“no confirmaste”) | “Si no puedes, avísanos y liberamos el espacio” |
| Emojis en cada línea | Máximo dos, con intención |
| Diagnósticos o precios en WhatsApp | “La asistente te confirma” |
| Animaciones para llamar la atención | Transiciones discretas |
| Fuentes decorativas | Pila del sistema |

---

## 13. Checklist antes de publicar UI

- [ ] Usa sólo tokens de `public/styles.css` (o justifica uno nuevo).
- [ ] Una acción primaria por vista; el resto son secundarias/fantasma.
- [ ] Todos los estados tienen texto, no sólo color.
- [ ] Contraste AA verificado en texto y botones.
- [ ] Foco visible y navegación completa por teclado.
- [ ] Área táctil ≥ 44×44 px en tablet.
- [ ] Estados vacío, cargando y error diseñados.
- [ ] Copy en español de México, tuteo, sin jerga ni culpa.
- [ ] Probado a 390, 768 y 1024 px.
- [ ] `prefers-reduced-motion` respetado.
- [ ] Sin datos reales de pacientes en capturas o demos.

---

## 14. Deuda visual conocida

- El logo es un emoji 🦷; sustituir por SVG cuando exista marca definitiva.
- `.btn` mide ~34 px de alto; elevar el área táctil a 44 px al tocar la zona.
- Algunos textos de ayuda usan `--suave` sobre `--fondo`; revisar contraste en
  pantallas con brillo bajo.
- No hay tema oscuro ni modo de alto contraste; no son requisitos actuales.

---

## 15. Referencias rápidas

- Tokens y componentes: `public/styles.css`
- Estructura del panel: `public/index.html`
- Lógica de vistas y copy dinámico: `public/app.js`
- Contexto del producto y reglas: `AGENTS.md`
- Funcionalidad principal: `specs/001-recordatorios-inteligentes/spec.md`
