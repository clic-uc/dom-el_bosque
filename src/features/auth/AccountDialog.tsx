'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { changePasswordSchema, updateNameSchema, type ChangePasswordInput } from '@/shared/schemas/users';
import { PasswordFields } from './PasswordFields';
import { useActor } from './actor-context';

type NameInput = { name: string };

/** "Mi cuenta" (§10.2): editar nombre y cambiar contraseña. */
export function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const actor = useActor();
  const router = useRouter();

  const nameForm = useForm<NameInput>({ resolver: zodResolver(updateNameSchema), defaultValues: { name: actor.name } });
  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function saveName(values: NameInput) {
    const { error } = await authClient.updateUser({ name: values.name });
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    toast.success('Nombre actualizado');
    router.refresh();
    onOpenChange(false);
  }

  async function savePassword(values: ChangePasswordInput) {
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    toast.success('Contraseña cambiada. Se cerraron tus otras sesiones.');
    passwordForm.reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Mi cuenta</DialogTitle>
          <DialogDescription className="text-base">{actor.email}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="name">
          <TabsList className="grid h-11 w-full grid-cols-2">
            <TabsTrigger value="name" className="text-base">
              Mi nombre
            </TabsTrigger>
            <TabsTrigger value="password" className="text-base">
              Contraseña
            </TabsTrigger>
          </TabsList>
          <TabsContent value="name">
            <Form {...nameForm}>
              <form onSubmit={nameForm.handleSubmit(saveName)} className="mt-4 space-y-5" noValidate>
                <FormField
                  control={nameForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Nombre</FormLabel>
                      <FormControl>
                        <Input {...field} className="h-12 text-base" autoComplete="name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={nameForm.formState.isSubmitting}>
                  {nameForm.formState.isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Guardar nombre
                </Button>
              </form>
            </Form>
          </TabsContent>
          <TabsContent value="password">
            <Form {...passwordForm}>
              <form onSubmit={passwordForm.handleSubmit(savePassword)} className="mt-4 space-y-5" noValidate>
                <PasswordFields form={passwordForm} />
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full text-base"
                  disabled={passwordForm.formState.isSubmitting}
                >
                  {passwordForm.formState.isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Cambiar contraseña
                </Button>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
