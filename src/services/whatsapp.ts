/**
 * Cliente de Evolution API (WhatsApp).
 *
 * Sólo habla HTTP: no toca la base de datos ni decide qué decir. La redacción
 * vive en `mensajes.ts` y la persistencia en el repositorio, para que cada
 * pieza se pueda probar (y reemplazar) por separado.
 *
 * Endpoints usados (Evolution API v2):
 *   POST /message/sendText/{instance}
 *   POST /message/sendButtons/{instance}
 */
import axios, { AxiosInstance, isAxiosError } from "axios";
import { config } from "../config/index.js";

export interface BotonWhatsapp {
  id: string;
  texto: string;
}

export interface EnvioTexto {
  telefono: string;
  texto: string;
  /**
   * Acción interactiva (panel): un solo intento y timeout corto. Un fallo de
   * Evolution no debe dejar a la asistente esperando 30 s frente a la pantalla.
   */
  rapido?: boolean;
}

export interface EnvioBotones {
  telefono: string;
  titulo: string;
  descripcion: string;
  pie?: string;
  botones: BotonWhatsapp[];
}

export interface ResultadoEnvio {
  proveedorId: string;
  simulado: boolean;
}

export class WhatsappError extends Error {
  constructor(
    message: string,
    readonly estado?: number
  ) {
    super(message);
    this.name = "WhatsappError";
  }
}

/** Normaliza a sólo dígitos: Evolution espera el número sin "+" ni espacios. */
export function normalizarTelefono(telefono: string): string {
  return telefono.replace(/\D/g, "");
}

/**
 * Número que se manda a Evolution.
 *
 * La base guarda los últimos 10 dígitos (así llega el webhook), pero Evolution
 * exige la lada del país. Si el número ya viene completo (11+ dígitos) se
 * respeta tal cual.
 */
export function numeroParaEnvio(telefono: string, pais: string = config.WHATSAPP_PAIS): string {
  const digitos = normalizarTelefono(telefono);
  if (digitos.length === 0) return "";
  if (digitos.length <= 10) return `${normalizarTelefono(pais)}${digitos}`;
  return digitos;
}

export class WhatsappService {
  private readonly http: AxiosInstance;

  constructor(
    private readonly opciones: {
      baseUrl?: string;
      apiKey?: string;
      instancia?: string;
      http?: AxiosInstance;
      /** Permite operar sin Evolution (demo, tests) registrando los envíos. */
      simulado?: boolean;
    } = {}
  ) {
    this.http =
      opciones.http ??
      axios.create({
        baseURL: (opciones.baseUrl ?? config.EVOLUTION_API_URL).replace(/\/$/, ""),
        timeout: 15_000,
        headers: {
          "Content-Type": "application/json",
          apikey: opciones.apiKey ?? config.EVOLUTION_API_KEY,
        },
      });
  }

  private get instancia(): string {
    return this.opciones.instancia ?? config.EVOLUTION_INSTANCE;
  }

  private get simulado(): boolean {
    return this.opciones.simulado ?? false;
  }

  async enviarTexto({ telefono, texto, rapido = false }: EnvioTexto): Promise<ResultadoEnvio> {
    const digitos = normalizarTelefono(telefono);
    if (digitos.length < 10) {
      throw new WhatsappError(`Teléfono inválido: "${telefono}"`);
    }
    const numero = numeroParaEnvio(telefono);

    if (this.simulado) {
      console.log(`[whatsapp:simulado] → ${numero}: ${texto.slice(0, 80)}…`);
      return { proveedorId: `sim-${Date.now()}`, simulado: true };
    }

    return this.conReintentos(async () => {
      const { data } = await this.http.post<{ key?: { id?: string } }>(
        `/message/sendText/${this.instancia}`,
        { number: numero, text: texto },
        rapido ? { timeout: 5_000 } : undefined
      );
      return { proveedorId: data?.key?.id ?? "", simulado: false };
    }, "enviar texto", rapido ? 1 : 2);
  }

  async enviarBotones({ telefono, titulo, descripcion, pie, botones }: EnvioBotones): Promise<ResultadoEnvio> {
    const digitos = normalizarTelefono(telefono);
    if (digitos.length < 10) {
      throw new WhatsappError(`Teléfono inválido: "${telefono}"`);
    }
    const numero = numeroParaEnvio(telefono);
    if (botones.length === 0 || botones.length > 3) {
      throw new WhatsappError("WhatsApp permite entre 1 y 3 botones por mensaje.");
    }

    if (this.simulado) {
      console.log(
        `[whatsapp:simulado] → ${numero}: ${titulo} [${botones.map((b) => b.texto).join(" | ")}]`
      );
      return { proveedorId: `sim-${Date.now()}`, simulado: true };
    }

    return this.conReintentos(async () => {
      const { data } = await this.http.post<{ key?: { id?: string } }>(
        `/message/sendButtons/${this.instancia}`,
        {
          number: numero,
          title: titulo,
          description: descripcion,
          footer: pie ?? "Consultorio de la Dra. Laura",
          buttons: botones.map((boton) => ({
            type: "reply",
            buttonId: boton.id,
            buttonText: { displayText: boton.texto },
          })),
        }
      );
      return { proveedorId: data?.key?.id ?? "", simulado: false };
    }, "enviar botones");
  }

  /** Comprueba que la instancia esté conectada (útil en /health). */
  async estadoConexion(): Promise<{ conectado: boolean; estado: string }> {
    if (this.simulado) return { conectado: true, estado: "simulado" };
    try {
      const { data } = await this.http.get<{ instance?: { state?: string } }>(
        `/instance/connectionState/${this.instancia}`,
        { timeout: 5_000 }
      );
      const estado = data?.instance?.state ?? "desconocido";
      return { conectado: estado === "open", estado };
    } catch (error) {
      return { conectado: false, estado: this.describirError(error) };
    }
  }

  private async conReintentos(
    operacion: () => Promise<ResultadoEnvio>,
    contexto: string,
    intentos = 2
  ): Promise<ResultadoEnvio> {
    let ultimoError: unknown;
    for (let intento = 1; intento <= intentos; intento++) {
      try {
        return await operacion();
      } catch (error) {
        ultimoError = error;
        // Errores 4xx (número inválido, instancia desconectada) no se reintentan.
        if (isAxiosError(error) && error.response && error.response.status < 500) break;
        if (intento < intentos) await new Promise((r) => setTimeout(r, 500 * intento));
      }
    }
    throw new WhatsappError(`No se pudo ${contexto}: ${this.describirError(ultimoError)}`);
  }

  private describirError(error: unknown): string {
    if (isAxiosError(error)) {
      const estado = error.response?.status;
      const detalle =
        (error.response?.data as { message?: string } | undefined)?.message ?? error.message;
      return estado ? `${estado} ${detalle}` : detalle;
    }
    return error instanceof Error ? error.message : String(error);
  }
}

export const whatsappService = new WhatsappService();
