/**
 * Avisos internos para la asistente (Slack/Teams + correo).
 *
 * No es un chat de soporte: es el mínimo para que nada se caiga en silencio.
 * Si no hay webhook ni correo configurado, los avisos se escriben en el log y
 * el sistema sigue funcionando.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config/index.js";
import type { CitaConPaciente } from "../repositories/citas.repository.js";
import { formatear } from "../utils/time.js";
import type { NluResult } from "./nlu.js";

export type Prioridad = "normal" | "alta";

export interface Aviso {
  titulo: string;
  cuerpo: string;
  prioridad: Prioridad;
}

let transporter: Transporter | null = null;

function correo(): Transporter | null {
  if (!config.smtpHabilitado) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    });
  }
  return transporter;
}

const EMOJI: Record<Prioridad, string> = { normal: "ℹ️", alta: "⚠️" };

export class AlertService {
  /** Envía por todos los canales configurados; nunca lanza. */
  static async enviar(aviso: Aviso): Promise<void> {
    const etiqueta = `${EMOJI[aviso.prioridad]} [${aviso.prioridad.toUpperCase()}] ${aviso.titulo}`;

    if (!config.alertasHabilitadas) {
      console.log(`[alerta] ${etiqueta} — ${aviso.cuerpo}`);
      return;
    }

    if (config.ADMIN_WEBHOOK) {
      try {
        await fetch(config.ADMIN_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `*${etiqueta}*\n${aviso.cuerpo}`,
          }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch (error) {
        console.error("[alerta] Falló el webhook:", (error as Error).message);
      }
    }

    const transporte = correo();
    if (transporte && config.ADMIN_EMAIL) {
      try {
        await transporte.sendMail({
          from: `"DentalCare" <${config.SMTP_USER}>`,
          to: config.ADMIN_EMAIL,
          subject: etiqueta,
          text: aviso.cuerpo,
        });
      } catch (error) {
        console.error("[alerta] Falló el correo:", (error as Error).message);
      }
    }
  }

  static async respuestaPaciente(resultado: NluResult, cita: CitaConPaciente | null): Promise<void> {
    const urgente = resultado.intento === "REPROGRAMAR" || resultado.intento === "CANCELAR";
    const contexto = cita
      ? `${cita.paciente.nombre} · ${formatear(cita.fecha, "fechaHora")} · ${cita.titulo}`
      : `Sin cita asociada · ${resultado.mensajeUsuario.slice(0, 60)}`;

    await this.enviar({
      titulo: `Respuesta de paciente: ${resultado.intento}`,
      cuerpo: `${contexto}\nMensaje: "${resultado.mensajeUsuario}"\nConfianza: ${Math.round(resultado.confianza * 100)}% (${resultado.fuente})`,
      prioridad: urgente ? "alta" : "normal",
    });
  }

  static async respuestaNoClara(telefono: string, mensaje: string): Promise<void> {
    await this.enviar({
      titulo: "Mensaje de paciente sin interpretar",
      cuerpo: `El mensaje no se pudo clasificar y quedó sin responder automáticamente.\nTeléfono: ${telefono}\nMensaje: "${mensaje}"`,
      prioridad: "alta",
    });
  }

  static async citaSinConfirmar(cita: CitaConPaciente): Promise<void> {
    await this.enviar({
      titulo: "Cita sin confirmar a 24 h",
      cuerpo: `${cita.paciente.nombre} (${cita.paciente.telefono ?? "sin teléfono"}) no ha confirmado su cita del ${formatear(cita.fecha, "fechaHora")}.\nConviene llamarle para liberar o asegurar el espacio.`,
      prioridad: "alta",
    });
  }

  static async seguimiento(
    paciente: { nombre: string; telefono: string | null },
    tratamiento: string,
    dias: number,
    critico: boolean
  ): Promise<void> {
    await this.enviar({
      titulo: critico ? "Riesgo de abandono de tratamiento" : "Seguimiento pendiente",
      cuerpo: `${paciente.nombre} lleva ${dias} días sin sesión de ${tratamiento}.\nTeléfono: ${paciente.telefono ?? "sin teléfono"}${critico ? "\nYa se le escribió sin respuesta: requiere llamada." : ""}`,
      prioridad: critico ? "alta" : "normal",
    });
  }

  static async resumenDelDia(citas: CitaConPaciente[]): Promise<void> {
    if (citas.length === 0) return;
    const lineas = citas
      .map(
        (cita) =>
          `• ${formatear(cita.fecha, "hora")} — ${cita.paciente.nombre} (${cita.estado}) · ${cita.titulo}`
      )
      .join("\n");

    await this.enviar({
      titulo: `${citas.length} cita(s) para hoy`,
      cuerpo: lineas,
      prioridad: "normal",
    });
  }
}
