'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { signInSchema, type SignInInput } from '@/shared/schemas/users';

export function SignInForm({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: SignInInput) {
    setError(null);
    const { data, error: err } = await authClient.signIn.email({ email: values.email, password: values.password });
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    const mustChange = (data?.user as { mustChangePassword?: boolean } | undefined)?.mustChangePassword;
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/map';
    // Recarga completa a propósito: el shell del servidor debe leer la sesión nueva y respetar `?next=`
    // (con router.replace + router.refresh el redirect de "/" ganaba y siempre caía en /map).
    window.location.assign(mustChange ? '/account/password' : safeNext);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="text-base">{error}</AlertDescription>
          </Alert>
        ) : null}
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
                  autoComplete="username"
                  inputMode="email"
                  placeholder="nombre@municipalidad.cl"
                  className="h-12 text-base"
                  autoFocus
                />
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
              <FormLabel className="text-base">Contraseña</FormLabel>
              <div className="relative">
                <FormControl>
                  <Input
                    {...field}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="h-12 pr-12 text-base"
                  />
                </FormControl>
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
          Ingresar
        </Button>
      </form>
    </Form>
  );
}
