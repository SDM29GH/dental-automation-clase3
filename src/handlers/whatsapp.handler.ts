/**
 * Webhook de WhatsApp: de un mensaje del paciente a una acción en la agenda.
 *
 * Diseño:
 *  - `parsearMensajeEntrante` y `resolverNuevaFecha` son funciones puras (test sin mocks).
 *  - `procesarEntrante` orquesta repositorio, NLU, WhatsApp, Calendar y alertas
 *    a través de una interfaz, así que se puede probar con dobles en memoria.
 *  - El handler HTTP sólo valida el secreto, delega y responde rápido: Evolution
 *    reintenta si tardamos, y un reintento no puede duplicar una reprogramación.
 */
import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { CitaConPaciente, CitasRepository } from "../repositories/citas.repository.js";
import { citasRepository } from "../repositories/citas.repository.js";
import { procesarMensajeNlu, type Intento, type NluResult } from "../services/nlu.js";
import { whatsappService } from "../services/whatsapp.js";
import {
  moverEvento,
  cancelarEvento,
  crearEvento,
} from "../services/google-calendar.js";
import { AlertService } from "../services/alertas.js";
import { programarRecordatorios } from "../scheduler/recordatorios.service.js";
import { config } from "../config/index.js";
import { partesEnZona, aUtcDesdeZona, formatear, sumarDias } from "../utils/time.js";
import {
  BOTONES_CANCELACION,
  BOTONES_CONFIRMACION,
  citaCancelada,
  citaReprogramada,
  confirmacionRecibida,
  noEntendido,
  recordatorio24Horas,
  respuestaFrecuente,
  sinCitaAsociada,
} from "../services/mensajes.js";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface MensajeEntrante {
  telefono: string;
  texto: string;
  proveedorId: string | null;
  esBoton: boolean;
  botonId: string | null;
  desdeNosotros: boolean;
  esGrupo: boolean;
  timestamp: Date;
}

export type Accion =
  | "CONFIRMADA"
  | "REPROGRAMADA"
  | "CANCELADA"
  | "RESPONDIDA"
  | "ESCALADA"
  | "DUPLICADA"
  | "IGNORADA";

export interface ResultadoProcesamiento {
  accion: Accion;
  intento: Intento | null;
  citaId: string | null;
  /** Mensaje que se envió al paciente (útil en tests y logs). */
  respuesta: string | null;
}

export interface DependenciasHandler {
  repo: Pick<
    CitasRepository,
    | "registrarMensaje"
    | "buscarCitasActivasPorTelefono"
    | "actualizarEstadoCita"
    | "reprogramarCita"
    | "cancelarCita"
    | "existeMensajeProveedor"
    | "vincularEventoCalendario"
  >;
  nlu: { procesarMensajeNlu: typeof procesarMensajeNlu };
  whatsapp: {
    enviarTexto: (datos: { telefono: string; texto: string }) => Promise<{ proveedorId: string }>;
    enviarBotones: (datos: {
      telefono: string;
      titulo: string;
      descripcion: string;
      botones: Array<{ id: string; texto: string }>;
    }) => Promise<{ proveedorId: string }>;
  };
  calendario: {
    moverEvento: typeof moverEvento;
    cancelarEvento: typeof cancelarEvento;
    crearEvento: typeof crearEvento;
  };
  alertas: {
    respuestaPaciente: typeof AlertService.respuestaPaciente;
    respuestaNoClara: typeof AlertService.respuestaNoClara;
  };
  programarRecordatorios: typeof programarRecordatorios;
  logger: Pick<Console, "log" | "warn" | "error">;
}

// ---------------------------------------------------------------------------
// Parseo del payload de Evolution API
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const objeto = (valor: unknown): Json =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Json) : {};

const texto = (valor: unknown): string => (typeof valor === "string" ? valor : "");

/**
 * Extrae lo relevante del webhook. Soporta el sobre de Evolution API
 * (`{ cuerpo: { data } }`) y el payload plano (`{ key, message, ... }`).
 */
