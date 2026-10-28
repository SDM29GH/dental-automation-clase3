/**
 * Integración con Google Calendar.
 *
 * Google Calendar es la agenda que la Dra. Laura ya usa; aquí sólo la
 * sincronizamos hacia nuestra base para poder razonar sobre citas, y
 * escribimos de vuelta cuando un paciente confirma, mueve o cancela.
 *
 * Convención de título en el calendario:  "Nombre del paciente - motivo"
 * Ej.: "Ana Ruiz - endodoncia". Sin ese formato el evento se ignora al
 * sincronizar (mejor ignorar que inventar pacientes).
 */
import { google, type calendar_v3 } from "googleapis";
import type { Cita } from "@prisma/client";
import { config } from "../config/index.js";
import prisma from "../utils/prisma.js";
import { formatear } from "../utils/time.js";

export class GoogleCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

let clienteCache: calendar_v3.Calendar | null = null;

function cliente(): calendar_v3.Calendar {
  if (!config.googleHabilitado) {
    throw new GoogleCalendarError(
      "Google Calendar no está configurado: falta GOOGLE_REFRESH_TOKEN."
    );
  }
  if (!clienteCache) {
    const auth = new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: config.GOOGLE_REFRESH_TOKEN });
    clienteCache = google.calendar({ version: "v3", auth });
  }
  return clienteCache;
}

/** Solo para tests: descarta el cliente cacheado. */
export function reiniciarClienteGoogle(): void {
  clienteCache = null;
}

const TIPOS_CONOCIDOS = [
  "endodoncia",
  "ortodoncia",
  "protesis",
  "prótesis",
  "implante",
  "radiografia",
  "radiografía",
  "emergencia",
  "limpieza",
  "control",
  "consulta",
];

