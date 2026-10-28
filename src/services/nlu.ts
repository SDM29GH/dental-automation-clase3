/**
 * Comprensión de las respuestas del paciente (NLU).
 *
 * Estrategia en dos capas, de la más barata a la más cara:
 *   1. Botones de WhatsApp  → intención explícita, sin ambigüedad, coste cero.
 *   2. Reglas deterministas → español coloquial frecuente ("cámbiamelo para el jueves").
 *   3. LLM ligero           → sólo cuando las reglas no alcanzan, y si hay API key.
 *
 * La capa 3 es opcional: sin `LLM_API_KEY` el motor sigue funcionando y es
 * 100 % predecible, que es lo que un consultorio pequeño necesita el día 1.
 */
import { addDays, addMonths, format, isValid, parse } from "date-fns";
import { z } from "zod";
import { config } from "../config/index.js";
import { aUtcDesdeZona, formatear, hoyEnZona, partesEnZona, sumarDias } from "../utils/time.js";

export type Intento = "CONFIRMAR" | "REPROGRAMAR" | "CANCELAR" | "DUDA" | "OTRO";

export type FuenteNlu = "boton" | "regla" | "llm" | "fallback";

export interface NluResult {
  intento: Intento;
  /** Día propuesto, formato YYYY-MM-DD interpretado en la zona del consultorio. */
  nuevaFecha: string | null;
  /** Hora propuesta, formato HH:mm. */
  nuevaHora: string | null;
  zona: string;
  mensajeUsuario: string;
  nota: string;
  confianza: number;
  fuente: FuenteNlu;
}

export interface ProcessOptions {
  mensaje: string;
  esBoton?: boolean;
  botonId?: string;
  telefono?: string;
  citaId?: string;
}

// ---------------------------------------------------------------------------
// Normalización de texto
// ---------------------------------------------------------------------------

const sinAcentos = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const DIAS_SEMANA = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

// ---------------------------------------------------------------------------
// Fechas y horas en lenguaje natural (español)
// ---------------------------------------------------------------------------

/**
 * Interpreta una expresión de fecha y devuelve el día resuelto (a mediodía).
 * Soporta ISO, dd/MM/yyyy, "hoy", "mañana", "el jueves", "15 de noviembre".
 * Si la fecha ya pasó, se asume el siguiente ciclo (mes o semana siguiente).
 */
export function normalizarFecha(
  texto: string | null | undefined,
  base: Date = hoyEnZona()
): Date | null {
  if (!texto) return null;
  const limpio = sinAcentos(texto.trim());
  if (!limpio) return null;

  // ISO: 2026-11-05 o 2026-11-05T10:00
  const iso = limpio.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const fecha = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);
    return isValid(fecha) ? fecha : null;
  }

  // dd/mm/yyyy o dd/mm
  const barra = limpio.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (barra) {
    const dia = Number(barra[1]);
    const mes = Number(barra[2]);
    const anioTexto = barra[3];
    const anio = anioTexto
      ? anioTexto.length === 2
        ? 2000 + Number(anioTexto)
        : Number(anioTexto)
      : base.getFullYear();
    let fecha = new Date(anio, mes - 1, dia, 12);
    if (!isValid(fecha) || fecha.getDate() !== dia) return null;
    if (!anioTexto && fecha < base) fecha = addMonths(fecha, 12);
    return fecha;
  }

  // Relativos
  if (/\bpasado manana\b/.test(limpio)) return sumarDias(base, 2);
  if (/\bmanana\b/.test(limpio)) return sumarDias(base, 1);
  if (/\bhoy\b/.test(limpio)) return new Date(base);
  if (/\bayer\b/.test(limpio)) return sumarDias(base, -1);

  // "15 de noviembre" / "el 3 de diciembre de 2026"
  const conMes = limpio.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/);
  if (conMes) {
    const dia = Number(conMes[1]);
    const indiceMes = MESES.indexOf(conMes[2]);
    if (indiceMes >= 0) {
      const anio = conMes[3] ? Number(conMes[3]) : base.getFullYear();
      let fecha = new Date(anio, indiceMes, dia, 12);
      if (!conMes[3] && fecha < base) fecha = addMonths(fecha, 12);
      return isValid(fecha) ? fecha : null;
    }
  }

  // Día de la semana: "el jueves", "próximo lunes"
  const diaSemana = DIAS_SEMANA.findIndex((dia) => new RegExp(`\\b${dia}\\b`).test(limpio));
  if (diaSemana >= 0) {
    const hoy = base.getDay();
    let delta = (diaSemana - hoy + 7) % 7;
    if (delta === 0) delta = 7; // "el jueves" dicho en jueves = el próximo jueves
    if (/proxim|siguiente|entrante/.test(limpio) && delta < 7) {
      delta += delta === 0 ? 7 : 0;
    }
    return addDays(base, delta);
  }

  // "el 15" / "para el 15"
  const soloDia = limpio.match(/\b(?:el|para el|dia)\s+(\d{1,2})\b/);
  if (soloDia) {
    const dia = Number(soloDia[1]);
    if (dia >= 1 && dia <= 31) {
      let fecha = new Date(base.getFullYear(), base.getMonth(), dia, 12);
      if (!isValid(fecha) || fecha.getDate() !== dia) return null;
      if (fecha < base) fecha = addMonths(fecha, 1);
      return fecha;
    }
  }

  // Último recurso: formatos explícitos
  for (const patron of ["dd/MM/yyyy", "dd-MM-yyyy", "yyyy/MM/dd", "d 'de' MMMM"]) {
    const fecha = parse(texto, patron, base);
    if (isValid(fecha)) return fecha;
  }

  return null;
}

