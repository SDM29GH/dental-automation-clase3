/**
 * Motor de seguimiento de tratamientos multisesión.
 *
 * El abandono no ocurre cuando el paciente decide no volver: ocurre cuando
 * deja de dolerle y nadie le escribe. Este job revisa cada tratamiento
 * completado sin continuación, avisa al paciente *antes* de que venza el
 * intervalo y enciende una alerta cuando ya hay retraso real.
 */
import type { Cita, Paciente, Sesion, Tratamiento } from "@prisma/client";
import prisma from "../utils/prisma.js";
import { whatsappService, type WhatsappService } from "../services/whatsapp.js";
import { AlertService } from "../services/alertas.js";
import { obtenerProtocolo } from "../services/protocolos.js";
import { mensajeSeguimiento } from "../services/mensajes.js";
import { diasDeCalendario, sumarDias } from "../utils/time.js";

type CitaConRelaciones = Cita & {
  paciente: Paciente;
  tratamiento: Tratamiento | null;
  sesiones: Sesion[];
};

export interface ResumenSeguimiento {
  citasRevisadas: number;
  mensajesEnviados: number;
  omitidos: number;
  alertas: number;
}

/** Días hacia atrás que miramos para no procesar tratamientos antiguos. */
const VENTANA_DIAS = 120;

/** Mínimo de días entre dos mensajes de seguimiento al mismo paciente. */
const DIAS_MINIMOS_ENTRE_MENSAJES = 5;

export async function ejecutarSeguimientoDiario(
  ahora: Date = new Date(),
  whatsapp: Pick<WhatsappService, "enviarTexto"> = whatsappService
): Promise<ResumenSeguimiento> {
  const resumen: ResumenSeguimiento = {
    citasRevisadas: 0,
    mensajesEnviados: 0,
    omitidos: 0,
    alertas: 0,
  };

  const citas = (await prisma.cita.findMany({
    where: {
      estado: "COMPLETADA",
      fecha: { gte: sumarDias(ahora, -VENTANA_DIAS), lte: ahora },
      tratamientoId: { not: null },
      paciente: { telefono: { not: null }, consentWhatsapp: true },
    },
    include: {
      paciente: true,
      tratamiento: true,
      sesiones: { orderBy: { fecha: "desc" }, take: 1 },
    },
  })) as CitaConRelaciones[];

  for (const cita of citas) {
    resumen.citasRevisadas++;

    const tipo = cita.tratamiento?.tipo ?? cita.tipo;
    const protocolo = obtenerProtocolo(tipo);
    const ultimaSesion = cita.sesiones[0]?.fecha ?? cita.fecha;
    const dias = diasDeCalendario(ultimaSesion, ahora);
    const retraso = dias - protocolo.diasEntreSesiones;

    // Todavía falta para el intervalo: no molestamos.
    if (dias < protocolo.diasEntreSesiones - protocolo.avisoAnticipado) continue;

    // Ya tiene una cita de continuación agendada: nada que perseguir.
    if (await tieneSiguienteCita(cita, ahora)) {
      resumen.omitidos++;
      continue;
    }

    // Anti-spam: no más de un seguimiento cada N días por paciente.
    if (await yaSeEscribioRecientemente(cita.paciente.telefono!, ahora)) {
      resumen.omitidos++;
      continue;
    }

    const telefono = cita.paciente.telefono!;
    const texto = mensajeSeguimiento(tipo, cita.paciente.nombre, dias);

    try {
      await whatsapp.enviarTexto({ telefono, texto });
      await prisma.mensaje.create({
        data: {
          direccion: "OUT",
          telefono,
          contenido: texto,
          tipo: `seguimiento:${protocolo.tipo}`,
          citaId: cita.id,
        },
      });
      resumen.mensajesEnviados++;
    } catch (error) {
      console.error(
        `[seguimiento] No se pudo escribir a ${cita.paciente.nombre}: ${(error as Error).message}`
      );
      continue;
    }

    // Alertas: sólo en umbrales concretos, para que la asistente no reciba
    // el mismo aviso todos los días.
    if (retraso >= protocolo.umbralAlerta && esDiaDeAviso(dias, protocolo.umbralAlerta)) {
      await AlertService.seguimiento(
        { nombre: cita.paciente.nombre, telefono },
        protocolo.etiqueta,
        dias,
        dias >= protocolo.diasEntreSesiones + protocolo.umbralCritico
      );
      resumen.alertas++;
    }
  }

  return resumen;
}

async function tieneSiguienteCita(cita: CitaConRelaciones, ahora: Date): Promise<boolean> {
  const siguiente = await prisma.cita.findFirst({
    where: {
      pacienteId: cita.pacienteId,
      fecha: { gt: ahora },
      estado: { in: ["AGENDADA", "CONFIRMADA", "REAGENDADA"] },
      tipo: cita.tipo,
    },
    select: { id: true },
  });
  return siguiente !== null;
}

async function yaSeEscribioRecientemente(telefono: string, ahora: Date): Promise<boolean> {
  const desde = sumarDias(ahora, -DIAS_MINIMOS_ENTRE_MENSAJES);
  const ultimo = await prisma.mensaje.findFirst({
    where: {
      telefono,
      direccion: "OUT",
      tipo: { startsWith: "seguimiento" },
      createdAt: { gte: desde },
    },
    select: { id: true },
  });
  return ultimo !== null;
}

/** Avisa en el día del umbral y luego cada 7 días, no a diario. */
function esDiaDeAviso(dias: number, umbral: number): boolean {
  if (dias < umbral) return false;
  if (dias === umbral) return true;
  return dias % 7 === 0;
}

/** Marca como completada una cita pasada (la asistente lo hace desde el panel). */
export async function completarCita(citaId: string, notas?: string): Promise<void> {
  const cita = await prisma.cita.findUnique({ where: { id: citaId } });
  if (!cita) throw new Error(`Cita ${citaId} no encontrada`);

  // Idempotente: un doble clic no debe duplicar la sesión (eso inflaría el
  // conteo de sesiones y rompería el cálculo de días del seguimiento).
  const existente = await prisma.sesion.findFirst({ where: { citaId }, select: { id: true } });
  if (existente) return;

  await prisma.$transaction([
    prisma.cita.update({ where: { id: citaId }, data: { estado: "COMPLETADA" } }),
    prisma.sesion.create({
      data: {
        citaId,
        pacienteId: cita.pacienteId,
        fecha: cita.fecha,
        completada: true,
        notas: notas ?? null,
      },
    }),
  ]);
}

/** Marca una cita pasada como no-show (el paciente no llegó). */
export async function marcarNoShow(citaId: string): Promise<void> {
  await prisma.cita.update({ where: { id: citaId }, data: { estado: "NO_SHOW" } });
}
