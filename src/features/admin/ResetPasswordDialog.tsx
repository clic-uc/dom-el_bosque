'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { passwordSchema } from '@/shared/schemas/users';
import type { UserItem } from '@/shared/types';
import { PasswordReveal } from './PasswordReveal';
import { generatePassword } from './password';

type Props = {
  user: UserItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Asignar contraseña temporal (§10.3): genera una, la muestra una sola vez con botón copiar y avisa que se
 * cerrarán las sesiones del usuario y que deberá cambiarla al ingresar.
 */
export function ResetPasswordDialog({ user, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  // El contenedor monta el diálogo con `key={user.id}`, así cada usuario parte con una contraseña nueva.
  const [password, setPassword] = useState(() => generatePassword(16));
  const [show, setShow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { id: string; password: string }) =>
      api<void>(`/api/admin/users/${input.id}/password`, { method: 'PUT', json: { password: input.password } }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      setDone(input.password);
      toast.success('Contraseña temporal asignada. Se cerraron las sesiones del usuario.');
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo asignar la contraseña. Intenta de nuevo.')),
  });

  function submit() {
    if (!user) return;
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa la contraseña');
      return;
    }
    setError(null);
    mutation.mutate({ id: user.id, password: parsed.data });
  }

  function handleOpenChange(next: boolean) {
    if (mutation.isPending) return;
    onOpenChange(next);
    if (!next) {
      // reset diferido para no borrar la pantalla mientras se cierra
      setTimeout(() => {
        setPassword(generatePassword(16));
        setShow(true);
        setError(null);
        setDone(null);
      }, 200);
    }
  }

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl" showCloseButton={!mutation.isPending}>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Contraseña temporal asignada</DialogTitle>
              <DialogDescription className="text-base">
                Las sesiones abiertas de {user.name} se cerraron. Al ingresar con esta contraseña deberá definir una nueva.
              </DialogDescription>
            </DialogHeader>
            <PasswordReveal email={user.email} password={done} />
            <DialogFooter>
              <Button type="button" className="h-11 text-base" onClick={() => handleOpenChange(false)}>
                Listo, ya la copié
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Asignar contraseña temporal</DialogTitle>
              <DialogDescription className="text-base">
                Para {user.name} ({user.email}). Úsalo cuando la persona olvidó su contraseña.
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <TriangleAlert aria-hidden />
              <AlertTitle className="text-base">Qué pasará</AlertTitle>
              <AlertDescription className="text-base">
                <p>Su contraseña actual dejará de servir y se cerrarán todas sus sesiones abiertas.</p>
                <p>Deberá cambiar esta contraseña temporal la próxima vez que ingrese.</p>
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="reset-password" className="text-base">
                Contraseña temporal
              </Label>
              <div className="flex gap-2">
                <Input
                  id="reset-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={show ? 'text' : 'password'}
                  className="h-12 font-mono text-base"
                  autoComplete="new-password"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'reset-password-error' : undefined}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 shrink-0"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={show}
                >
                  {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </Button>
                <Button type="button" variant="secondary" className="h-12 shrink-0 text-base" onClick={() => setPassword(generatePassword(16))}>
                  <RefreshCw aria-hidden /> Generar otra
                </Button>
              </div>
              {error ? (
                <p id="reset-password-error" className="text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Al menos 10 caracteres. Se mostrará una sola vez después de asignarla.</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 text-base" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
                Cancelar
              </Button>
              <Button type="button" className="h-11 text-base" onClick={submit} disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Asignar contraseña temporal
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