/** Interpreta una hora en lenguaje natural y la devuelve como "HH:mm". */
export function normalizarHora(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpio = sinAcentos(texto);

  // 18:30 / 9.15 / 10h
  const conMinutos = limpio.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (conMinutos) {
    const hora = Number(conMinutos[1]);
    const minuto = Number(conMinutos[2]);
    if (hora <= 23 && minuto <= 59) return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
  }

  // 10 am / 8 pm / 10 hrs / 6 de la tarde
  const simple = limpio.match(/\b(\d{1,2})\s*(am|pm|a\.?m\.?|p\.?m\.?|hrs?|horas?|h\b|de la (manana|tarde|noche))?/);
  if (simple) {
    let hora = Number(simple[1]);
    const sufijo = simple[2] ?? "";
    const esPm = /p\.?m\.?/.test(sufijo) || /tarde|noche/.test(sufijo);
    const esAm = /a\.?m\.?/.test(sufijo) || /manana/.test(sufijo);

    if (esPm && hora < 12) hora += 12;
    if (esAm && hora === 12) hora = 0;
    // "6 y media de la tarde" no se contempla: se redondea a en punto.
    if (hora >= 0 && hora <= 23) return `${String(hora).padStart(2, "0")}:00`;
  }

  return null;
}

/** Combina un día resuelto + "HH:mm" en el instante UTC correcto. */
export function combinarFechaHora(
  dia: Date,
  hora: string | null,
  zona: string = config.TIMEZONE
): Date {
  const [h, m] = (hora ?? "09:00").split(":").map(Number);
  return aUtcDesdeZona(dia.getFullYear(), dia.getMonth() + 1, dia.getDate(), h, m, zona);
}

// ---------------------------------------------------------------------------
// Capa 1: botones
// ---------------------------------------------------------------------------

