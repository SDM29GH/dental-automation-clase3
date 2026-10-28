import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { crearApp } from "../../src/app.js";
import { config } from "../../src/config/index.js";
import {
  PanelError,
  type CitaVista,
  type PanelService,
  type PendientesVista,
  type ResumenVista,
} from "../../src/services/panel.js";

const cita: CitaVista = {
  id: "cita-1",
  fecha: "2026-11-05T16:00:00.000Z",
  hora: "10:00",
  fechaTexto: "Jueves, 5 de noviembre, 10:00",
  titulo: "endodoncia",
  tipo: "ENDODONCIA",
  estado: "AGENDADA",
  paciente: {
    id: "pac-1",
    nombre: "Ana Ruiz",
    telefono: "5512345678",
    consentWhatsapp: true,
  },
  recordatorio: { disparador: "D_MINUS_24H", estado: "PENDIENTE" },
  puedeRecordar: true,
};

const resumen: ResumenVista = {
  zona: "America/Mexico_City",
  ahora: "2026-11-04T18:00:00.000Z",
  hoy: { total: 4, confirmadas: 2, porConfirmar: 1 },
  manana: { total: 3 },
  enRiesgo: 2,
  sinResponder: 1,
};

function panelFalso() {
  const panel: PanelService = {
    resumen: vi.fn(async () => resumen),
    citas: vi.fn(async () => [cita]),
    pendientes: vi.fn(async (): Promise<PendientesVista> => ({
      citas: [cita],
      tratamientos: [],
      conversaciones: [],
    })),
    tratamientos: vi.fn(async () => []),
    pacientes: vi.fn(async () => []),
    conversaciones: vi.fn(async () => []),
    hilo: vi.fn(async () => ({ paciente: "Ana Ruiz", mensajes: [] })),
    cambiarEstado: vi.fn(async () => undefined),
    enviarRecordatorio: vi.fn(async () => ({ disparador: "D_MINUS_24H" as const })),
    reprogramar: vi.fn(async () => ({
      fecha: "2026-11-06T16:00:00.000Z",
      avisoPaciente: true,
    })),
    enviarSeguimiento: vi.fn(async () => ({ dias: 9, severidad: "retraso" as const })),
    responder: vi.fn(async () => undefined),
    cambiarConsentimiento: vi.fn(async () => undefined),
    actualizarTelefono: vi.fn(async () => undefined),
  };

  return { panel, app: crearApp({ panel, healthDetallado: false }) };
}

afterEach(() => {
  Object.assign(config, { PANEL_PASSWORD: undefined, PANEL_USER: "asistente" });
});

