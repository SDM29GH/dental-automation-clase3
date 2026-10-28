import { describe, expect, it } from "vitest";
import {
  clasificarPorReglas,
  normalizarFecha,
  normalizarHora,
  procesarMensajeNlu,
} from "../../src/services/nlu.js";

/** Lunes 2 de noviembre de 2026, mediodía local. */
const LUNES = new Date(2026, 10, 2, 12, 0, 0);

describe("normalizarFecha", () => {
  it("entiende 'mañana'", () => {
    expect(normalizarFecha("mañana", LUNES)?.getDate()).toBe(3);
  });

  it("entiende 'pasado mañana'", () => {
    expect(normalizarFecha("pasado mañana", LUNES)?.getDate()).toBe(4);
  });

  it("resuelve el próximo día de la semana", () => {
    const jueves = normalizarFecha("cámbialo para el jueves", LUNES);
    expect(jueves?.getDate()).toBe(5);
    expect(jueves?.getDay()).toBe(4);
  });

  it("si hoy es jueves, 'el jueves' significa el siguiente", () => {
    const jueves = new Date(2026, 10, 5, 12);
    expect(normalizarFecha("el jueves", jueves)?.getDate()).toBe(12);
  });

  it("entiende '15 de noviembre'", () => {
    const fecha = normalizarFecha("mejor el 15 de noviembre", LUNES);
    expect(fecha?.getMonth()).toBe(10);
    expect(fecha?.getDate()).toBe(15);
  });

  it("entiende un ISO", () => {
    expect(normalizarFecha("2026-12-24", LUNES)?.getMonth()).toBe(11);
  });

  it("si el día ya pasó este mes, salta al siguiente", () => {
    const fecha = normalizarFecha("el 1", LUNES);
    expect(fecha?.getMonth()).toBe(11);
    expect(fecha?.getDate()).toBe(1);
  });

  it("devuelve null cuando no hay fecha", () => {
    expect(normalizarFecha("hola, ¿cómo están?", LUNES)).toBeNull();
  });
});

describe("normalizarHora", () => {
  it.each([
    ["a las 10:30", "10:30"],
    ["18:00", "18:00"],
    ["6 de la tarde", "18:00"],
    ["8 pm", "20:00"],
    ["9 de la mañana", "09:00"],
    ["a las 11", "11:00"],
  ])("interpreta %s como %s", (entrada, esperado) => {
    expect(normalizarHora(entrada)).toBe(esperado);
  });

  it("devuelve null si no hay hora", () => {
    expect(normalizarHora("el jueves por favor")).toBeNull();
  });
});

describe("clasificarPorReglas", () => {
  it.each([
    ["sí", "CONFIRMAR"],
    ["Sí, ahí estaré", "CONFIRMAR"],
    ["confirmo", "CONFIRMAR"],
    ["no puedo ir, cámbiamelo para el jueves", "REPROGRAMAR"],
    ["¿podemos mover la cita al viernes?", "REPROGRAMAR"],
    ["cancelo mi cita", "CANCELAR"],
    ["ya no voy a poder", "CANCELAR"],
    ["¿cuánto cuesta la limpieza?", "DUDA"],
    ["¿llevan tarjeta?", "DUDA"],
  ])("clasifica %s como %s", (mensaje, esperado) => {
    expect(clasificarPorReglas(mensaje)?.intento).toBe(esperado);
  });

  it("no inventa una intención cuando no hay señal", () => {
    expect(clasificarPorReglas("zzz qwerty")).toBeNull();
  });

  it("gana reprogramar sobre cancelar cuando el paciente pide otra fecha", () => {
    expect(clasificarPorReglas("no puedo el martes, mejor el jueves")?.intento).toBe("REPROGRAMAR");
  });

  it("entiende una respuesta de botón aunque no use el texto del botón", () => {
    expect(clasificarPorReglas("Necesito cambiarla")?.intento).toBe("REPROGRAMAR");
  });
});

describe("procesarMensajeNlu", () => {
  it("resuelve botones sin llamar al modelo", async () => {
    const resultado = await procesarMensajeNlu({
      mensaje: "Sí, asistiré",
      esBoton: true,
      botonId: "confirmar_cita",
    });

    expect(resultado.intento).toBe("CONFIRMAR");
    expect(resultado.fuente).toBe("boton");
    expect(resultado.confianza).toBeGreaterThan(0.95);
  });

  it("extrae la fecha de una respuesta libre sin LLM configurado", async () => {
    const resultado = await procesarMensajeNlu({
      mensaje: "no puedo ir, cámbiamelo para el jueves",
    });

    expect(resultado.intento).toBe("REPROGRAMAR");
    expect(resultado.fuente).toBe("regla");
    expect(resultado.nuevaFecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const fecha = new Date(`${resultado.nuevaFecha}T12:00:00`);
    expect(fecha.getDay()).toBe(4); // jueves
    expect(fecha.getTime()).toBeGreaterThan(Date.now());
  });

  it("extrae hora y fecha cuando el paciente las menciona", async () => {
    const resultado = await procesarMensajeNlu({
      mensaje: "mejor el viernes a las 4 de la tarde",
    });

    expect(resultado.intento).toBe("REPROGRAMAR");
    expect(resultado.nuevaHora).toBe("16:00");
    expect(resultado.nuevaFecha).not.toBeNull();
  });

  it("marca como OTRO (para escalar) lo que no entiende", async () => {
    const resultado = await procesarMensajeNlu({ mensaje: "zxcvbnm" });
    expect(resultado.intento).toBe("OTRO");
    expect(resultado.confianza).toBeLessThan(0.5);
  });

  it("nunca lanza con un mensaje vacío", async () => {
    await expect(procesarMensajeNlu({ mensaje: "   " })).resolves.toMatchObject({
      intento: "OTRO",
    });
  });
});
