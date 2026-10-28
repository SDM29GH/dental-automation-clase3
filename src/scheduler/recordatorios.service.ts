/**
 * Recordatorios escalonados, implementados como cola persistente en Postgres.
 *
 * ¿Por qué no Redis + BullMQ? Un consultorio manda decenas de mensajes al día.
 * Una tabla con `programadoPara` y un cron cada 5 minutos hace lo mismo, no
 * pierde trabajos si el proceso se reinicia, permite reprogramar con un UPDATE
 * y elimina un contenedor que mantener. Menos piezas, menos fallos a las 3 a.m.
 */
import type { CitaConPaciente } from "../repositories/citas.repository.js";
import prisma from "../utils/prisma.js";
import { whatsappService, type WhatsappService } from "../services/whatsapp.js";
import { AlertService } from "../services/alertas.js";
import {
  BOTONES_CONFIRMACION,
  recordatorio2Horas,
  recordatorio24Horas,
  recordatorioHoy,
  recodatorioTresDias,
} from "../services/mensajes.js";
import { aUtcDesdeZona, formatear, partesEnZona, sumarDias } from "../utils/time.js";
import { config } from "../config/index.js";

export const DISPARADORES = ["D_MINUS_3D", "D_MINUS_24H", "D_MINUS_2H", "D_MINUS_0H"] as const;
export type Disparador = (typeof DISPARADORES)[number];

const HORAS_ANTES: Record<Disparador, number> = {
  D_MINUS_3D: 72,
  D_MINUS_24H: 24,
  D_MINUS_2H: 2,
  D_MINUS_0H: 0,
};

/** Los dos primeros piden confirmación con botones; los últimos sólo avisan. */
const PIDE_CONFIRMACION: Record<Disparador, boolean> = {
  D_MINUS_3D: true,
  D_MINUS_24H: true,
  D_MINUS_2H: false,
  D_MINUS_0H: false,
};

export function calcularMomento(fechaCita: Date, disparador: Disparador): Date {
  return new Date(fechaCita.getTime() - HORAS_ANTES[disparador] * 3_600_000);
}

/** Ventana en la que sí se escribe a un paciente (hora local del consultorio). */
export const HORA_INICIO_ENVIOS = 8;
export const HORA_FIN_ENVIOS = 21;

/**
 * Si `ahora` cae fuera de la ventana de envío, devuelve el siguiente instante
 * permitido (08:00 local). Escribir a las 3 de la mañana es la forma más rápida
 * de que un paciente bloquee el número del consultorio.
 */
export function proximoHorarioPermitido(
  ahora: Date,
  zona: string = config.TIMEZONE
): Date {
  const partes = partesEnZona(ahora, zona);
  if (partes.hora >= HORA_INICIO_ENVIOS && partes.hora < HORA_FIN_ENVIOS) {
    return ahora;
  }

  const hoy = new Date(partes.anio, partes.mes - 1, partes.dia, 12);
  const destino = partes.hora < HORA_INICIO_ENVIOS ? hoy : sumarDias(hoy, 1);

  return aUtcDesdeZona(
    destino.getFullYear(),
    destino.getMonth() + 1,
    destino.getDate(),
    HORA_INICIO_ENVIOS,
    0,
    zona
  );
}

export function construirTexto(
  disparador: Disparador,
  nombre: string,
  fecha: Date
): string {
  switch (disparador) {
    case "D_MINUS_3D":
      return recodatorioTresDias(nombre, fecha);
    case "D_MINUS_24H":
      return recordatorio24Horas(nombre, fecha);
    case "D_MINUS_2H":
      return recordatorio2Horas(nombre, fecha);
    case "D_MINUS_0H":
      return recordatorioHoy(nombre, fecha);
  }
}

/**
 * Crea (o recalcula) los recordatorios de una cita.
 * Se llama al sincronizar y cada vez que una cita se mueve.
 */
export async function programarRecordatorios(
  citaId: string,
  fechaCita: Date,
  ahora: Date = new Date()
): Promise<number> {
  let programados = 0;

  for (const disparador of DISPARADORES) {
    const momento = calcularMomento(fechaCita, disparador);
    // Un recordatorio cuyo momento ya pasó no tiene sentido: se omite.
    if (momento.getTime() <= ahora.getTime()) continue;

    await prisma.recordatorioEnvio.upsert({
      where: { citaId_disparador: { citaId, disparador } },
      create: {
        citaId,
        disparador,
        canal: "WHATSAPP",
        estado: "PENDIENTE",
        programadoPara: momento,
      },
      update: {
        programadoPara: momento,
        estado: "PENDIENTE",
        enviadoEn: null,
        intentos: 0,
      },
    });
    programados++;
  }

  return programados;
}

