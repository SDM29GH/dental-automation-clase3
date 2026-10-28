/**
 * Utilidades de fecha/hora con zona horaria explícita.
 *
 * El servidor puede correr en cualquier zona (UTC en producción, por ejemplo),
 * pero el consultorio razona siempre en su zona local. Todo lo que se muestra
 * al paciente o se envía a Google Calendar pasa por aquí.
 */
import { config } from "../config/index.js";

/** Offset (en minutos) de una zona IANA respecto a UTC en un instante dado. */
export function offsetMinutos(zona: string, fecha: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(fecha);

  const valor = (tipo: string): number => {
    const parte = partes.find((p) => p.type === tipo);
    if (!parte) throw new Error(`No se pudo leer "${tipo}" de la fecha en zona ${zona}`);
    return Number(parte.value);
  };

  const comoUtc = Date.UTC(
    valor("year"),
    valor("month") - 1,
    valor("day"),
    valor("hour") % 24,
    valor("minute"),
    valor("second")
  );

  return (comoUtc - fecha.getTime()) / 60_000;
}

/**
 * Convierte una fecha/hora "de pared" del consultorio (ej. 2026-11-05 10:00 en
 * America/Mexico_City) al instante UTC correspondiente.
 */
export function aUtcDesdeZona(
  anio: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  zona: string = config.TIMEZONE
): Date {
  const naive = Date.UTC(anio, mes - 1, dia, hora, minuto, 0, 0);
  const primeraAproximacion = new Date(naive - offsetMinutos(zona, new Date(naive)) * 60_000);
  // Segunda pasada: cubre los cambios de horario de verano.
  const offsetFinal = offsetMinutos(zona, primeraAproximacion);
  return new Date(naive - offsetFinal * 60_000);
}

/** Partes (año, mes, día, hora, minuto) de un instante en la zona del consultorio. */
export function partesEnZona(
  fecha: Date,
  zona: string = config.TIMEZONE
): { anio: number; mes: number; dia: number; hora: number; minuto: number; diaSemana: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(fecha);

  const valor = (tipo: string): number => {
    const parte = partes.find((p) => p.type === tipo);
    return parte ? Number(parte.value) : 0;
  };

  const anio = valor("year");
  const mes = valor("month");
  const dia = valor("day");
  // 0 = domingo … 6 = sábado, calculado sobre el día del calendario local.
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();

  return { anio, mes, dia, hora: valor("hour") % 24, minuto: valor("minute"), diaSemana };
}

/** "Hoy" en la zona del consultorio, normalizado al mediodía para operar con días. */
export function hoyEnZona(zona: string = config.TIMEZONE, ahora: Date = new Date()): Date {
  const { anio, mes, dia } = partesEnZona(ahora, zona);
  return new Date(anio, mes - 1, dia, 12, 0, 0, 0);
}

export type PresetFormato = "fecha" | "hora" | "fechaHora" | "diaHora" | "corta" | "iso";

const PRESETS: Record<Exclude<PresetFormato, "iso">, Intl.DateTimeFormatOptions> = {
  fecha: { weekday: "long", day: "numeric", month: "long" },
  hora: { hour: "2-digit", minute: "2-digit", hour12: false },
  fechaHora: {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  },
  diaHora: { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false },
  corta: { day: "2-digit", month: "2-digit", year: "numeric" },
};

/** Formatea un instante en la zona del consultorio, en español. */
export function formatear(
  fecha: Date,
  preset: PresetFormato = "fechaHora",
  zona: string = config.TIMEZONE
): string {
  if (preset === "iso") {
    const { anio, mes, dia, hora, minuto } = partesEnZona(fecha, zona);
    const dos = (n: number) => String(n).padStart(2, "0");
    return `${anio}-${dos(mes)}-${dos(dia)} ${dos(hora)}:${dos(minuto)}`;
  }

  const texto = new Intl.DateTimeFormat("es-MX", {
    ...PRESETS[preset],
    timeZone: zona,
  }).format(fecha);

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Diferencia en días de calendario (ignora horas) entre dos instantes. */
export function diasDeCalendario(desde: Date, hasta: Date, zona: string = config.TIMEZONE): number {
  const a = partesEnZona(desde, zona);
  const b = partesEnZona(hasta, zona);
  const utcA = Date.UTC(a.anio, a.mes - 1, a.dia);
  const utcB = Date.UTC(b.anio, b.mes - 1, b.dia);
  return Math.round((utcB - utcA) / 86_400_000);
}

/** Suma días a una fecha "de pared" (sin tocar la hora). */
export function sumarDias(fecha: Date, dias: number): Date {
  const resultado = new Date(fecha);
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}
