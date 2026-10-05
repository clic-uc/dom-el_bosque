import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins';
import { db } from '@/db/client';
import { authSchema } from '@/db/schema/auth';
import { env } from '@/env';
import { ac, roles } from '@/shared/permissions';

/** Instancia de Better Auth (§6.1). Sin registro público, sin correos. */
export const auth = betterAuth({
  appName: 'SIGDOM El Bosque',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema, usePlural: true }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    disableSignUp: true,
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      mustChangePassword: { type: 'boolean', defaultValue: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // sin cookieCache: los cambios de rol aplican en el siguiente request
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/change-password': { window: 60, max: 10 },
    },
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
  },
  plugins: [admin({ ac, roles, defaultRole: 'viewer', adminRoles: ['admin'] }), nextCookies()],
});

export type Auth = typeof auth;
