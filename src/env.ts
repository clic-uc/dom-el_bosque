import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET debe tener al menos 32 caracteres'),
    BETTER_AUTH_URL: z.string().url(),
    STORAGE_DIR: z.string().min(1).default('./storage'),
    MAX_IMPORT_FILE_MB: z.coerce.number().int().positive().default(10),
    MAX_ATTACHMENT_MB: z.coerce.number().int().positive().default(20),
    GEOCODER_PROVIDERS: z
      .string()
      .default('padron,nominatim')
      .transform((s) =>
        s
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.enum(['padron', 'nominatim', 'photon']))),
    NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
    PHOTON_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    GEOCODER_CONTACT_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_MAP_STYLE_URL: z.string().url(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    STORAGE_DIR: process.env.STORAGE_DIR,
    MAX_IMPORT_FILE_MB: process.env.MAX_IMPORT_FILE_MB,
    MAX_ATTACHMENT_MB: process.env.MAX_ATTACHMENT_MB,
    GEOCODER_PROVIDERS: process.env.GEOCODER_PROVIDERS,
    NOMINATIM_URL: process.env.NOMINATIM_URL,
    PHOTON_URL: process.env.PHOTON_URL,
    GEOCODER_CONTACT_EMAIL: process.env.GEOCODER_CONTACT_EMAIL,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: false,
});
