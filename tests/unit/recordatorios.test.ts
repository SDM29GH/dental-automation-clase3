import { describe, expect, it } from "vitest";
import {
  calcularMomento,
  construirTexto,
  DISPARADORES,
  proximoHorarioPermitido,
} from "../../src/scheduler/recordatorios.service.js";
import { partesEnZona } from "../../src/utils/time.js";

const ZONA = "America/Mexico_City";
const CITA = new Date("2026-11-05T16:00:00.000Z"); // 10:00 en CDMX

describe("calcularMomento", () => {
  it.each([
    ["D_MINUS_3D", 72],
    ["D_MINUS_24H", 24],
    ["D_MINUS_2H", 2],
    ["D_MINUS_0H", 0],
  ] as const)("%s se programa %i horas antes", (disparador, horas) => {
    const momento = calcularMomento(CITA, disparador);
    expect(CITA.getTime() - momento.getTime()).toBe(horas * 3_600_000);
  });

  it("cubre la escalera completa de recordatorios", () => {
    const momentos = DISPARADORES.map((d) => calcularMomento(CITA, d).getTime());
    // De más lejano a más cercano, sin duplicados.
    expect(momentos).toHaveLength(4);
    expect(new Set(momentos).size).toBe(4);
    expect(Math.min(...momentos)).toBe(calcularMomento(CITA, "D_MINUS_3D").getTime());
  });
});

describe("construirTexto", () => {
  it("el recordatorio de 3 días pide confirmación", () => {
    const texto = construirTexto("D_MINUS_3D", "Ana Ruiz", CITA);
    expect(texto).toContain("Ana");
    expect(texto.toUpperCase()).toContain("SÍ");
  });

  it("el de 2 horas menciona el tiempo restante y la hora", () => {
    const texto = construirTexto("D_MINUS_2H", "Ana Ruiz", CITA);
    expect(texto).toContain("2 horas");
    expect(texto).toContain("10:00");
  });

  it("el del día de la cita no repite la fecha completa", () => {
    const texto = construirTexto("D_MINUS_0H", "Ana Ruiz", CITA);
    expect(texto).toContain("hoy");
    expect(texto).toContain("10:00");
  });

  it("saluda por el nombre de pila, no por el nombre completo", () => {
    expect(construirTexto("D_MINUS_24H", "Ana María Ruiz Gómez", CITA)).toContain(
      "Hola Ana"
    );
  });
});

describe("proximoHorarioPermitido", () => {
  it("no toca los mensajes dentro del horario de atención", () => {
    const dentro = new Date("2026-11-05T18:00:00.000Z"); // 12:00 CDMX
    expect(proximoHorarioPermitido(dentro, ZONA).getTime()).toBe(dentro.getTime());
  });

  it("mueve a las 08:00 los mensajes de madrugada", () => {
    const madrugada = new Date("2026-11-05T09:00:00.000Z"); // 03:00 CDMX
    const permitido = proximoHorarioPermitido(madrugada, ZONA);

    expect(partesEnZona(permitido, ZONA)).toMatchObject({ dia: 5, hora: 8, minuto: 0 });
  });

  it("mueve al día siguiente los mensajes de la noche", () => {
    const noche = new Date("2026-11-06T03:00:00.000Z"); // 21:00 CDMX del día 5
    const permitido = proximoHorarioPermitido(noche, ZONA);

    expect(partesEnZona(permitido, ZONA)).toMatchObject({ dia: 6, hora: 8, minuto: 0 });
  });

  it("nunca devuelve un instante anterior al recibido", () => {
    const instantes = [
      "2026-11-05T00:30:00.000Z",
      "2026-11-05T03:59:00.000Z",
      "2026-11-05T12:00:00.000Z",
      "2026-11-06T02:59:00.000Z",
    ].map((iso) => new Date(iso));

    for (const instante of instantes) {
      expect(proximoHorarioPermitido(instante, ZONA).getTime()).toBeGreaterThanOrEqual(
        instante.getTime()
      );
    }
  });
});