export function parsearMensajeEntrante(payload: unknown): MensajeEntrante | null {
  const raiz = objeto(payload);
  const data = objeto(objeto(raiz.cuerpo).data ?? raiz.data ?? raiz);
  const key = objeto(data.key);

  const remoto = texto(key.remoteJid ?? key.phone);
  if (!remoto) return null;

  const mensaje = objeto(data.message);
  const boton = objeto(mensaje.buttonsResponseMessage);
  const lista = objeto(objeto(mensaje.listResponseMessage).singleSelectReply);

  const esBoton = Boolean(boton.selectedButtonId ?? lista.selectedRowId);
  const botonId = texto(boton.selectedButtonId ?? lista.selectedRowId) || null;

  const textoMensaje =
    texto(mensaje.conversation) ||
    texto(objeto(mensaje.extendedTextMessage).text) ||
    texto(boton.selectedButtonText) ||
    texto(lista.title);

  if (!textoMensaje.trim()) return null;

  const marcaTiempo = Number(data.messageTimestamp ?? data.timestamp ?? 0);
  const timestamp =
    Number.isFinite(marcaTiempo) && marcaTiempo > 0
      ? new Date(marcaTiempo * 1000)
      : new Date();

  return {
    telefono: remoto.replace(/\D/g, "").slice(-10),
    texto: textoMensaje.trim(),
    proveedorId: texto(key.id) || null,
    esBoton,
    botonId,
    desdeNosotros: Boolean(data.fromMe),
    esGrupo: remoto.endsWith("@g.us"),
    timestamp,
  };
}

// ---------------------------------------------------------------------------
// Cálculo de la nueva cita
// ---------------------------------------------------------------------------

/** Máximo de días hacia adelante que aceptamos de una sola frase. */
const HORIZONTE_DIAS = 120;

/**
 * Traduce "jueves" + "a las 10" a un instante concreto en la zona del
 * consultorio. Si el paciente no propone fecha, se ofrecen 3 días después a la
 * misma hora. Nunca devuelve una fecha pasada ni un domingo (cerrado).
 */
