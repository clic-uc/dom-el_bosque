import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { authSchema, users } from '@/db/schema/auth';
import { env } from '@/env';
import { logger } from '@/server/logger';
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
  hooks: {
    // Cambio de contraseña: el servidor exige una clave distinta y siempre cierra las otras sesiones.
    // Fuera de este caso los hooks no devuelven nada: cualquier valor reemplazaría la respuesta.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/change-password') return;
      const { currentPassword, newPassword } = (ctx.body ?? {}) as Record<string, unknown>;
      if (typeof newPassword === 'string' && newPassword === currentPassword) {
        throw new APIError('BAD_REQUEST', {
          code: 'PASSWORD_UNCHANGED',
          message: 'La nueva contraseña debe ser distinta a la actual',
        });
      }
      return { context: { body: { ...ctx.body, revokeOtherSessions: true } } };
    }),
    // Con la contraseña ya cambiada se apaga must_change_password de ese usuario.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/change-password') return;
      const returned = ctx.context.returned;
      if (isAPIError(returned)) return;
      const userId = (returned as { user?: { id?: string } } | undefined)?.user?.id;
      if (!userId) return;
      try {
        await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, userId));
      } catch (err) {
        // La clave y las sesiones ya cambiaron: un 500 dejaría al usuario sin la cookie nueva.
        logger.error({ err, userId }, 'no se pudo apagar must_change_password');
      }
    }),
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
  },
  plugins: [admin({ ac, roles, defaultRole: 'viewer', adminRoles: ['admin'] }), nextCookies()],
});

export type Auth = typeof auth;