export interface ResumenRecordatorios {
  revisados: number;
  enviados: number;
  omitidos: number;
  fallidos: number;
  /** Vencidos pero diferidos a la ventana de envío. */
  diferidos: number;
}

/**
 * Procesa los recordatorios vencidos. Idempotente: si el proceso muere después
 * de enviar y antes de marcar, el siguiente ciclo reenvía como mucho una vez;
 * por eso se marca ENVIADO inmediatamente después del envío.
 */
export async function procesarRecordatoriosPendientes(
  ahora: Date = new Date(),
  whatsapp: Pick<WhatsappService, "enviarTexto" | "enviarBotones"> = whatsappService
): Promise<ResumenRecordatorios> {
  const resumen: ResumenRecordatorios = {
    revisados: 0,
    enviados: 0,
    omitidos: 0,
    fallidos: 0,
    diferidos: 0,
  };

  // Fuera de la ventana de envío no se escribe a nadie: se pospone a las 08:00.
  const ventana = proximoHorarioPermitido(ahora);
  if (ventana.getTime() > ahora.getTime()) {
    const diferidos = await prisma.recordatorioEnvio.updateMany({
      where: { estado: "PENDIENTE", programadoPara: { lte: ahora } },
      data: { programadoPara: ventana },
    });
    resumen.diferidos = diferidos.count;
    if (diferidos.count > 0) {
      console.log(
        `[recordatorios] ${diferidos.count} mensaje(s) diferido(s) a ${formatear(ventana, "fechaHora")} (fuera de horario)`
      );
    }
    return resumen;
  }

  const pendientes = await prisma.recordatorioEnvio.findMany({
    where: { estado: "PENDIENTE", programadoPara: { lte: ahora } },
    include: { cita: { include: { paciente: true } } },
    orderBy: { programadoPara: "asc" },
    take: 100,
  });

  for (const recordatorio of pendientes) {
    resumen.revisados++;
    const cita = recordatorio.cita as CitaConPaciente;
    const disparador = recordatorio.disparador as Disparador;

    const motivoOmision = motivoParaOmitir(cita, disparador);
    if (motivoOmision) {
      await prisma.recordatorioEnvio.update({
        where: { id: recordatorio.id },
        data: { estado: "OMITIDO", contenido: motivoOmision, enviadoEn: ahora },
      });
      resumen.omitidos++;

      // Avisar una sola vez (en el recordatorio de 24 h) si falta consentimiento.
      if (motivoOmision === SIN_CONSENTIMIENTO && disparador === "D_MINUS_24H") {
        await AlertService.enviar({
          titulo: "Paciente sin consentimiento de WhatsApp",
          cuerpo:
            `${cita.paciente.nombre} tiene cita el ${formatear(cita.fecha, "fechaHora")} ` +
            `pero no ha autorizado mensajes de WhatsApp. No se envió el recordatorio.\n` +
            `Teléfono: ${cita.paciente.telefono ?? "sin registrar"}\n` +
            `Pide su autorización y actívala en la ficha del paciente.`,
          prioridad: "alta",
        });
      }
      continue;
    }

    const telefono = cita.paciente.telefono;
    if (!telefono) {
      await prisma.recordatorioEnvio.update({
        where: { id: recordatorio.id },
        data: { estado: "FALLIDO", contenido: "Paciente sin teléfono", intentos: { increment: 1 } },
      });
      resumen.fallidos++;
      continue;
    }

    const texto = construirTexto(disparador, cita.paciente.nombre, cita.fecha);

    try {
      if (PIDE_CONFIRMACION[disparador]) {
        try {
          await whatsapp.enviarBotones({
            telefono,
            titulo: disparador === "D_MINUS_24H" ? "Tu cita es mañana" : "Confirma tu cita",
            descripcion: texto,
            botones: BOTONES_CONFIRMACION,
          });
        } catch (error) {
          // Si los botones fallan (plantilla no aprobada, versión vieja), texto plano.
          console.warn(
            `[recordatorios] Botones fallaron para ${cita.id}, se envía texto: ${(error as Error).message}`
          );
          await whatsapp.enviarTexto({ telefono, texto });
        }
      } else {
        await whatsapp.enviarTexto({ telefono, texto });
      }

      await prisma.recordatorioEnvio.update({
        where: { id: recordatorio.id },
        data: { estado: "ENVIADO", enviadoEn: ahora, contenido: texto, enviadoA: telefono },
      });
      await prisma.mensaje.create({
        data: {
          direccion: "OUT",
          telefono,
          contenido: texto,
          tipo: `recordatorio:${disparador}`,
          citaId: cita.id,
        },
      });
      resumen.enviados++;
    } catch (error) {
      const intentos = recordatorio.intentos + 1;
      await prisma.recordatorioEnvio.update({
        where: { id: recordatorio.id },
        data: {
          estado: intentos >= 3 ? "FALLIDO" : "PENDIENTE",
          intentos,
          contenido: (error as Error).message,
        },
      });
      resumen.fallidos++;
    }
  }

  return resumen;
}

