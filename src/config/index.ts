/**
 * Configuración tipada de la aplicación.
 * Se valida una sola vez al importar; si falta algo obligatorio, falla al
 * arrancar en lugar de fallar a mitad de una conversación con un paciente.
 */
import "dotenv/config";
import { z } from "zod";

/** Convierte "" en undefined para que las variables opcionales no rompan el parseo. */
const opcional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  TIMEZONE: z.string().default("America/Mexico_City"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),

  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1).default("consultorio-laura"),
  EVOLUTION_WEBHOOK_SECRET: opcional(z.string().min(1)),
  /**
   * Lada de país que se antepone al enviar. La base guarda los últimos 10
   * dígitos; Evolution exige el número completo (ej. 52 para México).
   */
  WHATSAPP_PAIS: z
    .string()
    .regex(/^\d{1,3}$/, "WHATSAPP_PAIS debe ser sólo dígitos (ej. 52)")
    .default("52"),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: opcional(z.string().min(1)),
  CALENDAR_IDS: z
    .string()
    .default("primary")
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    ),

  LLM_PROVIDER: z.enum(["openai", "ollama"]).default("openai"),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_API_KEY: opcional(z.string().min(1)),

  ADMIN_WEBHOOK: opcional(z.string().url()),
  ADMIN_EMAIL: opcional(z.string().email()),

  // Panel de la asistente. Sin contraseña, sólo se permite desde localhost.
  PANEL_USER: z.string().default("asistente"),
  PANEL_PASSWORD: opcional(z.string().min(8)),

  SMTP_HOST: opcional(z.string().min(1)),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: opcional(z.string().min(1)),
  SMTP_PASS: opcional(z.string().min(1)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const detalle = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Configuración inválida. Revisa tu archivo .env:\n${detalle}\n\nGuía: .env.example`
  );
}

const env = parsed.data;

export const config = {
  ...env,
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  /** El NLU sólo llama al LLM si hay credenciales; si no, usa reglas. */
  llmHabilitado: Boolean(env.LLM_API_KEY),
  googleHabilitado: Boolean(env.GOOGLE_REFRESH_TOKEN),
  alertasHabilitadas: Boolean(env.ADMIN_WEBHOOK || env.ADMIN_EMAIL),
  smtpHabilitado: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
  panelProtegido: Boolean(env.PANEL_PASSWORD),
} as const;

export type AppConfig = typeof config;