function detectarTipo(texto: string): string {
  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const encontrado = TIPOS_CONOCIDOS.find((tipo) =>
    normalizado.includes(
      tipo
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
    )
  );
  if (!encontrado) return "consulta";
  return encontrado
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function partirTitulo(titulo: string): { paciente: string; motivo: string } | null {
  const partes = titulo.split(/\s+[-–—]\s+/);
  if (partes.length < 2) return null;
  const paciente = partes[0].trim();
  const motivo = partes.slice(1).join(" - ").trim();
  if (!paciente || !motivo) return null;
  return { paciente, motivo };
}

function inicioDeEvento(evento: calendar_v3.Schema$Event): Date | null {
  const valor = evento.start?.dateTime ?? evento.start?.date;
  if (!valor) return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function finDeEvento(evento: calendar_v3.Schema$Event, inicio: Date, duracionMinutos = 60): Date {
  const valor = evento.end?.dateTime ?? evento.end?.date;
  if (valor) {
    const fecha = new Date(valor);
    if (!Number.isNaN(fecha.getTime())) return fecha;
  }
  return new Date(inicio.getTime() + duracionMinutos * 60_000);
}

export interface ResumenSincronizacion {
  total: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  cancelados: number;
}

/**
 * Trae los eventos de los calendarios configurados y los refleja en la base.
 * Idempotente: se puede correr cada hora sin duplicar nada.
 */
export async function sincronizarCalendario(opciones: {
  desde?: Date;
  hasta?: Date;
} = {}): Promise<ResumenSincronizacion> {
  const desde = opciones.desde ?? new Date();
  const hasta = opciones.hasta ?? new Date(desde.getTime() + 90 * 86_400_000);
  const resumen: ResumenSincronizacion = {
    total: 0,
    creados: 0,
    actualizados: 0,
    omitidos: 0,
    cancelados: 0,
  };

  const calendar = cliente();

  for (const calendarId of config.CALENDAR_IDS) {
    let pageToken: string | undefined;

    do {
      const { data } = await calendar.events.list({
        calendarId,
        timeMin: desde.toISOString(),
        timeMax: hasta.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });

      for (const evento of data.items ?? []) {
        resumen.total++;
        if (!evento.id) {
          resumen.omitidos++;
          continue;
        }

        const inicio = inicioDeEvento(evento);
        const titulo = evento.summary?.trim() ?? "";

        if (!inicio || !titulo) {
          resumen.omitidos++;
          continue;
        }

        // Evento cancelado: reflejarlo si ya lo conocíamos.
        if (evento.status === "cancelled") {
          const actualizado = await prisma.cita.updateMany({
            where: { calendarioEventId: evento.id },
            data: { estado: "CANCELADA_POR_CLINICA" },
          });
          if (actualizado.count > 0) resumen.cancelados++;
          continue;
        }

        const partes = partirTitulo(titulo);
        if (!partes) {
          console.warn(
            `[calendar] Evento ignorado (formato "Paciente - motivo" requerido): "${titulo}"`
          );
          resumen.omitidos++;
          continue;
        }

        const paciente = await resolverPaciente(partes.paciente);
        if (!paciente) {
          resumen.omitidos++;
          continue;
        }

        const tipo = detectarTipo(`${partes.motivo} ${evento.description ?? ""}`);
        const existente = await prisma.cita.findUnique({
          where: { calendarioEventId: evento.id },
          select: { id: true },
        });

        await prisma.cita.upsert({
          where: { calendarioEventId: evento.id },
          create: {
            calendarioEventId: evento.id,
            pacienteId: paciente.id,
            titulo: partes.motivo,
            descripcion: evento.description ?? null,
            fecha: inicio,
            tipo,
            estado: "AGENDADA",
            metadata: {
              calendarId,
              googleStatus: evento.status ?? null,
              creadoPor: "sincronizacion",
            },
          },
          update: {
            pacienteId: paciente.id,
            titulo: partes.motivo,
            descripcion: evento.description ?? null,
            fecha: inicio,
            tipo,
            metadata: {
              calendarId,
              googleStatus: evento.status ?? null,
              actualizadoPor: "sincronizacion",
            },
          },
        });

        if (existente) resumen.actualizados++;
        else resumen.creados++;
      }

      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return resumen;
}

/**
 * Busca al paciente por nombre exacto (sin distinguir mayúsculas) y, si no
 * existe, lo crea sin teléfono. Un paciente sin teléfono no recibe
 * recordatorios hasta que la asistente lo complete.
 */
async function resolverPaciente(nombre: string) {
  const existente = await prisma.paciente.findFirst({
    where: { nombre: { equals: nombre, mode: "insensitive" } },
  });
  if (existente) return existente;

  console.warn(`[calendar] Paciente nuevo detectado en el calendario: "${nombre}" (sin teléfono)`);
  return prisma.paciente.create({
    data: { nombre, telefono: null, consentWhatsapp: false, nota: "Creado desde Google Calendar" },
  });
}

function isoDeZona(fecha: Date): string {
  // Google acepta el instante en ISO con offset; enviamos UTC y la zona aparte.
  return fecha.toISOString();
}

export async function crearEvento(opciones: {
  paciente: { nombre: string };
  motivo: string;
  fecha: Date;
  duracionMinutos?: number;
  descripcion?: string;
}): Promise<string> {
  const { paciente, motivo, fecha, duracionMinutos = 60, descripcion } = opciones;
  const calendar = cliente();
  const fin = new Date(fecha.getTime() + duracionMinutos * 60_000);

  const { data } = await calendar.events.insert({
    calendarId: config.CALENDAR_IDS[0],
    requestBody: {
      summary: `${paciente.nombre} - ${motivo}`,
      description: descripcion,
      start: { dateTime: isoDeZona(fecha), timeZone: config.TIMEZONE },
      end: { dateTime: isoDeZona(fin), timeZone: config.TIMEZONE },
      status: "confirmed",
    },
  });

  if (!data.id) throw new GoogleCalendarError("Google Calendar no devolvió el id del evento creado");
  return data.id;
}

export async function moverEvento(opciones: {
  calendarioEventId: string;
  nuevaFecha: Date;
  duracionMinutos?: number;
}): Promise<void> {
  const { calendarioEventId, nuevaFecha, duracionMinutos = 60 } = opciones;
  const calendar = cliente();
  const fin = new Date(nuevaFecha.getTime() + duracionMinutos * 60_000);

  await calendar.events.patch({
    calendarId: config.CALENDAR_IDS[0],
    eventId: calendarioEventId,
    requestBody: {
      start: { dateTime: isoDeZona(nuevaFecha), timeZone: config.TIMEZONE },
      end: { dateTime: isoDeZona(fin), timeZone: config.TIMEZONE },
    },
  });
}

export async function cancelarEvento(calendarioEventId: string): Promise<void> {
  const calendar = cliente();
  await calendar.events.patch({
    calendarId: config.CALENDAR_IDS[0],
    eventId: calendarioEventId,
    requestBody: { status: "cancelled" },
  });
}

/** Descripción legible del instante, para logs y alertas. */
export function describirCita(cita: Pick<Cita, "titulo" | "fecha">): string {
  return `${formatear(cita.fecha, "fechaHora")} · ${cita.titulo}`;
}
