import { describe, expect, it } from "vitest";
import {
  aUtcDesdeZona,
  diasDeCalendario,
  formatear,
  hoyEnZona,
  partesEnZona,
} from "../../src/utils/time.js";

const ZONA = "America/Mexico_City";

describe("aUtcDesdeZona", () => {
  it("convierte 10:00 del consultorio al instante UTC (UTC-6)", () => {
    const instante = aUtcDesdeZona(2026, 11, 5, 10, 0, ZONA);
    expect(instante.toISOString()).toBe("2026-11-05T16:00:00.000Z");
  });

  it("respeta el cambio de horario de verano de otra zona", () => {
    // Madrid: UTC+1 en enero, UTC+2 en julio.
    expect(aUtcDesdeZona(2026, 1, 15, 12, 0, "Europe/Madrid").toISOString()).toBe(
      "2026-01-15T11:00:00.000Z"
    );
    expect(aUtcDesdeZona(2026, 7, 15, 12, 0, "Europe/Madrid").toISOString()).toBe(
      "2026-07-15T10:00:00.000Z"
    );
  });
});

describe("partesEnZona", () => {
  it("devuelve el día de calendario local, no el del servidor", () => {
    // 02:00 UTC del 5 de noviembre sigue siendo 4 de noviembre en Ciudad de México.
    const partes = partesEnZona(new Date("2026-11-05T02:00:00.000Z"), ZONA);
    expect(partes).toMatchObject({ anio: 2026, mes: 11, dia: 4, hora: 20, minuto: 0 });
  });
});

describe("diasDeCalendario", () => {
  it("cuenta días completos ignorando la hora", () => {
    const desde = new Date("2026-11-01T23:00:00.000Z"); // 1 de nov, 17:00 CDMX
    const hasta = new Date("2026-11-08T18:00:00.000Z"); // 8 de nov, 12:00 CDMX
    expect(diasDeCalendario(desde, hasta, ZONA)).toBe(7);
  });

  it("es 0 para el mismo día", () => {
    const fecha = new Date("2026-11-05T18:00:00.000Z");
    expect(diasDeCalendario(fecha, fecha, ZONA)).toBe(0);
  });
});

describe("formatear", () => {
  it("formatea en español y en la zona del consultorio", () => {
    const instante = new Date("2026-11-05T16:00:00.000Z");
    const texto = formatear(instante, "fechaHora", ZONA);
    expect(texto.toLowerCase()).toContain("jueves");
    expect(texto).toContain("10:00");
  });

  it("devuelve un ISO de pared útil para logs", () => {
    expect(formatear(new Date("2026-11-05T16:30:00.000Z"), "iso", ZONA)).toBe("2026-11-05 10:30");
  });
});

describe("hoyEnZona", () => {
  it("usa la fecha del consultorio aunque el servidor esté en UTC", () => {
    const hoy = hoyEnZona(ZONA, new Date("2026-11-05T03:00:00.000Z"));
    expect(hoy.getDate()).toBe(4);
    expect(hoy.getHours()).toBe(12);
  });
});
