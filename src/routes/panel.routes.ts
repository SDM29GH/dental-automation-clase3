/**
 * API del panel de la asistente.
 *
 * Protegida con HTTP Basic. Si no hay `PANEL_PASSWORD`, sólo responde a
 * peticiones locales: así `npm run dev` funciona sin configurar nada, pero el
 * panel nunca queda abierto a internet por accidente.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config/index.js";
import { PanelError, panelService, type PanelService } from "../services/panel.js";

const cuerpoEstado = z.object({
  estado: z.enum([
    "AGENDADA",
    "CONFIRMADA",
    "NO_SHOW",
    "CANCELADA_POR_PACIENTE",
    "CANCELADA_POR_CLINICA",
    "COMPLETADA",
    "REAGENDADA",
  ]),
});

const cuerpoReprogramar = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  hora: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida (HH:mm)"),
});

const cuerpoConsentimiento = z.object({
  consentWhatsapp: z.boolean(),
});

const cuerpoTelefono = z.object({
  telefono: z
    .string()
    .trim()
    .max(30, "Teléfono demasiado largo")
    .nullable(),
});

const cuerpoMensaje = z.object({
  texto: z.string().trim().min(1, "Escribe un mensaje").max(1000, "Máximo 1000 caracteres"),
});

function iguales(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function esPeticionLocal(req: Request): boolean {
  const direccion = req.socket.remoteAddress ?? "";
  return (
    direccion === "127.0.0.1" ||
    direccion === "::1" ||
    direccion === "::ffff:127.0.0.1"
  );
}

function autenticar(req: Request, res: Response, next: NextFunction): void {
  if (!config.PANEL_PASSWORD) {
    if (esPeticionLocal(req)) {
      next();
      return;
    }
    res.status(401).json({
      ok: false,
      error: "El panel no tiene contraseña configurada. Define PANEL_PASSWORD en .env para abrirlo desde el navegador.",
    });
    return;
  }

  const cabecera = req.header("authorization") ?? "";
  const [esquema, credenciales] = cabecera.split(" ");
  if (esquema?.toLowerCase() !== "basic" || !credenciales) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Panel del consultorio"');
    res.status(401).json({ ok: false, error: "Autenticación requerida" });
    return;
  }

  const [usuario, contrasena] = Buffer.from(credenciales, "base64").toString("utf8").split(":");
  const usuarioOk = iguales(usuario ?? "", config.PANEL_USER);
  const contrasenaOk = iguales(contrasena ?? "", config.PANEL_PASSWORD);

  if (!usuarioOk || !contrasenaOk) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Panel del consultorio"');
    res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    return;
  }

  next();
}

/** Envuelve handlers async para que los errores lleguen al manejador de Express. */
function manejar(
  accion: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    accion(req, res).catch(next);
  };
}

export function crearRouterPanel(servicio: PanelService = panelService): Router {
  const router = Router();

  router.get(
    "/resumen",
    manejar(async (_req, res) => {
      res.json({ ok: true, datos: await servicio.resumen() });
    })
  );

  router.get(
    "/citas",
    manejar(async (req, res) => {
      const rango = req.query.rango === "manana" || req.query.rango === "semana" ? req.query.rango : "hoy";
      res.json({ ok: true, datos: await servicio.citas(rango) });
    })
  );

  router.get(
    "/pendientes",
    manejar(async (_req, res) => {
      res.json({ ok: true, datos: await servicio.pendientes() });
    })
  );

  router.get(
    "/tratamientos",
    manejar(async (_req, res) => {
      res.json({ ok: true, datos: await servicio.tratamientos() });
    })
  );

  router.get(
    "/pacientes",
    manejar(async (req, res) => {
      const busqueda = typeof req.query.q === "string" ? req.query.q : undefined;
      res.json({ ok: true, datos: await servicio.pacientes(busqueda) });
    })
  );

  router.get(
    "/conversaciones",
    manejar(async (_req, res) => {
      res.json({ ok: true, datos: await servicio.conversaciones() });
    })
  );

  router.get(
    "/conversaciones/:telefono",
    manejar(async (req, res) => {
      res.json({ ok: true, datos: await servicio.hilo(req.params.telefono) });
    })
  );

  router.post(
    "/conversaciones/:telefono/mensaje",
    manejar(async (req, res) => {
      const datos = cuerpoMensaje.parse(req.body);
      await servicio.responder(req.params.telefono, datos.texto);
      res.json({ ok: true });
    })
  );

  router.post(
    "/citas/:id/estado",
    manejar(async (req, res) => {
      const datos = cuerpoEstado.parse(req.body);
      await servicio.cambiarEstado(req.params.id, datos.estado);
      res.json({ ok: true });
    })
  );

  router.post(
    "/citas/:id/recordatorio",
    manejar(async (req, res) => {
      res.json({ ok: true, datos: await servicio.enviarRecordatorio(req.params.id) });
    })
  );

  router.post(
    "/citas/:id/reprogramar",
    manejar(async (req, res) => {
      const datos = cuerpoReprogramar.parse(req.body);
      res.json({
        ok: true,
        datos: await servicio.reprogramar(req.params.id, datos.fecha, datos.hora),
      });
    })
  );

  router.post(
    "/citas/:id/seguimiento",
    manejar(async (req, res) => {
      res.json({ ok: true, datos: await servicio.enviarSeguimiento(req.params.id) });
    })
  );

  router.post(
    "/pacientes/:id/consentimiento",
    manejar(async (req, res) => {
      const datos = cuerpoConsentimiento.parse(req.body);
      await servicio.cambiarConsentimiento(req.params.id, datos.consentWhatsapp);
      res.json({ ok: true });
    })
  );

  router.post(
    "/pacientes/:id/telefono",
    manejar(async (req, res) => {
      const datos = cuerpoTelefono.parse(req.body);
      await servicio.actualizarTelefono(req.params.id, datos.telefono);
      res.json({ ok: true });
    })
  );

  return router;
}

export { autenticar as autenticarPanel, PanelError };
