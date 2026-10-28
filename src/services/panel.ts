/**
 * Panel de la asistente: consultas y acciones.
 *
 * Es la capa que traduce la base de datos a "lo que la asistente necesita ver
 * hoy": citas, pendientes, tratamientos en riesgo y conversaciones. Las rutas
 * sólo validan y delegan; toda la lógica de negocio vive aquí para poder
 * probarla con un doble (ver tests/integration/panel.test.ts).
 */
import type { CitaEstado, Mensaje } from "@prisma/client";
import { config } from "../config/index.js";
import prisma from "../utils/prisma.js";
import { citasRepository } from "../repositories/citas.repository.js";
import { whatsappService, normalizarTelefono } from "./whatsapp.js";
import {
  crearEvento,
  moverEvento,
} from "./google-calendar.js";
import { construirTexto, programarRecordatorios, type Disparador } from "../scheduler/recordatorios.service.js";
import { completarCita, marcarNoShow } from "../scheduler/seguimiento.service.js";
import { citaReprogramada, mensajeSeguimiento } from "./mensajes.js";
import { obtenerProtocolo } from "./protocolos.js";
import {
  aUtcDesdeZona,
  diasDeCalendario,
  formatear,
  partesEnZona,
  sumarDias,
} from "../utils/time.js";

// ---------------------------------------------------------------------------
// Tipos de vista (lo que consume el frontend)
// ---------------------------------------------------------------------------

export type Severidad = "aviso" | "retraso" | "critico";

export interface CitaVista {
  id: string;
  fecha: string;
  hora: string;
  fechaTexto: string;
  titulo: string;
  tipo: string;
  estado: CitaEstado;
  paciente: {
    id: string;
    nombre: string;
    telefono: string | null;
    consentWhatsapp: boolean;
  };
  recordatorio: { disparador: string; estado: string } | null;
  puedeRecordar: boolean;
}

export interface ResumenVista {
  zona: string;
  ahora: string;
  hoy: { total: number; confirmadas: number; porConfirmar: number };
  manana: { total: number };
  enRiesgo: number;
  sinResponder: number;
}

export interface TratamientoVista {
  citaId: string;
  pacienteId: string;
  paciente: string;
  telefono: string | null;
  tratamiento: string;
  etiqueta: string;
  ultimaSesion: string;
  dias: number;
  esperado: number;
  retraso: number;
  severidad: Severidad;
  consentWhatsapp: boolean;
}

export interface PacienteVista {
  id: string;
  nombre: string;
  telefono: string | null;
  consentWhatsapp: boolean;
  citas: number;
  ultima: string | null;
  proxima: string | null;
  enRiesgo: boolean;
}

export interface ConversacionVista {
  telefono: string;
  nombre: string | null;
  ultimoMensaje: string;
  fecha: string;
  direccion: "IN" | "OUT";
  sinResponder: boolean;
}

export interface MensajeVista {
  id: string;
  direccion: "IN" | "OUT";
  contenido: string;
  tipo: string;
  fecha: string;
}

export interface PendientesVista {
  citas: CitaVista[];
  tratamientos: TratamientoVista[];
  conversaciones: ConversacionVista[];
}

export interface PanelService {
  resumen(): Promise<ResumenVista>;
  citas(rango: "hoy" | "manana" | "semana"): Promise<CitaVista[]>;
  pendientes(): Promise<PendientesVista>;
  tratamientos(): Promise<TratamientoVista[]>;
  pacientes(busqueda?: string): Promise<PacienteVista[]>;
  conversaciones(): Promise<ConversacionVista[]>;
  hilo(telefono: string): Promise<{ paciente: string | null; mensajes: MensajeVista[] }>;
  cambiarEstado(citaId: string, estado: CitaEstado): Promise<void>;
  enviarRecordatorio(citaId: string): Promise<{ disparador: Disparador }>;
  reprogramar(citaId: string, fecha: string, hora: string): Promise<{ fecha: string; avisoPaciente: boolean }>;
  enviarSeguimiento(citaId: string): Promise<{ dias: number; severidad: Severidad }>;
  responder(telefono: string, texto: string): Promise<void>;
  cambiarConsentimiento(pacienteId: string, valor: boolean): Promise<void>;
  actualizarTelefono(pacienteId: string, telefono: string | null): Promise<void>;
}

export class PanelError extends Error {
  constructor(
    message: string,
    readonly estadoHttp = 400
  ) {
    super(message);
    this.name = "PanelError";
  }
}

