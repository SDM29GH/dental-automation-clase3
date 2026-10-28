/**
 * Arranque del proceso: comprobar base de datos, sincronizar la agenda,
 * programar recordatorios y levantar el servidor + tareas periódicas.
 */
import { pathToFileURL } from "node:url";
import { config } from "./config/index.js";
import { crearApp } from "./app.js";
import prisma from "./utils/prisma.js";
import { detenerScheduler, iniciarScheduler } from "./scheduler/index.js";
import { reconciliarRecordatorios } from "./scheduler/recordatorios.service.js";
import { sincronizarCalendario } from "./services/google-calendar.js";
import { formatear } from "./utils/time.js";

export async function iniciar(): Promise<void> {
  console.log("🦷 DentalCare Retention Engine");
  console.log(`   Entorno: ${config.NODE_ENV} · Zona: ${config.TIMEZONE}`);

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ Base de datos conectada");
  } catch (error) {
    console.error("❌ No se pudo conectar a PostgreSQL:", (error as Error).message);
    console.error("   Revisa DATABASE_URL y que el contenedor esté arriba (docker compose up -d).");
    process.exit(1);
  }

  // La agenda de Google es opcional al arrancar: sin credenciales el sistema
  // sigue funcionando con las citas que ya estén en la base.
  if (config.googleHabilitado) {
    try {
      const resumen = await sincronizarCalendario();
      console.log(
        `✅ Calendario sincronizado: ${resumen.total} eventos ` +
          `(${resumen.creados} nuevas, ${resumen.actualizados} actualizadas, ${resumen.omitidos} ignoradas)`
      );
    } catch (error) {
      console.warn("⚠️  No se pudo sincronizar Google Calendar:", (error as Error).message);
      console.warn("   El servicio arranca igual; se reintentará a las 08:00.");
    }
  } else {
    console.warn("⚠️  Google Calendar sin configurar (falta GOOGLE_REFRESH_TOKEN).");
  }

  try {
    const programados = await reconciliarRecordatorios();
    console.log(`✅ ${programados} recordatorio(s) programados para las próximas citas`);
  } catch (error) {
    console.warn("⚠️  No se pudieron programar recordatorios:", (error as Error).message);
  }

  const servidor = crearApp().listen(config.PORT, () => {
    console.log(`🚀 HTTP en http://localhost:${config.PORT}`);
    console.log(`   Panel:   http://localhost:${config.PORT}/panel`);
    console.log(`   Webhook: POST http://localhost:${config.PORT}/webhook/whatsapp`);
    console.log(`   Salud:   GET  http://localhost:${config.PORT}/health`);
    if (!config.panelProtegido) {
      console.warn("   ⚠️  Panel sin contraseña: sólo accesible desde localhost (define PANEL_PASSWORD).");
    }
  });

  iniciarScheduler();
  console.log(`🕒 Hora del consultorio: ${formatear(new Date(), "fechaHora")}`);

  const cerrar = async (senal: string): Promise<void> => {
    console.log(`\n${senal} recibido, cerrando…`);
    detenerScheduler();
    // Cierra también las conexiones keep-alive: en Windows, salir con sockets
    // abiertos puede disparar una aserción de libuv en lugar de terminar limpio.
    servidor.closeAllConnections();
    servidor.close();
    await prisma.$disconnect();
    // Red de seguridad: si algo quedara colgado, el proceso sale igual.
    setTimeout(() => process.exit(0), 3_000).unref();
  };

  process.on("SIGINT", () => void cerrar("SIGINT"));
  process.on("SIGTERM", () => void cerrar("SIGTERM"));
}

const ejecutadoDirectamente =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoDirectamente) {
  iniciar().catch((error) => {
    console.error("❌ Error fatal al arrancar:", error);
    process.exit(1);
  });
}
