/**
 * Acceso a datos de citas.
 *
 * El handler depende de esta interfaz, no de Prisma: así el flujo
 * conversacional se prueba con un repositorio en memoria, sin base de datos
 * ni contenedores.
 */
import type { Cita, CitaEstado, Mensaje, Paciente } from "@prisma/client";
import prisma from "../utils/prisma.js";

export type CitaConPaciente = Cita & { paciente: Paciente };

export interface DatosMensaje {
  direccion: "IN" | "OUT";
  telefono: string;
  contenido: string;
  tipo: string;
  citaId?: string | null;
  proveedorId?: string | null;
  estado?: "ENVIADO" | "LEIDO" | "FALLIDO";
}

export interface CitasRepository {
  registrarMensaje(datos: DatosMensaje): Promise<Mensaje>;
  existeMensajeProveedor(proveedorId: string): Promise<boolean>;
  buscarCitasActivasPorTelefono(telefono: string, ventanaHoras?: number): Promise<CitaConPaciente[]>;
  buscarCita(id: string): Promise<CitaConPaciente | null>;
  actualizarEstadoCita(id: string, estado: CitaEstado): Promise<void>;
  reprogramarCita(datos: { citaId: string; nuevaFecha: Date; nota: string }): Promise<CitaConPaciente>;
  cancelarCita(id: string, motivo: string): Promise<void>;
  vincularEventoCalendario(citaId: string, calendarioEventId: string): Promise<void>;
}

type Metadata = Record<string, unknown>;

function leerMetadata(valor: unknown): Metadata {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Metadata) : {};
}

class PrismaCitasRepository implements CitasRepository {
  async registrarMensaje(datos: DatosMensaje): Promise<Mensaje> {
    return prisma.mensaje.create({
      data: {
        direccion: datos.direccion,
        telefono: datos.telefono,
        contenido: datos.contenido,
        tipo: datos.tipo,
        citaId: datos.citaId ?? null,
        proveedorId: datos.proveedorId ?? null,
        estado: datos.estado ?? "ENVIADO",
      },
    });
  }

  async existeMensajeProveedor(proveedorId: string): Promise<boolean> {
    const encontrado = await prisma.mensaje.findFirst({
      where: { proveedorId },
      select: { id: true },
    });
    return encontrado !== null;
  }

  async buscarCitasActivasPorTelefono(
    telefono: string,
    ventanaHoras = 72
  ): Promise<CitaConPaciente[]> {
    const desde = new Date(Date.now() - ventanaHoras * 3_600_000);
    return prisma.cita.findMany({
      where: {
        paciente: { telefono },
        estado: { in: ["AGENDADA", "CONFIRMADA", "REAGENDADA"] },
        OR: [{ fecha: { gte: desde } }, { updatedAt: { gte: desde } }],
      },
      include: { paciente: true },
      orderBy: { fecha: "asc" },
      take: 3,
    });
  }

  async buscarCita(id: string): Promise<CitaConPaciente | null> {
    return prisma.cita.findUnique({ where: { id }, include: { paciente: true } });
  }

  async actualizarEstadoCita(id: string, estado: CitaEstado): Promise<void> {
    await prisma.cita.update({ where: { id }, data: { estado } });
  }

  /**
   * Mueve la cita en sitio en lugar de crear otra: conserva el evento de
   * Google Calendar, el historial de mensajes y evita citas duplicadas.
   */
  async reprogramarCita(datos: {
    citaId: string;
    nuevaFecha: Date;
    nota: string;
  }): Promise<CitaConPaciente> {
    const cita = await prisma.cita.findUnique({ where: { id: datos.citaId } });
    if (!cita) throw new Error(`Cita ${datos.citaId} no encontrada`);

    const metadata = leerMetadata(cita.metadata);
    const historial = Array.isArray(metadata.historial) ? metadata.historial : [];

    return prisma.cita.update({
      where: { id: datos.citaId },
      data: {
        fecha: datos.nuevaFecha,
        estado: "REAGENDADA",
        metadata: {
          ...metadata,
          historial: [
            ...historial,
            {
              tipo: "reprogramacion",
              fechaAnterior: cita.fecha.toISOString(),
              fechaNueva: datos.nuevaFecha.toISOString(),
              nota: datos.nota,
              en: new Date().toISOString(),
            },
          ],
        },
      },
      include: { paciente: true },
    });
  }

  async cancelarCita(id: string, motivo: string): Promise<void> {
    const cita = await prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new Error(`Cita ${id} no encontrada`);

    const metadata = leerMetadata(cita.metadata);
    await prisma.cita.update({
      where: { id },
      data: {
        estado: "CANCELADA_POR_PACIENTE",
        metadata: {
          ...metadata,
          cancelacion: { motivo, en: new Date().toISOString() },
        },
      },
    });
  }

  async vincularEventoCalendario(citaId: string, calendarioEventId: string): Promise<void> {
    await prisma.cita.update({ where: { id: citaId }, data: { calendarioEventId } });
  }
}

export const citasRepository = new PrismaCitasRepository();