export const SIN_CONSENTIMIENTO = "Sin consentimiento para WhatsApp";

function motivoParaOmitir(cita: CitaConPaciente, disparador: Disparador): string | null {
  if (["CANCELADA_POR_PACIENTE", "CANCELADA_POR_CLINICA", "COMPLETADA", "NO_SHOW"].includes(cita.estado)) {
    return `Cita en estado ${cita.estado}`;
  }
  // Escribir a un paciente que no autorizó mensajes es un problema legal, no técnico.
  if (!cita.paciente.consentWhatsapp) {
    return SIN_CONSENTIMIENTO;
  }
  // Un recordatorio que llega después de la cita sólo confunde.
  if (cita.fecha.getTime() < Date.now() - 3_600_000) {
    return "La cita ya pasó";
  }
  // No perseguir a quien ya confirmó.
  if (cita.estado === "CONFIRMADA" && PIDE_CONFIRMACION[disparador]) {
    return "El paciente ya confirmó";
  }
  // Recordatorio de 3 días para una cita que ya es mañana: llega tarde.
  if (disparador === "D_MINUS_3D" && cita.fecha.getTime() - Date.now() < 48 * 3_600_000) {
    return "Ventana del recordatorio vencida";
  }
  return null;
}

/** Recalcula los recordatorios de todas las citas futuras (reconciliación nocturna). */
export async function reconciliarRecordatorios(ahora: Date = new Date()): Promise<number> {
  const citas = await prisma.cita.findMany({
    where: {
      fecha: { gt: new Date(ahora.getTime() + 60 * 60_000) },
      estado: { in: ["AGENDADA", "CONFIRMADA", "REAGENDADA"] },
      paciente: { telefono: { not: null } },
    },
    select: { id: true, fecha: true },
  });

  let total = 0;
  for (const cita of citas) {
    total += await programarRecordatorios(cita.id, cita.fecha, ahora);
  }
  return total;
}

/** Citas de hoy con recordatorio de 24 h enviado y sin confirmar → avisar a la asistente. */
export async function alertarCitasSinConfirmar(ahora: Date = new Date()): Promise<number> {
  const manana = new Date(ahora.getTime() + 24 * 3_600_000);
  const citas = await prisma.cita.findMany({
    where: {
      fecha: { gte: ahora, lte: manana },
      estado: "AGENDADA",
    },
    include: { paciente: true },
  });

  let avisos = 0;
  for (const cita of citas) {
    const envio = await prisma.recordatorioEnvio.findFirst({
      where: { citaId: cita.id, disparador: "D_MINUS_24H", estado: "ENVIADO" },
    });
    if (!envio) continue;

    await AlertService.citaSinConfirmar(cita);
    avisos++;
  }

  return avisos;
}

/** Resumen de la agenda del día para la asistente. */
export async function resumenDelDia(ahora: Date = new Date()): Promise<void> {
  const inicio = new Date(ahora);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(inicio.getTime() + 86_400_000);

  const citas = await prisma.cita.findMany({
    where: { fecha: { gte: inicio, lt: fin }, estado: { notIn: ["CANCELADA_POR_PACIENTE", "CANCELADA_POR_CLINICA"] } },
    include: { paciente: true },
    orderBy: { fecha: "asc" },
  });

  await AlertService.resumenDelDia(citas);
  console.log(`[agenda] Resumen del ${formatear(inicio, "fecha")}: ${citas.length} cita(s)`);
}