describe("API del panel", () => {
  it("GET /api/panel/resumen devuelve el resumen del día", async () => {
    const { app } = panelFalso();

    const res = await request(app).get("/api/panel/resumen").expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.datos.hoy).toEqual({ total: 4, confirmadas: 2, porConfirmar: 1 });
    expect(res.body.datos.enRiesgo).toBe(2);
  });

  it("GET /api/panel/citas normaliza el rango pedido", async () => {
    const { app, panel } = panelFalso();

    await request(app).get("/api/panel/citas?rango=semana").expect(200);
    await request(app).get("/api/panel/citas?rango=inventado").expect(200);

    expect(panel.citas).toHaveBeenNthCalledWith(1, "semana");
    expect(panel.citas).toHaveBeenNthCalledWith(2, "hoy");
  });

  it("POST /api/panel/citas/:id/estado delega en el servicio", async () => {
    const { app, panel } = panelFalso();

    await request(app)
      .post("/api/panel/citas/cita-1/estado")
      .send({ estado: "CONFIRMADA" })
      .expect(200);

    expect(panel.cambiarEstado).toHaveBeenCalledWith("cita-1", "CONFIRMADA");
  });

  it("rechaza un estado que no existe con 400", async () => {
    const { app, panel } = panelFalso();

    const res = await request(app)
      .post("/api/panel/citas/cita-1/estado")
      .send({ estado: "PENDIENTE" })
      .expect(400);

    expect(res.body.ok).toBe(false);
    expect(panel.cambiarEstado).not.toHaveBeenCalled();
  });

  it("traduce los errores de negocio a 4xx con su mensaje", async () => {
    const { app, panel } = panelFalso();
    vi.mocked(panel.enviarRecordatorio).mockRejectedValueOnce(
      new PanelError("El paciente no ha autorizado mensajes de WhatsApp")
    );

    const res = await request(app)
      .post("/api/panel/citas/cita-1/recordatorio")
      .expect(400);

    expect(res.body.error).toMatch(/no ha autorizado/);
  });

  it("programa una cita movida y reporta si se avisó al paciente", async () => {
    const { app, panel } = panelFalso();

    const res = await request(app)
      .post("/api/panel/citas/cita-1/reprogramar")
      .send({ fecha: "2026-11-06", hora: "11:30" })
      .expect(200);

    expect(panel.reprogramar).toHaveBeenCalledWith("cita-1", "2026-11-06", "11:30");
    expect(res.body.datos.avisoPaciente).toBe(true);
  });

  it("valida el formato de fecha antes de tocar la agenda", async () => {
    const { app, panel } = panelFalso();

    await request(app)
      .post("/api/panel/citas/cita-1/reprogramar")
      .send({ fecha: "06/11/2026", hora: "11:30" })
      .expect(400);

    expect(panel.reprogramar).not.toHaveBeenCalled();
  });

  it("envía una respuesta manual a la conversación", async () => {
    const { app, panel } = panelFalso();

    await request(app)
      .post("/api/panel/conversaciones/5512345678/mensaje")
      .send({ texto: "  Claro, te esperamos mañana.  " })
      .expect(200);

    expect(panel.responder).toHaveBeenCalledWith("5512345678", "Claro, te esperamos mañana.");
  });

  it("no permite enviar mensajes vacíos", async () => {
    const { app, panel } = panelFalso();

    await request(app)
      .post("/api/panel/conversaciones/5512345678/mensaje")
      .send({ texto: "   " })
      .expect(400);

    expect(panel.responder).not.toHaveBeenCalled();
  });

  it("guarda o borra el teléfono de un paciente", async () => {
    const { app, panel } = panelFalso();

    await request(app)
      .post("/api/panel/pacientes/pac-1/telefono")
      .send({ telefono: "+52 1 55 1234 5678" })
      .expect(200);
    await request(app)
      .post("/api/panel/pacientes/pac-1/telefono")
      .send({ telefono: null })
      .expect(200);

    expect(panel.actualizarTelefono).toHaveBeenNthCalledWith(1, "pac-1", "+52 1 55 1234 5678");
    expect(panel.actualizarTelefono).toHaveBeenNthCalledWith(2, "pac-1", null);
  });
});

describe("seguridad del panel", () => {
  it("exige credenciales cuando PANEL_PASSWORD está configurada", async () => {
    Object.assign(config, { PANEL_PASSWORD: "clave-segura-123", PANEL_USER: "asistente" });
    const { app } = panelFalso();

    await request(app).get("/api/panel/resumen").expect(401);
    await request(app)
      .get("/api/panel/resumen")
      .auth("asistente", "otra-clave")
      .expect(401);

    await request(app)
      .get("/api/panel/resumen")
      .auth("asistente", "clave-segura-123")
      .expect(200);
  });

  it("sirve el HTML del panel", async () => {
    const { app } = panelFalso();

    const res = await request(app).get("/panel/").expect(200);
    expect(res.text).toContain("Consultorio Dra. Laura");
  });

  it("mantiene público el webhook y el health check", async () => {
    Object.assign(config, { PANEL_PASSWORD: "clave-segura-123" });
    const { app } = panelFalso();

    await request(app).get("/health").expect(200);
  });
});