function porBoton(mensaje: string, botonId: string): NluResult | null {
  const id = botonId.toLowerCase();
  const comun = {
    zona: config.TIMEZONE,
    mensajeUsuario: mensaje,
  };

  if (id.includes("confirmar") || id.includes("confirm")) {
    return { ...comun, intento: "CONFIRMAR", nuevaFecha: null, nuevaHora: null, nota: "Confirmación por botón.", confianza: 0.99, fuente: "boton" };
  }
  if (id.includes("reprogramar") || id.includes("reprogram") || id.includes("reagendar")) {
    return { ...comun, intento: "REPROGRAMAR", nuevaFecha: null, nuevaHora: null, nota: "Reprogramación por botón.", confianza: 0.99, fuente: "boton" };
  }
  if (id.includes("cancelar") || id.includes("cancel")) {
    return { ...comun, intento: "CANCELAR", nuevaFecha: null, nuevaHora: null, nota: "Cancelación por botón.", confianza: 0.99, fuente: "boton" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capa 2: reglas
// ---------------------------------------------------------------------------

interface ClasificacionRegla {
  intento: Intento;
  confianza: number;
  nota: string;
}

const PATRONES = {
  reprogramar:
    /(reprogram|reagend|cambi(a|ar|arlo|arla|amelo|amela|emos|en)|mover|movemos|mudar|mudemos|otra fecha|otro dia|otra hora|no puedo (ir|asistir|llegar|el|la|este|ese|esta|hoy|manana|pasado)|no podre (ir|asistir|llegar)|no me viene bien|no alcanzo|mejor (el|la|otro|otra|manana|pasado|a las|lunes|martes|miercoles|jueves|viernes|sabado|domingo))/,
  cancelar:
    /(cancel|anul|dar de baja|ya no voy|ya no puedo|ya no quiero|no voy a ir|no asistire|no pienso ir|suspender|dejar el tratamiento)/,
  confirmar:
    /(^|\b)(si|simon|claro|ok|okay|va|vale|confirmo|confirmado|confirmamos|asisto|asistire|ahi estare|nos vemos|llegare|de acuerdo)(\b|$)/,
  duda: /(cuanto|cuesta|precio|costo|tarjeta|efectivo|transferencia|horario|a que hora abren|direccion|donde estan|estacionamiento|seguro dental|factura)/,
  saludo: /^(hola|buenos dias|buenas tardes|buenas noches|que tal|hey|buen dia)\b/,
};

/** Clasificación determinista. Devuelve null si no hay señal suficiente. */
export function clasificarPorReglas(mensaje: string): ClasificacionRegla | null {
  const texto = sinAcentos(mensaje.trim());
  if (!texto) return null;

  if (PATRONES.reprogramar.test(texto)) {
    return { intento: "REPROGRAMAR", confianza: 0.9, nota: "El paciente pide cambiar su cita." };
  }
  if (PATRONES.cancelar.test(texto)) {
    return { intento: "CANCELAR", confianza: 0.9, nota: "El paciente cancela su cita." };
  }
  if (PATRONES.confirmar.test(texto)) {
    return { intento: "CONFIRMAR", confianza: 0.9, nota: "El paciente confirma su asistencia." };
  }
  if (PATRONES.duda.test(texto)) {
    return { intento: "DUDA", confianza: 0.8, nota: "El paciente hace una pregunta administrativa." };
  }
  if (texto.includes("?")) {
    return { intento: "DUDA", confianza: 0.55, nota: "Mensaje con pregunta, sin palabra clave reconocida." };
  }
  if (PATRONES.saludo.test(texto) && texto.length < 30) {
    return { intento: "OTRO", confianza: 0.4, nota: "Saludo sin intención clara." };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Capa 3: LLM (opcional)
// ---------------------------------------------------------------------------

const respuestaSchema = z.object({
  intento: z.enum(["CONFIRMAR", "REPROGRAMAR", "CANCELAR", "DUDA", "OTRO"]),
  nuevaFecha: z.string().nullable().optional(),
  nuevaHora: z.string().nullable().optional(),
  nota: z.string().optional(),
  confianza: z.coerce.number().min(0).max(1).optional(),
});

function construirPrompt(): string {
  const hoy = hoyEnZona();
  const partes = partesEnZona(new Date());
  return [
    "Eres el asistente administrativo de un consultorio dental. Interpretas respuestas de pacientes por WhatsApp.",
    "",
    "Devuelve SOLO un objeto JSON con este esquema:",
    '{"intento":"CONFIRMAR|REPROGRAMAR|CANCELAR|DUDA|OTRO","nuevaFecha":"YYYY-MM-DD|null","nuevaHora":"HH:mm|null","nota":"texto breve","confianza":0.0}',
    "",
    `Contexto temporal: hoy es ${format(hoy, "yyyy-MM-dd")} (${DIAS_SEMANA[partes.diaSemana]}), zona ${config.TIMEZONE}.`,
    "Reglas:",
    "- Si el paciente confirma o dice que asistirá → CONFIRMAR.",
    "- Si pide mover la cita, aunque sea con rodeos → REPROGRAMAR y extrae la nueva fecha/hora si la menciona.",
    "- Si dice que no irá sin pedir otra fecha → CANCELAR.",
    "- Si pregunta precios, pagos, horarios o dirección → DUDA.",
    "- Si no se entiende → OTRO con confianza baja.",
    "- Las fechas relativas ('el jueves', 'mañana') se resuelven respecto a hoy.",
    "- Nunca inventes una fecha si el paciente no la menciona: usa null.",
  ].join("\n");
}

async function llamarLlm(mensaje: string): Promise<NluResult | null> {
  if (!config.llmHabilitado) return null;

  try {
    const respuesta = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: construirPrompt() },
          { role: "user", content: mensaje },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!respuesta.ok) {
      console.warn(`[nlu] LLM respondió ${respuesta.status}; se usan reglas.`);
      return null;
    }

    const json = (await respuesta.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const contenido = json.choices?.[0]?.message?.content;
    if (!contenido) return null;

    const datos = extraerJson(contenido);
    const validado = respuestaSchema.safeParse(datos);
    if (!validado.success) {
      console.warn("[nlu] Respuesta del LLM con formato inesperado; se usan reglas.");
      return null;
    }

    const valor = validado.data;
    return {
      intento: valor.intento,
      nuevaFecha: valor.nuevaFecha ?? null,
      nuevaHora: valor.nuevaHora ?? null,
      zona: config.TIMEZONE,
      mensajeUsuario: mensaje,
      nota: valor.nota ?? "Interpretado por el modelo.",
      confianza: valor.confianza ?? 0.7,
      fuente: "llm",
    };
  } catch (error) {
    console.warn("[nlu] Falló la llamada al LLM; se usan reglas:", (error as Error).message);
    return null;
  }
}

function extraerJson(texto: string): unknown {
  const limpio = texto.replace(/```json/gi, "").replace(/```/g, "").trim();
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio === -1 || fin === -1) return null;
  try {
    return JSON.parse(limpio.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

function completarConExtractores(
  resultado: NluResult,
  mensaje: string
): NluResult {
  // Las reglas y el LLM pueden no extraer fecha/hora; los extractores locales
  // son baratos y evitan una segunda llamada al modelo.
  const fechaExtraida = normalizarFecha(mensaje);
  const horaExtraida = normalizarHora(mensaje);

  return {
    ...resultado,
    nuevaFecha:
      resultado.nuevaFecha ??
      (fechaExtraida ? format(fechaExtraida, "yyyy-MM-dd") : null),
    nuevaHora: resultado.nuevaHora ?? horaExtraida,
  };
}

/**
 * Punto de entrada del NLU: decide intención y entidades de un mensaje.
 * Nunca lanza: ante cualquier fallo devuelve OTRO con confianza baja para que
 * el handler escale el caso a la asistente.
 */
export async function procesarMensajeNlu(opciones: ProcessOptions): Promise<NluResult> {
  const { mensaje, esBoton, botonId } = opciones;
  const base: NluResult = {
    intento: "OTRO",
    nuevaFecha: null,
    nuevaHora: null,
    zona: config.TIMEZONE,
    mensajeUsuario: mensaje,
    nota: "Sin clasificar.",
    confianza: 0,
    fuente: "fallback",
  };

  if (!mensaje?.trim()) return base;

  // 1. Botones
  if (esBoton && botonId) {
    const resultado = porBoton(mensaje, botonId);
    if (resultado) return resultado;
  }

  // 2. Reglas
  const regla = clasificarPorReglas(mensaje);
  if (regla && regla.confianza >= 0.9) {
    return completarConExtractores(
      {
        ...base,
        intento: regla.intento,
        nota: regla.nota,
        confianza: regla.confianza,
        fuente: "regla",
      },
      mensaje
    );
  }

  // 3. LLM
  const porModelo = await llamarLlm(mensaje);
  if (porModelo) {
    return completarConExtractores(porModelo, mensaje);
  }

  // 4. Regla débil (sin LLM disponible)
  if (regla) {
    return completarConExtractores(
      { ...base, intento: regla.intento, nota: regla.nota, confianza: regla.confianza, fuente: "regla" },
      mensaje
    );
  }

  return {
    ...base,
    nota: "No se pudo interpretar el mensaje; requiere revisión humana.",
    confianza: 0.2,
  };
}

/** Texto listo para mostrar en logs o alertas. */
export function resumirNlu(resultado: NluResult): string {
  const cuando =
    resultado.nuevaFecha || resultado.nuevaHora
      ? ` → ${resultado.nuevaFecha ?? "?"} ${resultado.nuevaHora ?? ""}`.trimEnd()
      : "";
  return `${resultado.intento}${cuando} (${resultado.fuente}, ${Math.round(resultado.confianza * 100)}%)`;
}

/** Ayuda de depuración: fecha legible en la zona del consultorio. */
export function fechaLegible(fecha: Date): string {
  return formatear(fecha, "fechaHora");
}