/**
 * Traduce el error técnico de Evolution a algo que la asistente pueda accionar.
 * El detalle real queda en el log, no en la pantalla de la clínica.
 */
function errorDeWhatsapp(error: unknown): PanelError {
  const detalle = error instanceof Error ? error.message : String(error);
  console.error("[panel] WhatsApp:", detalle);

  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout|socket hang up/i.test(detalle)) {
    return new PanelError(
      "WhatsApp no está disponible ahora mismo (Evolution sin conexión). Revisa el servidor de WhatsApp e inténtalo de nuevo.",
      502
    );
  }
  if (/401|403|unauthorized|not connected|closed|instance/i.test(detalle)) {
    return new PanelError(
      "La instancia de WhatsApp no está conectada. Escanea el QR en Evolution API y reintenta.",
      502
    );
  }
  return new PanelError(`No se pudo enviar por WhatsApp: ${detalle}`, 502);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const ESTADOS_VALIDOS: CitaEstado[] = [
  "AGENDADA",
  "CONFIRMADA",
  "NO_SHOW",
  "CANCELADA_POR_PACIENTE",
  "CANCELADA_POR_CLINICA",
  "COMPLETADA",
  "REAGENDADA",
];

const ACTIVAS: CitaEstado[] = ["AGENDADA", "CONFIRMADA", "REAGENDADA"];

function rangoDia(offset = 0): { desde: Date; hasta: Date } {
  const { anio, mes, dia } = partesEnZona(new Date());
  return {
    desde: aUtcDesdeZona(anio, mes, dia + offset, 0, 0),
    hasta: aUtcDesdeZona(anio, mes, dia + offset + 1, 0, 0),
  };
}

function aVista(cita: {
  id: string;
  fecha: Date;
  titulo: string;
  tipo: string;
  estado: CitaEstado;
  paciente: { id: string; nombre: string; telefono: string | null; consentWhatsapp: boolean };
  recordatorios: Array<{ disparador: string; estado: string }>;
}): CitaVista {
  const recordatorio = cita.recordatorios[0] ?? null;
  return {
    id: cita.id,
    fecha: cita.fecha.toISOString(),
    hora: formatear(cita.fecha, "hora"),
    fechaTexto: formatear(cita.fecha, "fechaHora"),
    titulo: cita.titulo,
    tipo: cita.tipo,
    estado: cita.estado,
    paciente: cita.paciente,
    recordatorio: recordatorio
      ? { disparador: recordatorio.disparador, estado: recordatorio.estado }
      : null,
    puedeRecordar:
      cita.fecha.getTime() > Date.now() &&
      ACTIVAS.includes(cita.estado) &&
      Boolean(cita.paciente.telefono) &&
      cita.paciente.consentWhatsapp,
  };
}

function severidadDe(dias: number, esperado: number, alerta: number, critico: number): Severidad {
  const retraso = dias - esperado;
  if (retraso >= critico) return "critico";
  if (retraso >= alerta) return "retraso";
  return "aviso";
}

// ---------------------------------------------------------------------------
// Implementación
// ---------------------------------------------------------------------------

class PrismaPanelService implements PanelService {
  async resumen(): Promise<ResumenVista> {
    const hoy = rangoDia(0);
    const manana = rangoDia(1);

    const [citasHoy, citasManana, enRiesgo, conversaciones] = await Promise.all([
      prisma.cita.findMany({
        where: { fecha: { gte: hoy.desde, lt: hoy.hasta } },
        select: { estado: true },
      }),
      prisma.cita.count({ where: { fecha: { gte: manana.desde, lt: manana.hasta } } }),
      this.tratamientos(),
      this.conversaciones(),
    ]);

    return {
      zona: config.TIMEZONE,
      ahora: new Date().toISOString(),
      hoy: {
        total: citasHoy.length,
        confirmadas: citasHoy.filter((c) => c.estado === "CONFIRMADA").length,
        porConfirmar: citasHoy.filter((c) => c.estado === "AGENDADA").length,
      },
      manana: { total: citasManana },
      enRiesgo: enRiesgo.length,
      sinResponder: conversaciones.filter((c) => c.sinResponder).length,
    };
  }

