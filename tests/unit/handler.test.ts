import { describe, expect, it } from "vitest";
import {
  parsearMensajeEntrante,
  procesarEntrante,
  resolverNuevaFecha,
  type MensajeEntrante,
} from "../../src/handlers/whatsapp.handler.js";
import type { NluResult } from "../../src/services/nlu.js";
import { crearCita, crearDependencias, payloadEvolution, TELEFONO } from "../helpers/fakes.js";
import { diasDeCalendario, partesEnZona } from "../../src/utils/time.js";

const ZONA = "America/Mexico_City";

function entrante(texto: string, extra: Partial<MensajeEntrante> = {}): MensajeEntrante {
  return {
    telefono: TELEFONO,
    texto,
    proveedorId: `wamid-${Math.random().toString(36).slice(2)}`,
    esBoton: false,
    botonId: null,
    desdeNosotros: false,
    esGrupo: false,
    timestamp: new Date(),
    ...extra,
  };
}

describe("parsearMensajeEntrante", () => {
  it("lee el sobre de Evolution API", () => {
    const mensaje = parsearMensajeEntrante(payloadEvolution("hola"));
    expect(mensaje).toMatchObject({
      telefono: TELEFONO,
      texto: "hola",
      esBoton: false,
      desdeNosotros: false,
      esGrupo: false,
    });
  });

  it("lee también el payload plano", () => {
    const mensaje = parsearMensajeEntrante({
      key: { id: "abc", remoteJid: `${TELEFONO}@s.whatsapp.net` },
      message: { conversation: "confirmo" },
      fromMe: false,
    });
    expect(mensaje?.texto).toBe("confirmo");
    expect(mensaje?.proveedorId).toBe("abc");
  });

  it("detecta respuestas de botón", () => {
    const mensaje = parsearMensajeEntrante(
      payloadEvolution("Necesito cambiarla", { botonId: "reprogramar_cita" })
    );
    expect(mensaje?.esBoton).toBe(true);
    expect(mensaje?.botonId).toBe("reprogramar_cita");
  });

  it("detecta mensajes de grupo y propios", () => {
    expect(parsearMensajeEntrante(payloadEvolution("hola", { grupo: true }))?.esGrupo).toBe(true);
    expect(parsearMensajeEntrante(payloadEvolution("hola", { fromMe: true }))?.desdeNosotros).toBe(true);
  });

  it("devuelve null si no hay texto", () => {
    expect(parsearMensajeEntrante({ key: { remoteJid: "x" }, message: {} })).toBeNull();
    expect(parsearMensajeEntrante({})).toBeNull();
    expect(parsearMensajeEntrante(null)).toBeNull();
  });
});

