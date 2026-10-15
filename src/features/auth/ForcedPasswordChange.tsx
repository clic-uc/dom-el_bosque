'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { changePasswordSchema, type ChangePasswordInput } from '@/shared/schemas/users';
import { PasswordFields } from './PasswordFields';

export function ForcedPasswordChange({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ChangePasswordInput) {
    setError(null);
    const { error: err } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    toast.success('Contraseña guardada. Ya puedes usar la plataforma.');
    router.replace('/map');
    router.refresh();
  }

  async function signOut() {
    await authClient.signOut();
    router.replace('/');
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-5" noValidate>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="text-base">{error}</AlertDescription>
          </Alert>
        ) : null}
        <PasswordFields form={form} />
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Guardar contraseña
        </Button>
        {forced ? (
          <Button type="button" variant="ghost" size="lg" className="w-full text-base" onClick={signOut}>
            <LogOut aria-hidden /> Cerrar sesión
          </Button>
        ) : null}
      </form>
    </Form>
  );
}
