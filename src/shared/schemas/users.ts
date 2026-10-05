import { z } from 'zod';
import { userRoles } from '../constants';

export const emailSchema = z.string().trim().toLowerCase().email('Escribe un correo válido');

export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña es demasiado larga');

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Escribe tu contraseña'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Escribe tu contraseña actual'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'La nueva contraseña debe ser distinta a la actual',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateNameSchema = z.object({
  name: z.string().trim().min(2, 'Escribe tu nombre').max(120),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre').max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(userRoles, { error: 'Elige un rol' }),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setUserRoleSchema = z.object({
  role: z.enum(userRoles).nullable(),
});
export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

export const setUserPasswordSchema = z.object({
  password: passwordSchema,
});

export const usersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  query: z.string().trim().max(120).optional(),
});
export type UsersQuery = z.infer<typeof usersQuerySchema>;