export function resolverNuevaFecha(cita: CitaConPaciente, nlu: NluResult): Date {
  const partes = partesEnZona(cita.fecha);
  const horaTexto =
    nlu.nuevaHora ?? `${String(partes.hora).padStart(2, "0")}:${String(partes.minuto).padStart(2, "0")}`;
  const [hora, minuto] = horaTexto.split(":").map(Number);

  let anio: number;
  let mes: number;
  let dia: number;

  if (nlu.nuevaFecha && /^\d{4}-\d{2}-\d{2}$/.test(nlu.nuevaFecha)) {
    const [a, m, d] = nlu.nuevaFecha.split("-").map(Number);
    ({ anio, mes, dia } = { anio: a, mes: m, dia: d });
  } else {
    const base = new Date(partes.anio, partes.mes - 1, partes.dia, 12);
    const propuesta = sumarDias(base, 3);
    anio = propuesta.getFullYear();
    mes = propuesta.getMonth() + 1;
    dia = propuesta.getDate();
  }

  const candidata = new Date(anio, mes - 1, dia, 12);
  const limite = new Date(partes.anio, partes.mes - 1, partes.dia + HORIZONTE_DIAS, 12);

  if (candidata > limite) {
    // Fecha absurda ("el 2030"): caer al fallback de 3 días.
    const fallback = sumarDias(new Date(partes.anio, partes.mes - 1, partes.dia, 12), 3);
    anio = fallback.getFullYear();
    mes = fallback.getMonth() + 1;
    dia = fallback.getDate();
  }

  let resultado = aUtcDesdeZona(anio, mes, dia, hora, minuto, config.TIMEZONE);

  if (resultado.getTime() <= Date.now()) {
    const fallback = sumarDias(new Date(partes.anio, partes.mes - 1, partes.dia, 12), 3);
    resultado = aUtcDesdeZona(
      fallback.getFullYear(),
      fallback.getMonth() + 1,
      fallback.getDate(),
      hora,
      minuto,
      config.TIMEZONE
    );
  }

  // Domingo = consultorio cerrado: mover al lunes.
  if (partesEnZona(resultado).diaSemana === 0) {
    resultado = new Date(resultado.getTime() + 86_400_000);
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

export async function procesarEntrante(
  entrante: MensajeEntrante,
  deps: DependenciasHandler
): Promise<ResultadoProcesamiento> {
  const { repo, logger } = deps;

  if (entrante.desdeNosotros) {
    return { accion: "IGNORADA", intento: null, citaId: null, respuesta: null };
  }
  if (entrante.esGrupo) {
    logger.log("[handler] Mensaje de grupo ignorado");
    return { accion: "IGNORADA", intento: null, citaId: null, respuesta: null };
  }

  // Idempotencia: Evolution reintenta el mismo webhook si no respondemos.
  if (entrante.proveedorId && (await repo.existeMensajeProveedor(entrante.proveedorId))) {
    logger.log(`[handler] Mensaje duplicado ${entrante.proveedorId}, se ignora`);
    return { accion: "DUPLICADA", intento: null, citaId: null, respuesta: null };
  }

  await repo.registrarMensaje({
    direccion: "IN",
    telefono: entrante.telefono,
    contenido: entrante.texto,
    tipo: entrante.esBoton ? "boton" : "texto",
    proveedorId: entrante.proveedorId,
    estado: "LEIDO",
  });

  const citas = await repo.buscarCitasActivasPorTelefono(entrante.telefono);
  const cita = citas[0] ?? null;

  const nlu = await deps.nlu.procesarMensajeNlu({
    mensaje: entrante.texto,
    esBoton: entrante.esBoton,
    botonId: entrante.botonId ?? undefined,
    telefono: entrante.telefono,
    citaId: cita?.id,
  });

  logger.log(
    `[handler] ${entrante.telefono} → ${nlu.intento} (${nlu.fuente}, ${Math.round(nlu.confianza * 100)}%) "${entrante.texto}"`
  );

  const responder = async (contenido: string, tipo: string): Promise<void> => {
    try {
      const envio = await deps.whatsapp.enviarTexto({ telefono: entrante.telefono, texto: contenido });
      await repo.registrarMensaje({
        direccion: "OUT",
        telefono: entrante.telefono,
        contenido,
        tipo,
        citaId: cita?.id ?? null,
        proveedorId: envio.proveedorId,
      });
    } catch (error) {
      logger.error("[handler] No se pudo responder por WhatsApp:", (error as Error).message);
      await repo.registrarMensaje({
        direccion: "OUT",
        telefono: entrante.telefono,
        contenido,
        tipo,
        citaId: cita?.id ?? null,
        estado: "FALLIDO",
      });
    }
  };

  const base = { intento: nlu.intento, citaId: cita?.id ?? null };

  switch (nlu.intento) {
    case "CONFIRMAR": {
      if (!cita) {
        const respuesta = sinCitaAsociada();
        await responder(respuesta, "aclaracion");
        await deps.alertas.respuestaNoClara(entrante.telefono, entrante.texto);
        return { ...base, accion: "ESCALADA", respuesta };
      }

      await repo.actualizarEstadoCita(cita.id, "CONFIRMADA");
      const respuesta = confirmacionRecibida(cita.paciente.nombre, cita.fecha);
      await responder(respuesta, "confirmacion");
      return { ...base, accion: "CONFIRMADA", respuesta };
    }

    case "REPROGRAMAR": {
      if (!cita) {
        const respuesta = sinCitaAsociada();
        await responder(respuesta, "aclaracion");
        await deps.alertas.respuestaNoClara(entrante.telefono, entrante.texto);
        return { ...base, accion: "ESCALADA", respuesta };
      }

      const nuevaFecha = resolverNuevaFecha(cita, nlu);

      // Primero la agenda de Google (fuente de verdad de la clínica) y luego la DB.
      try {
        if (cita.calendarioEventId) {
          await deps.calendario.moverEvento({
            calendarioEventId: cita.calendarioEventId,
            nuevaFecha,
          });
        } else if (config.googleHabilitado) {
          const eventId = await deps.calendario.crearEvento({
            paciente: { nombre: cita.paciente.nombre },
            motivo: cita.titulo,
            fecha: nuevaFecha,
          });
          await repo.vincularEventoCalendario(cita.id, eventId);
        }
      } catch (error) {
        logger.error("[handler] No se pudo mover el evento de Calendar:", (error as Error).message);
      }

      const actualizada = await repo.reprogramarCita({
        citaId: cita.id,
        nuevaFecha,
        nota: nlu.nota,
      });

      await deps.programarRecordatorios(actualizada.id, nuevaFecha);

      const respuesta = citaReprogramada(cita.paciente.nombre, nuevaFecha);
      await responder(respuesta, "reprogramacion");
      return { ...base, accion: "REPROGRAMADA", respuesta };
    }

    case "CANCELAR": {
      if (!cita) {
        const respuesta = sinCitaAsociada();
        await responder(respuesta, "aclaracion");
        await deps.alertas.respuestaNoClara(entrante.telefono, entrante.texto);
        return { ...base, accion: "ESCALADA", respuesta };
      }

      try {
        if (cita.calendarioEventId) {
          await deps.calendario.cancelarEvento(cita.calendarioEventId);
        }
      } catch (error) {
        logger.error("[handler] No se pudo cancelar el evento de Calendar:", (error as Error).message);
      }

      await repo.cancelarCita(cita.id, nlu.nota);
      const respuesta = citaCancelada(cita.paciente.nombre);
      await responder(respuesta, "cancelacion");
      return { ...base, accion: "CANCELADA", respuesta };
    }

    case "DUDA": {
      const frecuente = respuestaFrecuente(entrante.texto);
      const respuesta =
        frecuente ??
        "Gracias por escribirnos. La asistente revisará tu pregunta y te responde en breve. 🙏";
      await responder(respuesta, "duda");
      // Toda duda acaba en manos de una persona: no fingimos resolver todo.
      await deps.alertas.respuestaPaciente(nlu, cita);
      return { ...base, accion: "RESPONDIDA", respuesta };
    }

    default: {
      const respuesta = noEntendido();
      await responder(respuesta, "aclaracion");
      await deps.alertas.respuestaNoClara(entrante.telefono, entrante.texto);
      return { ...base, accion: "ESCALADA", respuesta };
    }
  }
}

// ---------------------------------------------------------------------------
// Handler HTTP
// ---------------------------------------------------------------------------

function secretoValido(recibido: string | undefined): boolean {
  if (!config.EVOLUTION_WEBHOOK_SECRET) return true;
  if (!recibido) return false;
  const esperado = Buffer.from(config.EVOLUTION_WEBHOOK_SECRET);
  const dado = Buffer.from(recibido);
  if (esperado.length !== dado.length) return false;
  return timingSafeEqual(esperado, dado);
}

export function crearHandlerWhatsapp(deps: DependenciasHandler) {
  async function manejarWebhook(req: Request, res: Response): Promise<Response> {
    if (!secretoValido(req.header("x-webhook-secret"))) {
      return res.status(401).json({ ok: false, error: "Secreto de webhook inválido" });
    }

    const entrante = parsearMensajeEntrante(req.body);
    if (!entrante) {
      // 200 para que Evolution no reintente un mensaje que no sabemos leer.
      return res.status(200).json({ ok: true, ignorado: "sin texto procesable" });
    }

    try {
      const resultado = await procesarEntrante(entrante, deps);
      return res.status(200).json({ ok: true, ...resultado });
    } catch (error) {
      deps.logger.error("[handler] Error procesando webhook:", (error as Error).message);
      // 500 hace que Evolution reintente; la idempotencia evita duplicados.
      return res.status(500).json({ ok: false, error: "Error interno" });
    }
  }

  return { manejarWebhook };
}

// ---------------------------------------------------------------------------
// Cableado real
// ---------------------------------------------------------------------------

const depsPorDefecto: DependenciasHandler = {
  repo: citasRepository,
  nlu: { procesarMensajeNlu },
  whatsapp: whatsappService,
  calendario: { moverEvento, cancelarEvento, crearEvento },
  alertas: {
    respuestaPaciente: AlertService.respuestaPaciente.bind(AlertService),
    respuestaNoClara: AlertService.respuestaNoClara.bind(AlertService),
  },
  programarRecordatorios,
  logger: console,
};

export const { manejarWebhook: manejarWebhookWhatsapp } = crearHandlerWhatsapp(depsPorDefecto);

/** Utilidad para depuración: texto del recordatorio de 24 h con botones. */
export function textoRecordatorio24h(nombre: string, fecha: Date): string {
  return recordatorio24Horas(nombre, fecha);
}

export { BOTONES_CONFIRMACION, BOTONES_CANCELACION, formatear };
