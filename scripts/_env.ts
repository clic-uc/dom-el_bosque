/**
 * Carga `.env` para los scripts CLI cuando las variables no vienen del entorno
 * (en Docker vienen del entorno; en local, del archivo).
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
