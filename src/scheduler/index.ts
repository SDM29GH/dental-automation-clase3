/**
 * Programación de tareas periódicas.
 *
 * Todo corre en el mismo proceso: una clínica pequeña no necesita un cluster
 * ni un orquestador de colas. Cada tarea es idempotente y tolera solapamientos.
 */
import cron, { type ScheduledTask } from "node-cron";
import { config } from "../config/index.js";
import { sincronizarCalendario } from "../services/google-calendar.js";
import {
  alertarCitasSinConfirmar,
  procesarRecordatoriosPendientes,
  reconciliarRecordatorios,
  resumenDelDia,
} from "./recordatorios.service.js";
import { ejecutarSeguimientoDiario } from "./seguimiento.service.js";

const zona = config.TIMEZONE;

let tareas: ScheduledTask[] = [];
const enCurso = new Set<string>();

/** Evita que dos ejecuciones de la misma tarea se pisen. */
async function conBloqueo(nombre: string, tarea: () => Promise<void>): Promise<void> {
  if (enCurso.has(nombre)) {
    console.warn(`[scheduler] "${nombre}" aún en ejecución, se omite este ciclo`);
    return;
  }
  enCurso.add(nombre);
  const inicio = Date.now();
  try {
    await tarea();
  } catch (error) {
    console.error(`[scheduler] "${nombre}" falló:`, (error as Error).message);
  } finally {
    enCurso.delete(nombre);
    const ms = Date.now() - inicio;
    if (ms > 2_000) console.log(`[scheduler] "${nombre}" terminó en ${ms} ms`);
  }
}

export function crearTareas(): ScheduledTask[] {
  const lista: ScheduledTask[] = [];

  // Cada 5 minutos: enviar recordatorios vencidos.
  lista.push(
    cron.schedule(
      "*/5 * * * *",
      () =>
        conBloqueo("recordatorios", async () => {
          const resumen = await procesarRecordatoriosPendientes();
          if (resumen.revisados > 0) {
            console.log(
              `[scheduler] Recordatorios: ${resumen.enviados} enviados, ` +
                `${resumen.omitidos} omitidos, ${resumen.fallidos} fallidos`
            );
          }
        }),
      { timezone: zona }
    )
  );

  // 07:30 — agenda del día para la asistente.
  lista.push(
    cron.schedule("30 7 * * *", () => conBloqueo("resumen-dia", () => resumenDelDia()), {
      timezone: zona,
    })
  );

  // 08:00 — traer cambios hechos a mano en Google Calendar y recalcular recordatorios.
  lista.push(
    cron.schedule(
      "0 8 * * *",
      () =>
        conBloqueo("sincronizacion", async () => {
          if (!config.googleHabilitado) {
            console.warn("[scheduler] Google Calendar sin configurar; se omite la sincronización");
            return;
          }
          const resumen = await sincronizarCalendario();
          const programados = await reconciliarRecordatorios();
          console.log(
            `[scheduler] Calendario: ${resumen.total} eventos (${resumen.creados} nuevas, ` +
              `${resumen.actualizados} actualizadas, ${resumen.omitidos} ignoradas). ` +
              `${programados} recordatorios programados.`
          );
        }),
      { timezone: zona }
    )
  );

  // 09:00 — citas de mañana que no confirmaron.
  lista.push(
    cron.schedule(
      "0 9 * * *",
      () => conBloqueo("sin-confirmar", async () => {
        const avisos = await alertarCitasSinConfirmar();
        if (avisos > 0) console.log(`[scheduler] ${avisos} cita(s) sin confirmar para mañana`);
      }),
      { timezone: zona }
    )
  );

  // 18:00 — seguimiento de tratamientos multisesión.
  lista.push(
    cron.schedule(
      "0 18 * * *",
      () =>
        conBloqueo("seguimiento", async () => {
          const resumen = await ejecutarSeguimientoDiario();
          console.log(
            `[scheduler] Seguimiento: ${resumen.citasRevisadas} revisadas, ` +
              `${resumen.mensajesEnviados} mensajes, ${resumen.alertas} alertas, ` +
              `${resumen.omitidos} omitidas`
          );
        }),
      { timezone: zona }
    )
  );

  return lista;
}

export function iniciarScheduler(): void {
  detenerScheduler();
  tareas = crearTareas();
  console.log(
    `[scheduler] Activo (zona ${zona}): recordatorios cada 5 min, ` +
      `agenda 07:30, sincronización 08:00, sin confirmar 09:00, seguimiento 18:00`
  );
}

export function detenerScheduler(): void {
  for (const tarea of tareas) tarea.stop();
  tareas = [];
}
