/**
 * Servidor HTTP. Expone el webhook de WhatsApp, el panel de la asistente y un
 * health check que dice la verdad (base de datos y WhatsApp), útil para saber
 * si el silencio de un día es normal o es que algo se cayó.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { resolve } from "node:path";
import { config } from "./config/index.js";
import prisma from "./utils/prisma.js";
import { crearHandlerWhatsapp, type DependenciasHandler, manejarWebhookWhatsapp } from "./handlers/whatsapp.handler.js";
import { whatsappService } from "./services/whatsapp.js";
import { panelService, type PanelService } from "./services/panel.js";
import { autenticarPanel, crearRouterPanel } from "./routes/panel.routes.js";
import { formatear } from "./utils/time.js";

export interface OpcionesApp {
  /** Permite inyectar dobles en pruebas sin tocar la base. */
  deps?: DependenciasHandler;
  /** Desactiva comprobaciones externas en /health (tests). */
  healthDetallado?: boolean;
  /** Permite inyectar un panel falso en pruebas. */
  panel?: PanelService;
}

export function crearApp(opciones: OpcionesApp = {}) {
  const app = express();
  const healthDetallado = opciones.healthDetallado ?? true;
  const handler = opciones.deps
    ? crearHandlerWhatsapp(opciones.deps)
    : { manejarWebhook: manejarWebhookWhatsapp };

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      servicio: "DentalCare Retention Engine",
      version: "1.0.0",
      hora: formatear(new Date(), "fechaHora"),
      endpoints: ["POST /webhook/whatsapp", "GET /health", "GET /panel", "/api/panel/*"],
    });
  });

  app.get("/health", async (_req: Request, res: Response) => {
    const salud = {
      ok: true,
      servicio: "dental-care-retention-engine",
      hora: new Date().toISOString(),
      baseDeDatos: "desconocido" as string,
      whatsapp: "desconocido" as string,
      googleCalendar: config.googleHabilitado ? "configurado" : "sin configurar",
      llm: config.llmHabilitado ? config.LLM_MODEL : "solo reglas",
      panel: config.panelProtegido ? "protegido" : "sólo localhost",
    };

    if (healthDetallado) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        salud.baseDeDatos = "ok";
      } catch (error) {
        salud.baseDeDatos = `error: ${(error as Error).message}`;
        salud.ok = false;
      }

      const conexion = await whatsappService.estadoConexion();
      salud.whatsapp = conexion.estado;
      if (!conexion.conectado && !config.isTest) salud.ok = false;
    }

    res.status(salud.ok ? 200 : 503).json(salud);
  });

  app.post("/webhook/whatsapp", handler.manejarWebhook);

  // Panel de la asistente: HTML estático + API JSON, ambos detrás de la misma
  // autenticación para que el navegador pida las credenciales una sola vez.
  const publico = resolve(process.cwd(), "public");
  app.use("/panel", autenticarPanel, express.static(publico, { index: "index.html" }));
  app.use("/api/panel", autenticarPanel, crearRouterPanel(opciones.panel ?? panelService));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: "Ruta no encontrada" });
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    // Los cuerpos inválidos se responden como 400 y no como fallo del servidor.
    if (error.name === "ZodError") {
      res.status(400).json({ ok: false, error: "Datos inválidos en la petición" });
      return;
    }
    if (error.name === "PanelError") {
      res.status((error as { estadoHttp?: number }).estadoHttp ?? 400).json({
        ok: false,
        error: error.message,
      });
      return;
    }
    console.error("[app] Error no controlado:", error.message);
    res.status(500).json({ ok: false, error: "Error interno" });
  });

  return app;
}

export const app = crearApp();
export default app;
