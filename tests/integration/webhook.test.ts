import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { crearApp } from "../../src/app.js";
import { config } from "../../src/config/index.js";
import { crearDependencias, payloadEvolution, TELEFONO } from "../helpers/fakes.js";

function appDePrueba() {
  const { deps, registro, citas } = crearDependencias();
  const app = crearApp({ deps, healthDetallado: false });
  return { app, registro, citas };
}

afterEach(() => {
  Object.assign(config, { EVOLUTION_WEBHOOK_SECRET: undefined });
});

describe("POST /webhook/whatsapp", () => {
  it("procesa una confirmación y responde 200 con la acción tomada", async () => {
    const { app, citas } = appDePrueba();

    const res = await request(app)
      .post("/webhook/whatsapp")
      .send(payloadEvolution("sí, ahí estaré"))
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, accion: "CONFIRMADA", intento: "CONFIRMAR" });
    expect(citas[0].estado).toBe("CONFIRMADA");
  });

  it("acepta el payload plano de Evolution", async () => {
    const { app } = appDePrueba();

    const res = await request(app)
      .post("/webhook/whatsapp")
      .send({
        key: { id: "wamid-plano", remoteJid: `${TELEFONO}@s.whatsapp.net` },
        message: { conversation: "cancelo mi cita" },
        fromMe: false,
      })
      .expect(200);

    expect(res.body.accion).toBe("CANCELADA");
  });

  it("devuelve 200 e ignora el mensaje si no hay texto procesable", async () => {
    const { app } = appDePrueba();

    const res = await request(app).post("/webhook/whatsapp").send({}).expect(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.ignorado).toBeDefined();
  });

  it("rechaza peticiones sin el secreto cuando está configurado", async () => {
    Object.assign(config, { EVOLUTION_WEBHOOK_SECRET: "secreto-de-prueba" });
    const { app } = appDePrueba();

    await request(app).post("/webhook/whatsapp").send(payloadEvolution("sí")).expect(401);

    await request(app)
      .post("/webhook/whatsapp")
      .set("x-webhook-secret", "secreto-de-prueba")
      .send(payloadEvolution("sí"))
      .expect(200);
  });

  it("ignora mensajes propios sin tocar la base", async () => {
    const { app, registro } = appDePrueba();

    const res = await request(app)
      .post("/webhook/whatsapp")
      .send(payloadEvolution("hola", { fromMe: true }))
      .expect(200);

    expect(res.body.accion).toBe("IGNORADA");
    expect(registro.mensajes).toHaveLength(0);
  });
});

describe("rutas de servicio", () => {
  it("GET /health responde sin tocar servicios externos", async () => {
    const { app } = appDePrueba();

    const res = await request(app).get("/health").expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      servicio: "dental-care-retention-engine",
      googleCalendar: "sin configurar",
      llm: "solo reglas",
    });
  });

  it("GET / describe el servicio", async () => {
    const { app } = appDePrueba();

    const res = await request(app).get("/").expect(200);
    expect(res.body.endpoints).toContain("POST /webhook/whatsapp");
  });

  it("una ruta desconocida responde 404 en JSON", async () => {
    const { app } = appDePrueba();

    const res = await request(app).get("/no-existe").expect(404);
    expect(res.body.ok).toBe(false);
  });
});
