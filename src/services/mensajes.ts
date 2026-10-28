/**
 * Todo el texto que ve un paciente vive aquí.
 *
 * Motivos: la asistente puede revisar y ajustar el tono sin leer código, y un
 * cambio de redacción no obliga a tocar la lógica de recordatorios. Nada de
 * este módulo incluye diagnósticos ni datos clínicos: sólo fecha, hora y el
 * nombre del tratamiento.
 */
import { formatear } from "../utils/time.js";
import { obtenerProtocolo } from "./protocolos.js";

export function nombrePila(nombreCompleto: string | null | undefined): string {
  const primero = (nombreCompleto ?? "").trim().split(/\s+/)[0] ?? "";
  if (!primero) return "paciente";
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
}

export function recodatorioTresDias(nombre: string, fecha: Date): string {
  return (
    `Hola ${nombrePila(nombre)} 👋, te escribimos del consultorio de la Dra. Laura.\n\n` +
    `Tienes una cita el ${formatear(fecha, "fechaHora")}.\n\n` +
    `¿Nos confirmas que podrás asistir? Responde *SÍ* o *NO PUEDO* y te ayudamos.`
  );
}

export function recordatorio24Horas(nombre: string, fecha: Date): string {
  return (
    `Hola ${nombrePila(nombre)} 👋, te recordamos tu cita de mañana:\n\n` +
    `📅 ${formatear(fecha, "fechaHora")}\n` +
    `🦷 Dra. Laura\n\n` +
    `¿Sigues viniendo?`
  );
}

export function recordatorio2Horas(nombre: string, fecha: Date): string {
  return (
    `Hola ${nombrePila(nombre)} 👋, tu cita es en 2 horas.\n\n` +
    `⏰ ${formatear(fecha, "hora")} hrs\n` +
    `🦷 Dra. Laura\n\n` +
    `Te esperamos. Si no puedes llegar, avísanos por aquí y liberamos el espacio.`
  );
}

export function recordatorioHoy(nombre: string, fecha: Date): string {
  return (
    `Hola ${nombrePila(nombre)} 👋, ¡hoy es tu cita!\n\n` +
    `⏰ ${formatear(fecha, "hora")} hrs\n` +
    `🦷 Dra. Laura\n\n` +
    `Llega 10 minutos antes para el registro. Si vas a retrasarte, escríbenos.`
  );
}

export function confirmacionRecibida(nombre: string, fecha: Date): string {
  return (
    `¡Gracias ${nombrePila(nombre)}! ✅\n\n` +
    `Tu cita quedó confirmada:\n\n` +
    `📅 ${formatear(fecha, "fechaHora")}\n` +
    `🦷 Dra. Laura\n\n` +
    `Te enviaremos un recordatorio el día anterior.`
  );
}

export function citaReprogramada(nombre: string, fecha: Date): string {
  return (
    `Listo ${nombrePila(nombre)} 👍\n\n` +
    `Movimos tu cita a:\n\n` +
    `📅 ${formatear(fecha, "fechaHora")}\n` +
    `🦷 Dra. Laura\n\n` +
    `Si ese horario tampoco te sirve, responde a este mensaje y lo ajustamos.`
  );
}

export function citaCancelada(nombre: string): string {
  return (
    `Entendido ${nombrePila(nombre)}. Tu cita quedó cancelada.\n\n` +
    `Cuando quieras retomarla, responde a este mensaje y te damos opciones de horario. ` +
    `Cuídate mucho.`
  );
}

export function sinCitaAsociada(): string {
  return (
    `Gracias por escribirnos. No encontré una cita reciente asociada a este número.\n\n` +
    `Para ayudarte, envíanos tu *nombre completo* y la *fecha de tu cita*, y la asistente te responde en breve.`
  );
}

export function noEntendido(): string {
  return (
    `Perdón, no entendí tu mensaje 🙏\n\n` +
    `Puedes escribirme, por ejemplo:\n` +
    `• "Sí, confirmo"\n` +
    `• "No puedo, cámbiamela para el jueves"\n\n` +
    `O si prefieres, la asistente te responde en un momento.`
  );
}

const RESPUESTAS_FRECUENTES: Array<{ patron: RegExp; respuesta: string }> = [
  {
    patron: /tarjeta|efectivo|transferencia|pago|pagar|msi|meses sin intereses/,
    respuesta:
      `Aceptamos efectivo, tarjeta de débito/crédito y transferencia. ` +
      `Si necesitas meses sin intereses, la asistente te confirma las opciones disponibles.`,
  },
  {
    patron: /precio|cuesta|costo|cuanto sale|honorarios|presupuesto/,
    respuesta:
      `El costo depende del tratamiento y de una valoración previa. ` +
      `La asistente te comparte el presupuesto exacto; no queremos darte un número que luego cambie.`,
  },
  {
    patron: /horario|a que hora abren|abren|cierran|atienden/,
    respuesta: `Atendemos de lunes a sábado. La asistente te confirma el horario exacto de esta semana.`,
  },
  {
    patron: /direccion|donde estan|ubicacion|como llego|estacionamiento/,
    respuesta: `La asistente te envía la ubicación exacta y las indicaciones para llegar.`,
  },
  {
    patron: /seguro|aseguradora|reembolso|factura/,
    respuesta: `Trabajamos con algunas aseguradoras y emitimos factura. La asistente te confirma tu caso.`,
  },
];

/**
 * Respuesta inmediata a preguntas administrativas frecuentes.
 * Devuelve null si la pregunta no está cubierta (se escala a la asistente).
 */
export function respuestaFrecuente(mensaje: string): string | null {
  const texto = mensaje
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const encontrada = RESPUESTAS_FRECUENTES.find((item) => item.patron.test(texto));
  return encontrada?.respuesta ?? null;
}

export function mensajeSeguimiento(tipoTratamiento: string, nombre: string, dias: number): string {
  const protocolo = obtenerProtocolo(tipoTratamiento);
  const retraso = dias - protocolo.diasEntreSesiones;
  return retraso >= 1
    ? protocolo.mensajeRetraso(nombrePila(nombre), dias)
    : protocolo.mensajeAviso(nombrePila(nombre));
}

export const BOTONES_CONFIRMACION = [
  { id: "confirmar_cita", texto: "Sí, asistiré" },
  { id: "reprogramar_cita", texto: "Necesito cambiarla" },
];

export const BOTONES_CANCELACION = [
  { id: "confirmar_cita", texto: "Mejor sí asisto" },
  { id: "cancelar_cita", texto: "Cancelar cita" },
];