  async citas(rango: "hoy" | "manana" | "semana"): Promise<CitaVista[]> {
    const { desde, hasta } =
      rango === "hoy"
        ? rangoDia(0)
        : rango === "manana"
          ? rangoDia(1)
          : { desde: rangoDia(0).desde, hasta: rangoDia(7).desde };

    const citas = await prisma.cita.findMany({
      where: { fecha: { gte: desde, lt: hasta } },
      include: {
        paciente: true,
        recordatorios: {
          where: { disparador: "D_MINUS_24H" },
          select: { disparador: true, estado: true },
          take: 1,
        },
      },
      orderBy: { fecha: "asc" },
    });

    return citas.map(aVista);
  }

  async pendientes(): Promise<PendientesVista> {
    const ahora = new Date();
    const limite = new Date(ahora.getTime() + 48 * 3_600_000);

    const [citasSinConfirmar, tratamientos, conversaciones] = await Promise.all([
      prisma.cita.findMany({
        where: { fecha: { gte: ahora, lte: limite }, estado: "AGENDADA" },
        include: { paciente: true, recordatorios: { select: { disparador: true, estado: true } } },
        orderBy: { fecha: "asc" },
      }),
      this.tratamientos(),
      this.conversaciones(),
    ]);

    return {
      citas: citasSinConfirmar.map(aVista),
      tratamientos: tratamientos.filter((t) => t.severidad !== "aviso"),
      conversaciones: conversaciones.filter((c) => c.sinResponder),
    };
  }

  async tratamientos(): Promise<TratamientoVista[]> {
    const ahora = new Date();

    const citas = await prisma.cita.findMany({
      where: {
        estado: "COMPLETADA",
        fecha: { gte: sumarDias(ahora, -120) },
        tratamientoId: { not: null },
      },
      include: {
        paciente: true,
        tratamiento: true,
        sesiones: { orderBy: { fecha: "desc" }, take: 1 },
      },
      orderBy: { fecha: "desc" },
      take: 200,
    });

    if (citas.length === 0) return [];

    const pacientes = [...new Set(citas.map((c) => c.pacienteId))];
    const futuras = await prisma.cita.findMany({
      where: {
        pacienteId: { in: pacientes },
        fecha: { gt: ahora },
        estado: { in: ACTIVAS },
      },
      select: { pacienteId: true, tipo: true },
    });
    const yaAgendado = new Set(futuras.map((c) => `${c.pacienteId}:${c.tipo}`));

    const vistas: TratamientoVista[] = [];
    const vistos = new Set<string>();

    for (const cita of citas) {
      const tipo = cita.tratamiento?.tipo ?? cita.tipo;
      const clave = `${cita.pacienteId}:${tipo}`;
      if (yaAgendado.has(clave) || vistos.has(clave)) continue;
      vistos.add(clave);

      const protocolo = obtenerProtocolo(tipo);
      const ultimaSesion = cita.sesiones[0]?.fecha ?? cita.fecha;
      const dias = diasDeCalendario(ultimaSesion, ahora);

      // Sólo interesa cuando ya toca avisar.
      if (dias < protocolo.diasEntreSesiones - protocolo.avisoAnticipado) continue;

      vistas.push({
        citaId: cita.id,
        pacienteId: cita.pacienteId,
        paciente: cita.paciente.nombre,
        telefono: cita.paciente.telefono,
        tratamiento: protocolo.tipo,
        etiqueta: protocolo.etiqueta,
        ultimaSesion: ultimaSesion.toISOString(),
        dias,
        esperado: protocolo.diasEntreSesiones,
        retraso: Math.max(0, dias - protocolo.diasEntreSesiones),
        severidad: severidadDe(
          dias,
          protocolo.diasEntreSesiones,
          protocolo.umbralAlerta,
          protocolo.umbralCritico
        ),
        consentWhatsapp: cita.paciente.consentWhatsapp,
      });
    }

    return vistas.sort((a, b) => b.retraso - a.retraso);
  }

  async pacientes(busqueda?: string): Promise<PacienteVista[]> {
    const termino = busqueda?.trim();
    const ahora = new Date();

    const pacientes = await prisma.paciente.findMany({
      where: termino
        ? {
            OR: [
              { nombre: { contains: termino, mode: "insensitive" } },
              { telefono: { contains: termino } },
            ],
          }
        : undefined,
      include: {
        citas: { orderBy: { fecha: "desc" }, take: 20 },
      },
      orderBy: { nombre: "asc" },
      take: 60,
    });

    return pacientes.map((paciente) => {
      const pasadas = paciente.citas.filter((c) => c.fecha < ahora);
      const futuras = paciente.citas.filter((c) => c.fecha >= ahora && ACTIVAS.includes(c.estado));
      return {
        id: paciente.id,
        nombre: paciente.nombre,
        telefono: paciente.telefono,
        consentWhatsapp: paciente.consentWhatsapp,
        citas: paciente.citas.length,
        ultima: pasadas[0]?.fecha.toISOString() ?? null,
        proxima: futuras[futuras.length - 1]?.fecha.toISOString() ?? null,
        enRiesgo: false,
      };
    });
  }

