/**
 * Carga `.env` para los scripts CLI cuando las variables no vienen del entorno
 * (en Docker vienen del entorno; en local, del archivo).
 * Si existe `DATABASE_URL_DIRECT` (staging en Neon: conexión sin `-pooler`), los scripts la usan en vez de
 * `DATABASE_URL`: migraciones, DDL y sesiones largas no funcionan a través de PgBouncer en modo transacción.
 */
export function loadEnv(file = process.env.ENV_FILE ?? '.env') {
  if (process.env.DATABASE_URL) return;
  try {
    process.loadEnvFile(file);
  } catch {
    // sin archivo: las variables deben venir del proceso
  }
}

loadEnv();

if (process.env.DATABASE_URL_DIRECT) process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT;
