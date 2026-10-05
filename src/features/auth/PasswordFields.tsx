'use client';

import type { UseFormReturn } from 'react-hook-form';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { ChangePasswordInput } from '@/shared/schemas/users';

/** Campos de cambio de contraseña compartidos por `ForcedPasswordChange` y `AccountDialog`. */
export function PasswordFields({ form }: { form: UseFormReturn<ChangePasswordInput> }) {
  return (
    <>
      <FormField
        control={form.control}
        name="currentPassword"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">Contraseña actual</FormLabel>
            <FormControl>
              <Input {...field} type="password" autoComplete="current-password" className="h-12 text-base" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="newPassword"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">Nueva contraseña</FormLabel>
            <FormControl>
              <Input {...field} type="password" autoComplete="new-password" className="h-12 text-base" />
            </FormControl>
            <FormDescription>Al menos 10 caracteres. Puedes usar una frase fácil de recordar.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="confirmPassword"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">Repite la nueva contraseña</FormLabel>
            <FormControl>
              <Input {...field} type="password" autoComplete="new-password" className="h-12 text-base" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
