'use client';

import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { Auth } from '@/server/auth';
import { ac, roles } from '@/shared/permissions';

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles }), inferAdditionalFields<Auth>()],
});


/** Mensajes en español para los códigos de error de Better Auth (§10.1). */
export function authErrorMessage(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (!error) return 'Ocurrió un error. Intenta de nuevo.';
  if (error.status === 429) return 'Demasiados intentos. Espera un minuto e intenta de nuevo.';
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'INVALID_EMAIL':
    case 'USER_NOT_FOUND':
      return 'Correo o contraseña incorrectos.';
    case 'PASSWORD_TOO_SHORT':
      return 'La contraseña debe tener al menos 10 caracteres.';
    case 'PASSWORD_TOO_LONG':
      return 'La contraseña es demasiado larga.';
    case 'PASSWORD_UNCHANGED':
      return 'La nueva contraseña debe ser distinta a la actual';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'Ya existe una cuenta con ese correo.';
    case 'BANNED_USER':
      return 'Esta cuenta está bloqueada. Contacta a un administrador.';
    case 'SESSION_EXPIRED':
      return 'Tu sesión expiró. Vuelve a ingresar.';
    case 'FAILED_TO_CREATE_USER':
      return 'No se pudo crear el usuario.';
    default:
      return error.message || 'Ocurrió un error. Intenta de nuevo.';
  }
}
