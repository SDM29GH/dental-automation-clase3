/**
 * Dobles en memoria para probar el flujo conversacional sin PostgreSQL,
 * sin WhatsApp y sin Google Calendar.
 */
import type {
  CitaConPaciente,
  CitasRepository,
  DatosMensaje,
} from "../../src/repositories/citas.repository.js";
import type { DependenciasHandler } from "../../src/handlers/whatsapp.handler.js";
import { procesarMensajeNlu } from "../../src/services/nlu.js";

export const TELEFONO = "5512345678";

export function crearCita(overrides: Partial<CitaConPaciente> = {}): CitaConPaciente {
  const fecha = overrides.fecha ?? new Date(Date.now() + 26 * 3_600_000);
  return {
    id: "cita-1",
    pacienteId: "pac-1",
    calendarioEventId: "evt-1",
    titulo: "Endodoncia, segunda sesión",
    descripcion: null,
    fecha,
    tipo: "ENDODONCIA",
    tratamientoId: null,
    metadata: null,
    estado: "AGENDADA",
    createdAt: new Date(),
    updatedAt: new Date(),
    paciente: {
      id: "pac-1",
      nombre: "Ana Ruiz",
      telefono: TELEFONO,
      consentWhatsapp: true,
      nota: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...overrides,
  };
}

export interface RegistroFake {
  mensajes: DatosMensaje[];
  eventos: Array<{ tipo: string; detalle: string }>;
  alertas: string[];
  recordatorios: Array<{ citaId: string; fecha: Date }>;
}

export function crearRepoFalso(citas: CitaConPaciente[], registro: RegistroFake) {
  const repo: CitasRepository = {
    async registrarMensaje(datos) {
      registro.mensajes.push(datos);
      return {
        id: `msg-${registro.mensajes.length}`,
        citaId: datos.citaId ?? null,
        direccion: datos.direccion,
        telefono: datos.telefono,
        tipo: datos.tipo,
        contenido: datos.contenido,
        estado: datos.estado ?? "ENVIADO",
        proveedorId: datos.proveedorId ?? null,
        createdAt: new Date(),
      };
    },
    async existeMensajeProveedor(proveedorId) {
      return registro.mensajes.some((m) => m.proveedorId === proveedorId);
    },
    async buscarCitasActivasPorTelefono(telefono) {
      return citas.filter((c) => c.paciente.telefono === telefono);
    },
    async buscarCita(id) {
      return citas.find((c) => c.id === id) ?? null;
    },
    async actualizarEstadoCita(id, estado) {
      const cita = citas.find((c) => c.id === id);
      if (cita) cita.estado = estado;
    },
    async reprogramarCita({ citaId, nuevaFecha }) {
      const cita = citas.find((c) => c.id === citaId);
      if (!cita) throw new Error("cita no encontrada");
      cita.fecha = nuevaFecha;
      cita.estado = "REAGENDADA";
      return cita;
    },
    async cancelarCita(id) {
      const cita = citas.find((c) => c.id === id);
      if (cita) cita.estado = "CANCELADA_POR_PACIENTE";
    },
    async vincularEventoCalendario(citaId, eventoId) {
      const cita = citas.find((c) => c.id === citaId);
      if (cita) cita.calendarioEventId = eventoId;
    },
  };

  return repo;
}

export function crearDependencias(
  citas: CitaConPaciente[] = [crearCita()]
): { deps: DependenciasHandler; registro: RegistroFake; citas: CitaConPaciente[] } {
  const registro: RegistroFake = {
    mensajes: [],
    eventos: [],
    alertas: [],
    recordatorios: [],
  };

  const deps: DependenciasHandler = {
    repo: crearRepoFalso(citas, registro),
    nlu: { procesarMensajeNlu },
    whatsapp: {
      async enviarTexto({ texto }) {
        return { proveedorId: `wa-${texto.length}` };
      },
      async enviarBotones() {
        return { proveedorId: "wa-botones" };
      },
    },
    calendario: {
      async moverEvento({ calendarioEventId, nuevaFecha }) {
        registro.eventos.push({
          tipo: "mover",
          detalle: `${calendarioEventId} → ${nuevaFecha.toISOString()}`,
        });
      },
      async cancelarEvento(calendarioEventId) {
        registro.eventos.push({ tipo: "cancelar", detalle: calendarioEventId });
      },
      async crearEvento({ motivo }) {
        registro.eventos.push({ tipo: "crear", detalle: motivo });
        return "evt-nuevo";
      },
    },
    alertas: {
      async respuestaPaciente(nlu) {
        registro.alertas.push(`respuesta:${nlu.intento}`);
      },
      async respuestaNoClara(_telefono, mensaje) {
        registro.alertas.push(`sin-clasificar:${mensaje}`);
      },
    },
    async programarRecordatorios(citaId, fecha) {
      registro.recordatorios.push({ citaId, fecha });
      return 4;
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  };

  return { deps, registro, citas };
}

/** Construye un payload como el que envía Evolution API. */
export function payloadEvolution(texto: string, opciones: {
  proveedorId?: string;
  botonId?: string;
  fromMe?: boolean;
  grupo?: boolean;
} = {}) {
  return {
    event: "messages.upsert",
    instance: "consultorio-laura",
    cuerpo: {
      data: {
        key: {
          id: opciones.proveedorId ?? `wamid-${Math.random().toString(36).slice(2)}`,
          remoteJid: opciones.grupo
            ? "123456789-987654@g.us"
            : `${TELEFONO}@s.whatsapp.net`,
        },
        message: opciones.botonId
          ? {
              buttonsResponseMessage: {
                selectedButtonId: opciones.botonId,
                selectedButtonText: texto,
              },
            }
          : { conversation: texto },
        messageTimestamp: Math.floor(Date.now() / 1000),
        fromMe: opciones.fromMe ?? false,
      },
    },
  };
}
