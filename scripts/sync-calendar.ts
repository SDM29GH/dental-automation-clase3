/**
 * Sincronización manual de Google Calendar.
 *
 *   npm run sync:calendar
 *   SYNC_DESDE=2026-11-01 SYNC_HASTA=2026-12-01 npm run sync:calendar
 */
import "dotenv/config";
import { config } from "../src/config/index.js";
import { sincronizarCalendario } from "../src/services/google-calendar.js";
import prisma from "../src/utils/prisma.js";

async function main(): Promise<void> {
  if (!config.googleHabilitado) {
    console.error("❌ Falta GOOGLE_REFRESH_TOKEN. Ejecuta primero: npm run oauth");
    process.exit(1);
  }

  const desde = process.env.SYNC_DESDE ? new Date(process.env.SYNC_DESDE) : undefined;
  const hasta = process.env.SYNC_HASTA ? new Date(process.env.SYNC_HASTA) : undefined;

  console.log(`Sincronizando ${config.CALENDAR_IDS.join(", ")}…`);
  const resumen = await sincronizarCalendario({ desde, hasta });

  console.log("✅ Sincronización terminada");
  console.log(`   Eventos leídos:     ${resumen.total}`);
  console.log(`   Citas nuevas:       ${resumen.creados}`);
  console.log(`   Citas actualizadas: ${resumen.actualizados}`);
  console.log(`   Canceladas:         ${resumen.cancelados}`);
  console.log(`   Ignoradas:          ${resumen.omitidos}`);
}

main()
  .catch((error) => {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
