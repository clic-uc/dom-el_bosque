'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { HelpLink } from '@/features/help/HelpLink';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { userRoleLabels, userRoles, type UserRole } from '@/shared/constants';
import { createUserSchema, type CreateUserInput } from '@/shared/schemas/users';
import type { UserItem } from '@/shared/types';
import { PasswordReveal } from './PasswordReveal';
import { generatePassword } from './password';

/** Qué puede hacer cada rol, en palabras simples (§6.2). */
export const roleDescriptions: Record<UserRole, string> = {
  admin: 'Puede hacer todo lo del Editor y además crear usuarios, cambiar roles y ver la auditoría completa.',
  editor: 'Puede crear y editar capas y registros, importar archivos y agregar documentos.',
  viewer: 'Solo puede consultar el mapa, los registros y exportar. No puede modificar nada.',
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (user: UserItem) => void;
};

/**
 * Crear usuario (§10.3): nombre, correo, rol, contraseña temporal (generable). Al crear, muestra la contraseña
 * una sola vez con botón copiar y el recordatorio de que el usuario deberá cambiarla al ingresar.
 */
export function CreateUserDialog({ open, onOpenChange, onCreated }: Props) {
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [created, setCreated] = useState<{ user: UserItem; password: string } | null>(null);

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', password: '', role: 'viewer' },
  });

  const mutation = useMutation({
    mutationFn: (input: CreateUserInput) => api<UserItem>('/api/admin/users', { method: 'POST', json: input }),
    onSuccess: (user, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      setCreated({ user, password: input.password });
      onCreated?.(user);
    },
    onError: (err) => {
      toast.error(errorMessage(err, 'No se pudo crear el usuario. Revisa los datos e intenta de nuevo.'));
    },
  });

  function handleOpenChange(next: boolean) {
    if (mutation.isPending) return;
    onOpenChange(next);
    if (!next) {
      // reset diferido para no borrar la pantalla mientras se cierra
      setTimeout(() => {
        form.reset();
        setCreated(null);
        setShowPassword(false);
      }, 200);
    }
  }

  function generate() {
    form.setValue('password', generatePassword(16), { shouldValidate: true, shouldDirty: true });
    setShowPassword(true);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl" showCloseButton={!mutation.isPending}>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Usuario creado</DialogTitle>
              <DialogDescription className="text-base">
                {created.user.name} ya puede ingresar con el correo {created.user.email} como{' '}
                {userRoleLabels[created.user.role ?? 'none']}.
              </DialogDescription>
            </DialogHeader>
            <PasswordReveal email={created.user.email} password={created.password} />
            <DialogFooter>
              <Button type="button" className="h-11 text-base" onClick={() => handleOpenChange(false)}>
                Listo, ya la copié
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                Crear usuario <HelpLink slug="administracion/usuarios" />
              </DialogTitle>
              <DialogDescription className="text-base">
                La cuenta se crea con una contraseña temporal que el usuario deberá cambiar al ingresar.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-5" noValidate>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Nombre completo</FormLabel>
                      <FormControl>
                        <Input {...field} className="h-12 text-base" autoComplete="off" placeholder="Ej.: María Pérez" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Correo electrónico</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          className="h-12 text-base"
                          autoComplete="off"
                          placeholder="Ej.: mperez@imelbosque.cl"
                        />
                      </FormControl>
                      <FormDescription>Con este correo ingresará a la plataforma.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Rol</FormLabel>
                      <FormControl>
                        <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-2">
                          {userRoles.map((role) => (
                            <Label
                              key={role}
                              htmlFor={`create-role-${role}`}
                              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft"
                            >
                              <RadioGroupItem value={role} id={`create-role-${role}`} className="mt-0.5 size-5" />
                              <span className="flex flex-col gap-0.5">
                                <span className="text-base font-semibold">{userRoleLabels[role]}</span>
                                <span className="text-sm font-normal text-muted-foreground">{roleDescriptions[role]}</span>
                              </span>
                            </Label>
                          ))}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Contraseña temporal</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            {...field}
                            type={showPassword ? 'text' : 'password'}
                            className="h-12 font-mono text-base"
                            autoComplete="new-password"
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-12 shrink-0"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                          aria-pressed={showPassword}
                        >
                          {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                          <span className="hidden sm:inline">{showPassword ? 'Ocultar' : 'Mostrar'}</span>
                        </Button>
                        <Button type="button" variant="secondary" className="h-12 shrink-0 text-base" onClick={generate}>
                          <RefreshCw aria-hidden /> Generar
                        </Button>
                      </div>
                      <FormDescription>
                        Al menos 10 caracteres. Usa &quot;Generar&quot; para obtener una segura; podrás copiarla después de crear la cuenta.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" className="h-11 text-base" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
                    Cancelar
                  </Button>
                  <Button type="submit" className="h-11 text-base" disabled={mutation.isPending}>
                    {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    Crear usuario
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
