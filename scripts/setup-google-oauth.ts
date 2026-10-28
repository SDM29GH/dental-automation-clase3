/**
 * Obtiene el refresh_token de Google Calendar y lo guarda en .env.
 *
 * Requisitos previos (Google Cloud Console):
 *   1. Crear proyecto y habilitar "Google Calendar API".
 *   2. Credenciales → ID de cliente de OAuth → "Aplicación de escritorio".
 *   3. Copiar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET al .env.
 *   4. Ejecutar:  npm run oauth
 *
 * Flujo: servidor local en http://127.0.0.1:53682. Google retiró el flujo
 * "oob" (copiar y pegar el código) para clientes nuevos, así que la app espera
 * la redirección en loopback, que es lo recomendado para apps de escritorio.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const RUTA_ENV = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
const PUERTO = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PUERTO}/oauth2callback`;
const ESPERA_MS = 5 * 60_000;

/** Abre el navegador del sistema; si falla, el usuario copia la URL. */
function abrirNavegador(url: string): void {
  const comando =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const argumentos = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(comando, argumentos, { stdio: "ignore", detached: true }).unref();
  } catch {
    // No es crítico: la URL se imprime igual en la terminal.
  }
}

/** Espera el código de autorización que Google envía al redirect local. */
function esperarCodigo(): Promise<string> {
  return new Promise((resolve, reject) => {
    let resuelto = false;

    const terminar = (accion: () => void) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(temporizador);
      servidor.close();
      accion();
    };

    const servidor = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${PUERTO}`);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Ruta no encontrada");
        return;
      }

      const error = url.searchParams.get("error");
      const codigo = url.searchParams.get("code");
      const responder = (estado: number, html: string) => {
        res.writeHead(estado, { "content-type": "text/html; charset=utf-8" }).end(html);
      };

      if (error) {
        responder(
          400,
          `<h1>Autorización cancelada</h1><p>Google devolvió: ${error}</p>` +
            `<p>Vuelve a la terminal y ejecuta <code>npm run oauth</code> otra vez.</p>`
        );
        terminar(() => reject(new Error(`Google devolvió: ${error}`)));
        return;
      }

      if (!codigo) {
        responder(400, "<h1>Falta el código de autorización</h1>");
        return;
      }

      responder(
        200,
        "<h1>Listo ✅</h1><p>Autorización recibida. Puedes cerrar esta pestaña y volver a la terminal.</p>"
      );
      terminar(() => resolve(codigo));
    });

    const temporizador = setTimeout(() => {
      terminar(() =>
        reject(
          new Error(
            "Se agotaron los 5 minutos de espera. Vuelve a ejecutar `npm run oauth` e inicia sesión a tiempo."
          )
        )
      );
    }, ESPERA_MS);

    servidor.on("error", (error) => {
      terminar(() =>
        reject(
          new Error(
            `No se pudo abrir ${REDIRECT_URI}: ${(error as Error).message}. ` +
              "Cierra el programa que esté usando el puerto 53682 y reintenta."
          )
        )
      );
    });

    servidor.listen(PUERTO, "127.0.0.1", () => {
      console.log(`   Escuchando la respuesta de Google en ${REDIRECT_URI}\n`);
    });
  });
}

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (
    !clientId ||
    !clientSecret ||
    clientId.startsWith("dev-") ||
    clientId.startsWith("tu-") ||
    clientSecret === "tu-client-secret"
  ) {
    console.error(
      "❌ Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET reales en .env\n" +
        "   Crea credenciales OAuth de tipo 'Aplicación de escritorio' en Google Cloud Console."
    );
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  console.log("\n1) Autoriza el acceso a Google Calendar con la cuenta del consultorio.");
  console.log("   Si el navegador no se abre solo, copia esta URL:\n");
  console.log(url);
  console.log("\n2) No cierres esta ventana: la confirmación llega sola al navegador.\n");

  // En servidores sin navegador (o al probar el script) se puede omitir.
  if (process.env.OAUTH_NO_BROWSER !== "1") abrirNavegador(url);
  const codigo = await esperarCodigo();
  const { tokens } = await oauth2.getToken(codigo);
  if (!tokens.refresh_token) {
    console.error(
      "❌ Google no devolvió refresh_token. Revoca el acceso previo en\n" +
        "   https://myaccount.google.com/permissions y repite el proceso."
    );
    process.exit(1);
  }

  const env = await readFile(RUTA_ENV, "utf8").catch(() => "");
  const actualizado = /^GOOGLE_REFRESH_TOKEN=.*/m.test(env)
    ? env.replace(/^GOOGLE_REFRESH_TOKEN=.*/m, `GOOGLE_REFRESH_TOKEN="${tokens.refresh_token}"`)
    : `${env}\nGOOGLE_REFRESH_TOKEN="${tokens.refresh_token}"\n`;

  await writeFile(RUTA_ENV, actualizado, "utf8");

  console.log("\n✅ refresh_token guardado en .env");
  console.log("   Comprueba la conexión con:  npm run sync:calendar");
}

main().catch((error) => {
  console.error("❌ Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
