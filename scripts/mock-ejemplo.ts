/**
 * Demo end-to-end sin base de datos, sin WhatsApp y sin Google Calendar.
 *
 *   npm run demo
 *
 * Ejercita el mismo código que corre en producción (`procesarEntrante`) con
 * dobles en memoria, para ver la conversación completa: confirmar, reprogramar
 * en lenguaje natural, cancelar y una pregunta administrativa.
 */
import { procesarEntrante, parsearMensajeEntrante, resolverNuevaFecha, type DependenciasHandler } from "../src/handlers/whatsapp.handler.js";
import { procesarMensajeNlu } from "../src/services/nlu.js";
import type { CitaConPaciente, DatosMensaje } from "../src/repositories/citas.repository.js";
import { formatear } from "../src/utils/time.js";

const TELEFONO = "5512345678";

// ---------------------------------------------------------------------------
// Dobles en memoria
// ---------------------------------------------------------------------------

const citas: CitaConPaciente[] = [
  {
    id: "cita-demo-1",
    pacienteId: "pac-1",
    calendarioEventId: "evt-demo-1",
    titulo: "Endodoncia, segunda sesión",
    descripcion: null,
    fecha: new Date(Date.now() + 26 * 3_600_000),
    tipo: "ENDODONCIA",
    tratamientoId: "trat-1",
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
  } as CitaConPaciente,
];

const historial: DatosMensaje[] = [];
const eventos: string[] = [];

const deps: DependenciasHandler = {
  repo: {
    async registrarMensaje(datos) {
      historial.push(datos);
      return { ...datos, id: `msg-${historial.length}`, createdAt: new Date() } as never;
    },
    async existeMensajeProveedor(proveedorId) {
      return historial.some((m) => m.proveedorId === proveedorId);
    },
    async buscarCitasActivasPorTelefono(telefono) {
      return citas.filter((c) => c.paciente.telefono === telefono);
    },
    async actualizarEstadoCita(id, estado) {
      const cita = citas.find((c) => c.id === id);
      if (cita) cita.estado = estado;
    },
    async reprogramarCita({ citaId, nuevaFecha }) {
      const cita = citas.find((c) => c.id === citaId)!;
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
  },
  nlu: { procesarMensajeNlu },
  whatsapp: {
    async enviarTexto({ telefono, texto }) {
      console.log(`\n📤 WhatsApp → ${telefono}\n${indentar(texto)}`);
      return { proveedorId: `wamid-${Date.now()}` };
    },
    async enviarBotones({ telefono, titulo, botones }) {
      console.log(
        `\n📤 WhatsApp → ${telefono}\n${indentar(titulo)}\n${indentar("[" + botones.map((b) => b.texto).join(" | ") + "]")}`
      );
      return { proveedorId: `wamid-${Date.now()}` };
    },
  },
  calendario: {
    async moverEvento({ calendarioEventId, nuevaFecha }) {
      eventos.push(`mover ${calendarioEventId} → ${formatear(nuevaFecha, "fechaHora")}`);
    },
    async cancelarEvento(calendarioEventId) {
      eventos.push(`cancelar ${calendarioEventId}`);
    },
    async crearEvento({ motivo, fecha }) {
      eventos.push(`crear "${motivo}" → ${formatear(fecha, "fechaHora")}`);
      return `evt-nuevo-${Date.now()}`;
    },
  },
  alertas: {
    async respuestaPaciente(nlu) {
      console.log(`\n🔔 Alerta a la asistente: ${nlu.intento} · "${nlu.mensajeUsuario}"`);
    },
    async respuestaNoClara(telefono, mensaje) {
      console.log(`\n🔔 Alerta a la asistente: mensaje sin clasificar de ${telefono} · "${mensaje}"`);
    },
  },
  async programarRecordatorios(citaId, fecha) {
    console.log(`\n🗓️  Recordatorios reprogramados para ${citaId} → ${formatear(fecha, "fechaHora")}`);
    return 4;
  },
  logger: console,
};

function indentar(texto: string): string {
  return texto
    .split("\n")
    .map((linea) => `   ${linea}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Conversación
// ---------------------------------------------------------------------------

async function enviar(texto: string): Promise<void> {
  console.log("\n" + "─".repeat(70));
  console.log(`📥 Paciente (${TELEFONO}): ${texto}`);
  const entrante = parsearMensajeEntrante({
    key: { id: `wamid-demo-${Date.now()}`, remoteJid: `${TELEFONO}@s.whatsapp.net` },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000),
    fromMe: false,
  });
  if (!entrante) return;
  const resultado = await procesarEntrante(entrante, deps);
  console.log(`\n➡️  Acción: ${resultado.accion} · intención: ${resultado.intento}`);
}

async function main(): Promise<void> {
  console.log("🦷 Demo — DentalCare Retention Engine (sin infraestructura)");
  console.log(`   Cita inicial: ${formatear(citas[0].fecha, "fechaHora")} · ${citas[0].titulo}`);

  await enviar("hola, ¿llevan tarjeta?");
  await enviar("no puedo ir, cámbiamelo para el jueves");
  await enviar("sí, ahí estaré");
  await enviar("mejor cancelo, no voy a poder");

  console.log("\n" + "─".repeat(70));
  console.log("Estado final de la cita:", citas[0].estado, "·", formatear(citas[0].fecha, "fechaHora"));
  console.log("Eventos de calendario:", eventos.length ? eventos : "ninguno");
  console.log(`Mensajes registrados: ${historial.length} (entrantes y salientes)`);

  // Comprobación rápida de que el resolutor de fechas no se sale de rango.
  const ejemplo = resolverNuevaFecha(citas[0], {
    intento: "REPROGRAMAR",
    nuevaFecha: null,
    nuevaHora: "10:00",
    zona: "America/Mexico_City",
    mensajeUsuario: "",
    nota: "",
    confianza: 1,
    fuente: "regla",
  });
  console.log(`Ejemplo sin fecha explícita → +3 días a las 10:00: ${formatear(ejemplo, "fechaHora")}`);
}

main().catch((error) => {
  console.error("❌ Demo falló:", error);
  process.exit(1);
});
