import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Configuración de Prisma CLI (Prisma 6.19+).
 * Sustituye la clave `prisma` de package.json, que está deprecada.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx scripts/seed.ts",
  },
});
