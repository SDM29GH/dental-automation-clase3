import { describe, expect, it } from "vitest";
import { listarProtocolos, obtenerProtocolo } from "../../src/services/protocolos.js";
import { mensajeSeguimiento, respuestaFrecuente } from "../../src/services/mensajes.js";

describe("protocolos de tratamiento", () => {
  it("reconoce el tipo sin importar acentos ni mayúsculas", () => {
    expect(obtenerProtocolo("endodoncia").tipo).toBe("ENDODONCIA");
    expect(obtenerProtocolo("PRÓTESIS").tipo).toBe("PROTESIS");
    expect(obtenerProtocolo("Ortodoncia").tipo).toBe("ORTODONCIA");
  });

  it("cae en el protocolo genérico si el tipo es desconocido", () => {
    expect(obtenerProtocolo("blanqueamiento-extremo").tipo).toBe("CONTROL");
    expect(obtenerProtocolo(null).tipo).toBe("CONTROL");
  });

  it("mantiene el orden clínico: aviso antes del intervalo y alerta después", () => {
    for (const protocolo of listarProtocolos()) {
      expect(protocolo.diasEntreSesiones).toBeGreaterThan(0);
      expect(protocolo.avisoAnticipado).toBeLessThan(protocolo.diasEntreSesiones);
      expect(protocolo.umbralAlerta).toBeGreaterThan(0);
      expect(protocolo.umbralCritico).toBeGreaterThan(protocolo.umbralAlerta);
    }
  });

  it("endodoncia avisa antes de la semana y escala rápido", () => {
    const protocolo = obtenerProtocolo("ENDODONCIA");
    expect(protocolo.diasEntreSesiones).toBe(7);
    expect(protocolo.umbralCritico).toBeLessThanOrEqual(14);
  });
});

describe("mensajeSeguimiento", () => {
  it("antes del intervalo invita a agendar", () => {
    const texto = mensajeSeguimiento("ORTODONCIA", "Ana Ruiz", 11);
    expect(texto).toContain("Hola Ana");
    expect(texto.toLowerCase()).toContain("ortodoncia");
  });

  it("con retraso explica por qué importa y menciona los días", () => {
    const texto = mensajeSeguimiento("ENDODONCIA", "Ana Ruiz", 21);
    expect(texto).toContain("21 días");
    expect(texto.toLowerCase()).toContain("endodoncia");
  });

  it("no inventa días cuando está dentro del intervalo", () => {
    const texto = mensajeSeguimiento("PROTESIS", "Ana Ruiz", 8);
    expect(texto).not.toContain("Han pasado");
  });
});

describe("respuestaFrecuente", () => {
  it.each([
    ["¿aceptan tarjeta?", "tarjeta de débito"],
    ["¿cuánto cuesta una limpieza?", "presupuesto"],
    ["¿a qué hora abren?", "lunes a sábado"],
    ["¿dónde están ubicados?", "ubicación"],
    ["¿facturan?", "factura"],
  ])("responde %s", (pregunta, fragmento) => {
    expect(respuestaFrecuente(pregunta)).toContain(fragmento);
  });

  it("devuelve null cuando la pregunta necesita a una persona", () => {
    expect(respuestaFrecuente("¿me duele mucho el diente, qué tomo?")).toBeNull();
  });
});