  async conversaciones(): Promise<ConversacionVista[]> {
    const mensajes = await prisma.mensaje.findMany({
      orderBy: { createdAt: "desc" },
      take: 400,
      select: {
        telefono: true,
        contenido: true,
        direccion: true,
        tipo: true,
        createdAt: true,
      },
    });

    const porTelefono = new Map<string, (typeof mensajes)[number]>();
    for (const mensaje of mensajes) {
      if (!porTelefono.has(mensaje.telefono)) porTelefono.set(mensaje.telefono, mensaje);
    }

    const telefonos = [...porTelefono.keys()];
    if (telefonos.length === 0) return [];

    const pacientes = await prisma.paciente.findMany({
      where: { telefono: { in: telefonos } },
      select: { telefono: true, nombre: true },
    });
    const nombres = new Map(pacientes.map((p) => [p.telefono ?? "", p.nombre]));

    const limiteSinResponder = Date.now() - 15 * 60_000;

    return [...porTelefono.values()]
      .filter((m) => m.tipo !== "sistema")
      .slice(0, 40)
      .map((mensaje) => ({
        telefono: mensaje.telefono,
        nombre: nombres.get(mensaje.telefono) ?? null,
        ultimoMensaje: mensaje.contenido.slice(0, 120),
        fecha: mensaje.createdAt.toISOString(),
        direccion: mensaje.direccion,
        sinResponder:
          mensaje.direccion === "IN" && mensaje.createdAt.getTime() < limiteSinResponder,
      }));
  }