describe("procesarEntrante", () => {
  it("confirma la cita y responde al paciente", async () => {
    const { deps, registro, citas } = crearDependencias();

    const resultado = await procesarEntrante(entrante("sí, ahí estaré"), deps);

    expect(resultado.accion).toBe("CONFIRMADA");
    expect(citas[0].estado).toBe("CONFIRMADA");
    expect(registro.mensajes.some((m) => m.direccion === "OUT")).toBe(true);
    expect(resultado.respuesta).toContain("confirmada");
  });

  it("confirma con el botón de WhatsApp sin escribir", async () => {
    const { deps, registro, citas } = crearDependencias();

    const resultado = await procesarEntrante(
      entrante("Sí, asistiré", { esBoton: true, botonId: "confirmar_cita" }),
      deps
    );

    expect(resultado.accion).toBe("CONFIRMADA");
    expect(resultado.intento).toBe("CONFIRMAR");
    expect(citas[0].estado).toBe("CONFIRMADA");
    expect(
      registro.mensajes.some((m) => m.direccion === "OUT" && m.tipo === "confirmacion")
    ).toBe(true);
  });

  it("reprograma con el botón y mueve el mismo evento", async () => {
    const { deps, registro, citas } = crearDependencias();
    const fechaOriginal = citas[0].fecha;

    const resultado = await procesarEntrante(
      entrante("Necesito cambiarla", { esBoton: true, botonId: "reprogramar_cita" }),
      deps
    );

    expect(resultado.accion).toBe("REPROGRAMADA");
    expect(citas[0].estado).toBe("REAGENDADA");
    expect(citas[0].fecha.getTime()).toBeGreaterThan(fechaOriginal.getTime());
    expect(registro.eventos).toHaveLength(1);
    expect(registro.eventos[0].tipo).toBe("mover");
    expect(registro.recordatorios).toHaveLength(1);
  });

  it("reprograma con lenguaje natural, mueve el evento y recalcula recordatorios", async () => {
    const { deps, registro, citas } = crearDependencias();
    const fechaOriginal = citas[0].fecha;

    const resultado = await procesarEntrante(
      entrante("no puedo ir, cámbiamelo para el jueves"),
      deps
    );

    expect(resultado.accion).toBe("REPROGRAMADA");
    expect(citas[0].estado).toBe("REAGENDADA");
    expect(citas[0].fecha.getTime()).not.toBe(fechaOriginal.getTime());
    expect(citas[0].fecha.getTime()).toBeGreaterThan(Date.now());

    expect(registro.eventos).toHaveLength(1);
    expect(registro.eventos[0].tipo).toBe("mover");
    expect(registro.recordatorios).toHaveLength(1);
    expect(registro.recordatorios[0].citaId).toBe(citas[0].id);
  });

  it("cancela la cita y el evento de calendario", async () => {
    const { deps, registro, citas } = crearDependencias();

    const resultado = await procesarEntrante(entrante("cancelo mi cita, no voy a poder"), deps);

    expect(resultado.accion).toBe("CANCELADA");
    expect(citas[0].estado).toBe("CANCELADA_POR_PACIENTE");
    expect(registro.eventos[0]).toMatchObject({ tipo: "cancelar" });
  });

  it("responde dudas frecuentes y avisa a la asistente", async () => {
    const { deps, registro } = crearDependencias();

    const resultado = await procesarEntrante(entrante("¿llevan tarjeta?"), deps);

    expect(resultado.accion).toBe("RESPONDIDA");
    expect(resultado.respuesta).toContain("tarjeta");
    // La duda se escala como "respuesta de paciente", no como "no clasificada".
    expect(registro.alertas).toEqual(["respuesta:DUDA"]);
  });

  it("escala a la asistente lo que no entiende", async () => {
    const { deps, registro } = crearDependencias();

    const resultado = await procesarEntrante(entrante("zxcvbnm"), deps);

    expect(resultado.accion).toBe("ESCALADA");
    expect(registro.alertas.some((a) => a.startsWith("sin-clasificar"))).toBe(true);
  });

  it("pide el nombre si el teléfono no tiene cita", async () => {
    const { deps } = crearDependencias([]);

    const resultado = await procesarEntrante(entrante("sí, confirmo"), deps);

    expect(resultado.accion).toBe("ESCALADA");
    expect(resultado.respuesta).toContain("nombre");
  });

  it("ignora mensajes propios", async () => {
    const { deps, registro } = crearDependencias();

    const resultado = await procesarEntrante(entrante("hola", { desdeNosotros: true }), deps);

    expect(resultado.accion).toBe("IGNORADA");
    expect(registro.mensajes).toHaveLength(0);
  });

  it("no procesa dos veces el mismo mensaje de WhatsApp", async () => {
    const { deps } = crearDependencias();
    const mensaje = entrante("sí, confirmo", { proveedorId: "wamid-repetido" });

    expect((await procesarEntrante(mensaje, deps)).accion).toBe("CONFIRMADA");
    expect((await procesarEntrante(mensaje, deps)).accion).toBe("DUPLICADA");
  });

  it("responde igual aunque WhatsApp falle al enviar", async () => {
    const { deps, registro } = crearDependencias();
    deps.whatsapp.enviarTexto = async () => {
      throw new Error("Evolution caída");
    };

    const resultado = await procesarEntrante(entrante("sí, confirmo"), deps);

    expect(resultado.accion).toBe("CONFIRMADA");
    expect(registro.mensajes.some((m) => m.direccion === "OUT" && m.estado === "FALLIDO")).toBe(true);
  });
});

describe("resolverNuevaFecha", () => {
  const nlu = (parcial: Partial<NluResult> = {}): NluResult => ({
    intento: "REPROGRAMAR",
    nuevaFecha: null,
    nuevaHora: null,
    zona: ZONA,
    mensajeUsuario: "",
    nota: "",
    confianza: 1,
    fuente: "regla",
    ...parcial,
  });

  it("sin fecha explícita propone 3 días después a la misma hora", () => {
    const cita = crearCita({ fecha: new Date(Date.now() + 26 * 3_600_000) });
    const resultante = resolverNuevaFecha(cita, nlu());

    // 3 días después, o 4 si el tercer día cae domingo (consultorio cerrado).
    const diferencia = diasDeCalendario(cita.fecha, resultante, ZONA);
    expect(diferencia).toBeGreaterThanOrEqual(3);
    expect(diferencia).toBeLessThanOrEqual(4);
    expect(partesEnZona(resultante, ZONA).diaSemana).not.toBe(0);
    expect(resultante.getTime()).toBeGreaterThan(Date.now());
  });

  it("nunca propone un domingo (consultorio cerrado)", () => {
    const cita = crearCita({ fecha: new Date(Date.now() + 26 * 3_600_000) });
    const proximoDomingo = (() => {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() + ((7 - fecha.getDay()) % 7 || 7));
      return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
    })();

    const resultante = resolverNuevaFecha(cita, nlu({ nuevaFecha: proximoDomingo }));
    expect(partesEnZona(resultante, ZONA).diaSemana).not.toBe(0);
  });

  it("no acepta una fecha en el pasado", () => {
    const cita = crearCita({ fecha: new Date(Date.now() + 26 * 3_600_000) });
    const resultante = resolverNuevaFecha(cita, nlu({ nuevaFecha: "2020-01-10" }));
    expect(resultante.getTime()).toBeGreaterThan(Date.now());
  });

  it("respeta la hora pedida por el paciente", () => {
    const cita = crearCita({ fecha: new Date(Date.now() + 26 * 3_600_000) });
    const resultante = resolverNuevaFecha(cita, nlu({ nuevaHora: "16:30" }));
    expect(partesEnZona(resultante, ZONA).hora).toBe(16);
    expect(partesEnZona(resultante, ZONA).minuto).toBe(30);
  });
});
