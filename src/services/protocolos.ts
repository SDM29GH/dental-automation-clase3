/**
 * Protocolos clínicos del seguimiento multisesión.
 *
 * Cada tratamiento define cuándo avisar al paciente y cuándo encender una
 * alerta para la asistente. Están aquí (y no enterrados en el scheduler) para
 * que la Dra. Laura pueda ajustarlos sin tocar la lógica.
 *
 * Regla de negocio central: el paciente deja de venir cuando deja de dolerle.
 * Por eso el aviso llega *antes* del intervalo esperado, y la alerta salta en
 * cuanto se pasa, no una semana después.
 */
export interface Protocolo {
  tipo: string;
  etiqueta: string;
  /** Días esperados entre una sesión y la siguiente. */
  diasEntreSesiones: number;
  /** Cuántos días antes del intervalo se le escribe al paciente. */
  avisoAnticipado: number;
  /** Días de retraso que generan alerta normal a la asistente. */
  umbralAlerta: number;
  /** Días de retraso que marcan riesgo alto de abandono. */
  umbralCritico: number;
  mensajeAviso: (nombre: string) => string;
  mensajeRetraso: (nombre: string, dias: number) => string;
}

const PROTOCOLOS: Record<string, Protocolo> = {
  ENDODONCIA: {
    tipo: "ENDODONCIA",
    etiqueta: "Endodoncia (tratamiento de conducto)",
    diasEntreSesiones: 7,
    avisoAnticipado: 2,
    umbralAlerta: 3,
    umbralCritico: 10,
    mensajeAviso: (nombre) =>
      `Hola ${nombre} 👋, te escribimos del consultorio de la Dra. Laura.\n\n` +
      `Ya casi toca tu siguiente sesión de endodoncia. ¿Cómo ha evolucionado el diente? ` +
      `¿Sigues con alguna molestia?\n\n` +
      `Si todo va bien, te agendamos la siguiente sesión para terminar el tratamiento. ¿Te viene bien esta semana?`,
    mensajeRetraso: (nombre, dias) =>
      `Hola ${nombre} 👋, del consultorio de la Dra. Laura.\n\n` +
      `Han pasado ${dias} días desde tu última sesión de endodoncia y el tratamiento aún no está terminado. ` +
      `Aunque ya no sientas dolor, el conducto sigue abierto y puede reinfectarse.\n\n` +
      `¿Te agendamos esta semana para cerrarlo?`,
  },

  ORTODONCIA: {
    tipo: "ORTODONCIA",
    etiqueta: "Ortodoncia",
    diasEntreSesiones: 15,
    avisoAnticipado: 4,
    umbralAlerta: 5,
    umbralCritico: 21,
    mensajeAviso: (nombre) =>
      `Hola ${nombre} 👋, de la Dra. Laura.\n\n` +
      `Ya toca tu ajuste de ortodoncia. ¿Cómo van los brackets? ¿Algún alambre que moleste o diente sensible?\n\n` +
      `Los controles puntuales acortan el tratamiento. ¿Agendamos tu cita?`,
    mensajeRetraso: (nombre, dias) =>
      `Hola ${nombre} 👋, de la Dra. Laura.\n\n` +
      `Llevas ${dias} días sin tu ajuste de ortodoncia. Cuando se espacian los controles, ` +
      `el tratamiento se alarga y los dientes pueden moverse fuera de lo planeado.\n\n` +
      `¿Cuándo te agendamos?`,
  },

  PROTESIS: {
    tipo: "PROTESIS",
    etiqueta: "Prótesis dental",
    diasEntreSesiones: 10,
    avisoAnticipado: 3,
    umbralAlerta: 4,
    umbralCritico: 14,
    mensajeAviso: (nombre) =>
      `Hola ${nombre} 👋, del consultorio de la Dra. Laura.\n\n` +
      `¿Cómo te has sentido con la prótesis desde tu última visita? ¿Hay algún punto que roce o se mueva?\n\n` +
      `Conviene revisarla antes de que aparezca una úlcera. ¿Te agendamos?`,
    mensajeRetraso: (nombre, dias) =>
      `Hola ${nombre} 👋, del consultorio de la Dra. Laura.\n\n` +
      `Han pasado ${dias} días desde tu última cita de prótesis. Un ajuste a tiempo evita ` +
      `fracturas y molestias mayores.\n\n` +
      `¿Cuándo te viene bien pasar?`,
  },

  IMPLANTE: {
    tipo: "IMPLANTE",
    etiqueta: "Implante dental",
    diasEntreSesiones: 14,
    avisoAnticipado: 3,
    umbralAlerta: 5,
    umbralCritico: 21,
    mensajeAviso: (nombre) =>
      `Hola ${nombre} 👋, de la Dra. Laura.\n\n` +
      `Toca revisión de tu implante. ¿Cómo va la encía? ¿Se inflama o molesta al masticar?\n\n` +
      `¿Agendamos tu control?`,
    mensajeRetraso: (nombre, dias) =>
      `Hola ${nombre} 👋, de la Dra. Laura.\n\n` +
      `Llevas ${dias} días sin revisión de tu implante. Las revisiones permiten detectar ` +
      `problemas de encía antes de que afecten al implante.\n\n` +
      `¿Te agendamos?`,
  },

  CONTROL: {
    tipo: "CONTROL",
    etiqueta: "Control / revisión",
    diasEntreSesiones: 30,
    avisoAnticipado: 7,
    umbralAlerta: 10,
    umbralCritico: 45,
    mensajeAviso: (nombre) =>
      `Hola ${nombre} 👋, del consultorio de la Dra. Laura.\n\n` +
      `Ya toca tu revisión. ¿Has notado algo distinto en dientes o encías?\n\n` +
      `¿Agendamos tu control?`,
    mensajeRetraso: (nombre, dias) =>
      `Hola ${nombre} 👋, del consultorio de la Dra. Laura.\n\n` +
      `Han pasado ${dias} días desde tu última revisión. Los controles periódicos evitan ` +
      `tratamientos más grandes y más caros.\n\n` +
      `¿Cuándo te agendamos?`,
  },
};

const normalizarTipo = (tipo: string): string =>
  tipo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

/** Devuelve el protocolo del tratamiento o el genérico si no hay uno específico. */
export function obtenerProtocolo(tipo: string | null | undefined): Protocolo {
  if (!tipo) return PROTOCOLOS.CONTROL;
  const clave = normalizarTipo(tipo);
  return PROTOCOLOS[clave] ?? PROTOCOLOS.CONTROL;
}

export function listarProtocolos(): Protocolo[] {
  return Object.values(PROTOCOLOS);
}

export { PROTOCOLOS };
