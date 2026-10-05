import '@testing-library/jest-dom/vitest';

try {
  process.loadEnvFile('.env.test');
} catch {
  try {
    process.loadEnvFile('.env');
  } catch {
    // sin archivo de entorno: las variables deben venir del proceso
  }
}
