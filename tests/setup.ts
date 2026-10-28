/**
 * Preparación común de las pruebas.
 *
 * Las pruebas no necesitan PostgreSQL, WhatsApp ni Google: el flujo se ejercita
 * con los dobles de `tests/helpers/fakes.ts`. La única integración real que se
 * prueba es HTTP (supertest contra la app de Express).
 */
process.env.NODE_ENV = "test";
process.env.TIMEZONE = "America/Mexico_City";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test?schema=public";
process.env.EVOLUTION_API_URL ??= "http://localhost:8080";
process.env.EVOLUTION_API_KEY ??= "test-key";
process.env.EVOLUTION_INSTANCE ??= "test-instance";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.CALENDAR_IDS ??= "primary";
process.env.LLM_API_KEY = "";
