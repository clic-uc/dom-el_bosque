import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // sin .env: DATABASE_URL debe venir del entorno
  }
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
  extensionsFilters: ['postgis'],
  tablesFilter: ['!spatial_ref_sys', '!pgboss*'],
  schemaFilter: ['public'],
});
