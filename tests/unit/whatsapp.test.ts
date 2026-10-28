import { describe, expect, it } from "vitest";
import { normalizarTelefono, numeroParaEnvio } from "../../src/services/whatsapp.js";

describe("normalizarTelefono", () => {
  it("deja sólo dígitos", () => {
    expect(normalizarTelefono("+52 55 1234-5678")).toBe("525512345678");
  });
});

describe("numeroParaEnvio", () => {
  it("antepone la lada del país a los 10 dígitos guardados", () => {
    expect(numeroParaEnvio("5512345678", "52")).toBe("525512345678");
  });

  it("antepone la lada aunque el número venga con formato", () => {
    expect(numeroParaEnvio("55 1234 5678", "52")).toBe("525512345678");
  });

  it("respeta un número que ya trae lada", () => {
    expect(numeroParaEnvio("5215512345678", "52")).toBe("5215512345678");
  });

  it("usa la lada configurada para otros países", () => {
    expect(numeroParaEnvio("5512345678", "1")).toBe("15512345678");
  });
});