  async hilo(telefono: string): Promise<{ paciente: string | null; mensajes: MensajeVista[] }> {
    const numero = telefono.replace(/\D/g, "");
    if (numero.length < 10) throw new PanelError("Teléfono inválido");

    const [paciente, mensajes] = await Promise.all([
      prisma.paciente.findFirst({ where: { telefono: numero }, select: { nombre: true } }),
      prisma.mensaje.findMany({
        where: { telefono: numero },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
    ]);

    return {
      paciente: paciente?.nombre ?? null,
      mensajes: mensajes.reverse().map(aMensajeVista),
    };
  }

  async cambiarEstado(citaId: string, estado: CitaEstado): Promise<void> {
    if (!ESTADOS_VALIDOS.includes(estado)) {
      throw new PanelError(`Estado inválido: ${estado}`);
    }

    const cita = await prisma.cita.findUnique({ where: { id: citaId }, select: { id: true } });
    if (!cita) throw new PanelError("Cita no encontrada", 404);

    if (estado === "COMPLETADA") {
      await completarCita(citaId, "Marcada como completada desde el panel");
      return;
    }
    if (estado === "NO_SHOW") {
      await marcarNoShow(citaId);
      return;
    }
    await prisma.cita.update({ where: { id: citaId }, data: { estado } });
  }

  async enviarRecordatorio(citaId: string): Promise<{ disparador: Disparador }> {
    const cita = await prisma.cita.findUnique({
      where: { id: citaId },
      include: { paciente: true },
    });
    if (!cita) throw new PanelError("Cita no encontrada", 404);
    if (!cita.paciente.telefono) throw new PanelError("El paciente no tiene teléfono registrado");
    if (!cita.paciente.consentWhatsapp) {
      throw new PanelError("El paciente no ha autorizado mensajes de WhatsApp");
    }
    if (!ACTIVAS.includes(cita.estado)) {
      throw new PanelError(`No se puede recordar una cita en estado ${cita.estado}`);
    }
    if (cita.fecha.getTime() <= Date.now()) {
      throw new PanelError("La cita ya pasó: no tiene sentido enviar un recordatorio");
    }

    const horas = (cita.fecha.getTime() - Date.now()) / 3_600_000;
    const disparador: Disparador = horas <= 4 ? "D_MINUS_2H" : horas <= 30 ? "D_MINUS_24H" : "D_MINUS_3D";
    const texto = construirTexto(disparador, cita.paciente.nombre, cita.fecha);

    try {
      await whatsappService.enviarTexto({ telefono: cita.paciente.telefono, texto, rapido: true });
    } catch (error) {
      throw errorDeWhatsapp(error);
    }

    await prisma.mensaje.create({
      data: {
        direccion: "OUT",
        telefono: cita.paciente.telefono,
        contenido: texto,
        tipo: `manual:${disparador}`,
        citaId: cita.id,
      },
    });

    await prisma.recordatorioEnvio.updateMany({
      where: { citaId: cita.id, disparador },
      data: { estado: "ENVIADO", enviadoEn: new Date(), contenido: texto },
    });

    return { disparador };
  }

  async reprogramar(
    citaId: string,
    fecha: string,
    hora: string
  ): Promise<{ fecha: string; avisoPaciente: boolean }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new PanelError("Formato de fecha inválido (YYYY-MM-DD)");
    if (!/^\d{2}:\d{2}$/.test(hora)) throw new PanelError("Formato de hora inválido (HH:mm)");

    const cita = await prisma.cita.findUnique({
      where: { id: citaId },
      include: { paciente: true },
    });
    if (!cita) throw new PanelError("Cita no encontrada", 404);
    if (cita.estado === "COMPLETADA" || cita.estado.startsWith("CANCELADA")) {
      throw new PanelError(`No se puede mover una cita en estado ${cita.estado}`);
    }

    const [anio, mes, dia] = fecha.split("-").map(Number);
    const [hh, mm] = hora.split(":").map(Number);
    const nuevaFecha = aUtcDesdeZona(anio, mes, dia, hh, mm);

    if (nuevaFecha.getTime() <= Date.now()) {
      throw new PanelError("La nueva fecha debe estar en el futuro");
    }

    // Google primero, pero sin bloquear la agenda si falla.
    try {
      if (cita.calendarioEventId) {
        await moverEvento({ calendarioEventId: cita.calendarioEventId, nuevaFecha });
      } else if (config.googleHabilitado) {
        const eventoId = await crearEvento({
          paciente: { nombre: cita.paciente.nombre },
          motivo: cita.titulo,
          fecha: nuevaFecha,
        });
        await citasRepository.vincularEventoCalendario(cita.id, eventoId);
      }
    } catch (error) {
      console.error("[panel] No se pudo mover el evento de Calendar:", (error as Error).message);
    }

    await citasRepository.reprogramarCita({
      citaId: cita.id,
      nuevaFecha,
      nota: "Reprogramada por la asistente desde el panel",
    });
    await programarRecordatorios(cita.id, nuevaFecha);

    let avisoPaciente = false;
    if (cita.paciente.telefono && cita.paciente.consentWhatsapp) {
      const texto = citaReprogramada(cita.paciente.nombre, nuevaFecha);
      try {
        await whatsappService.enviarTexto({ telefono: cita.paciente.telefono, texto, rapido: true });
        await prisma.mensaje.create({
          data: {
            direccion: "OUT",
            telefono: cita.paciente.telefono,
            contenido: texto,
            tipo: "reprogramacion:manual",
            citaId: cita.id,
          },
        });
        avisoPaciente = true;
      } catch (error) {
        console.error("[panel] No se pudo avisar al paciente:", (error as Error).message);
      }
    }

    return { fecha: nuevaFecha.toISOString(), avisoPaciente };
  }

  async enviarSeguimiento(citaId: string): Promise<{ dias: number; severidad: Severidad }> {
    const cita = await prisma.cita.findUnique({
      where: { id: citaId },
      include: {
        paciente: true,
        tratamiento: true,
        sesiones: { orderBy: { fecha: "desc" }, take: 1 },
      },
    });
    if (!cita) throw new PanelError("Cita no encontrada", 404);
    if (!cita.paciente.telefono) throw new PanelError("El paciente no tiene teléfono registrado");
    if (!cita.paciente.consentWhatsapp) {
      throw new PanelError("El paciente no ha autorizado mensajes de WhatsApp");
    }
    if (cita.estado !== "COMPLETADA") {
      throw new PanelError("El seguimiento sólo aplica a citas completadas");
    }

    const tipo = cita.tratamiento?.tipo ?? cita.tipo;
    const protocolo = obtenerProtocolo(tipo);
    const ultimaSesion = cita.sesiones[0]?.fecha ?? cita.fecha;
    const dias = diasDeCalendario(ultimaSesion, new Date());
    const texto = mensajeSeguimiento(tipo, cita.paciente.nombre, dias);

    try {
      await whatsappService.enviarTexto({ telefono: cita.paciente.telefono, texto, rapido: true });
    } catch (error) {
      throw errorDeWhatsapp(error);
    }

    await prisma.mensaje.create({
      data: {
        direccion: "OUT",
        telefono: cita.paciente.telefono,
        contenido: texto,
        tipo: `seguimiento:${protocolo.tipo}`,
        citaId: cita.id,
      },
    });

    return {
      dias,
      severidad: severidadDe(
        dias,
        protocolo.diasEntreSesiones,
        protocolo.umbralAlerta,
        protocolo.umbralCritico
      ),
    };
  }

  /**
   * Respuesta escrita por la asistente desde el panel.
   * Respeta el consentimiento: sin autorización no se escribe, aunque la
   * asistente insista. El panel muestra el aviso en la ficha del paciente.
   */
  async responder(telefono: string, texto: string): Promise<void> {
    const numero = telefono.replace(/\D/g, "");
    const mensaje = texto.trim();

    if (numero.length < 10) throw new PanelError("Teléfono inválido");
    if (mensaje.length === 0) throw new PanelError("El mensaje está vacío");
    if (mensaje.length > 1000) throw new PanelError("El mensaje es demasiado largo (máx. 1000)");

    const paciente = await prisma.paciente.findFirst({
      where: { telefono: numero },
      select: { id: true, nombre: true, consentWhatsapp: true },
    });
    if (!paciente) throw new PanelError("No hay un paciente con ese teléfono", 404);
    if (!paciente.consentWhatsapp) {
      throw new PanelError("El paciente no ha autorizado mensajes de WhatsApp");
    }

    try {
      await whatsappService.enviarTexto({ telefono: numero, texto: mensaje, rapido: true });
    } catch (error) {
      throw errorDeWhatsapp(error);
    }

    await prisma.mensaje.create({
      data: {
        direccion: "OUT",
        telefono: numero,
        contenido: mensaje,
        tipo: "manual:asistente",
      },
    });
  }

  async cambiarConsentimiento(pacienteId: string, valor: boolean): Promise<void> {
    const paciente = await prisma.paciente.findUnique({
      where: { id: pacienteId },
      select: { id: true },
    });
    if (!paciente) throw new PanelError("Paciente no encontrado", 404);

    await prisma.paciente.update({
      where: { id: pacienteId },
      data: { consentWhatsapp: valor },
    });

    // Al autorizar, se programan de inmediato los recordatorios pendientes.
    if (valor) {
      const citas = await prisma.cita.findMany({
        where: {
          pacienteId,
          fecha: { gt: new Date() },
          estado: { in: ACTIVAS },
        },
        select: { id: true, fecha: true },
      });
      for (const cita of citas) {
        await programarRecordatorios(cita.id, cita.fecha);
      }
    }
  }

  /**
   * Registra o corrige el teléfono desde el panel.
   *
   * Se guardan los últimos 10 dígitos porque es el formato con el que llegan
   * los mensajes entrantes; al enviar, `whatsapp.ts` antepone la lada del país.
   */
  async actualizarTelefono(pacienteId: string, telefono: string | null): Promise<void> {
    const paciente = await prisma.paciente.findUnique({
      where: { id: pacienteId },
      select: { id: true },
    });
    if (!paciente) throw new PanelError("Paciente no encontrado", 404);

    const digitos = normalizarTelefono(telefono ?? "");
    if (digitos.length > 0 && (digitos.length < 10 || digitos.length > 15)) {
      throw new PanelError("El teléfono debe tener entre 10 y 15 dígitos");
    }

    const numero = digitos ? digitos.slice(-10) : null;

    if (numero) {
      const ocupado = await prisma.paciente.findFirst({
        where: { telefono: numero, id: { not: pacienteId } },
        select: { nombre: true },
      });
      if (ocupado) {
        throw new PanelError(
          `Ese teléfono ya está registrado a nombre de ${ocupado.nombre}.`,
          409
        );
      }
    }

    await prisma.paciente.update({
      where: { id: pacienteId },
      data: { telefono: numero },
    });
  }
}

function aMensajeVista(mensaje: Mensaje): MensajeVista {
  return {
    id: mensaje.id,
    direccion: mensaje.direccion,
    contenido: mensaje.contenido,
    tipo: mensaje.tipo,
    fecha: mensaje.createdAt.toISOString(),
  };
}

export const panelService = new PrismaPanelService();
