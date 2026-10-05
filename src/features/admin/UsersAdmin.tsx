'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useActor } from '@/features/auth/actor-context';
import { HelpLink } from '@/features/help/HelpLink';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { userRoleLabels, type UserRole } from '@/shared/constants';
import type { UserItem, UsersList } from '@/shared/types';
import { CreateUserDialog, roleDescriptions } from './CreateUserDialog';
import { Paginator } from './Paginator';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { UsersTable } from './UsersTable';

const PAGE_SIZE = 20;

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type RoleConfirm = { user: UserItem; role: UserRole | null };

/** Gestión de usuarios (§10.3): buscador, "Ver listado general", "Crear usuario", tabla paginada y acciones. */
export function UsersAdmin() {
  const actor = useActor();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = useDebounced(search.trim(), 300);

  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserItem | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserItem | null>(null);
  const [roleConfirm, setRoleConfirm] = useState<RoleConfirm | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const params = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, query: query || undefined };
  const usersQuery = useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: () => api<UsersList>('/api/admin/users', { query: params }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all });

  const roleMutation = useMutation({
    mutationFn: ({ user, role }: RoleConfirm) =>
      api<{ role: UserRole | null }>(`/api/admin/users/${user.id}/role`, { method: 'PUT', json: { role } }),
    onMutate: ({ user }) => setPendingUserId(user.id),
    onSettled: () => setPendingUserId(null),
    onSuccess: (_d, { user, role }) => {
      void invalidate();
      toast.success(role ? `${user.name} ahora es ${userRoleLabels[role]}.` : `${user.name} quedó sin rol: solo podrá consultar.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo cambiar el rol. Intenta de nuevo.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (user: UserItem) => api<void>(`/api/admin/users/${user.id}`, { method: 'DELETE' }),
    onMutate: (user) => setPendingUserId(user.id),
    onSettled: () => setPendingUserId(null),
    onSuccess: (_d, user) => {
      void invalidate();
      setDeleteUser(null);
      toast.success(`Se eliminó la cuenta de ${user.name}.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo eliminar el usuario. Intenta de nuevo.')),
  });

  function requestRoleChange(user: UserItem, role: UserRole | null) {
    // Nombrar administrador o quitar el rol merecen confirmación; el resto aplica directo.
    if (role === 'admin' || role === null) setRoleConfirm({ user, role });
    else roleMutation.mutate({ user, role });
  }

  const data = usersQuery.data;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            Gestión de usuarios <HelpLink slug="administracion/usuarios" />
          </h2>
          <p className="text-base text-muted-foreground">Crea cuentas, cambia roles y asigna contraseñas temporales.</p>
        </div>
        <Button type="button" className="h-12 text-base" onClick={() => setCreateOpen(true)}>
          <UserPlus aria-hidden /> Crear usuario
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="users-search" className="text-base">
            Buscar por nombre o correo
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="users-search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Ej.: María o mperez@"
              className="h-12 pl-10 text-base"
              autoComplete="off"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100"
                aria-label="Borrar búsqueda"
              >
                <X className="size-5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-12 text-base"
          onClick={() => {
            setSearch('');
            setPage(1);
          }}
          disabled={!search && page === 1}
        >
          <Users aria-hidden /> Ver listado general
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
        {usersQuery.isPending ? (
          <LoadingState rows={6} label="Cargando usuarios…" />
        ) : usersQuery.isError ? (
          <ErrorState
            title="No se pudo cargar la lista de usuarios"
            message={errorMessage(usersQuery.error)}
            onRetry={() => void usersQuery.refetch()}
          />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title={query ? `No hay usuarios que coincidan con "${query}"` : 'Todavía no hay usuarios'}
            description={query ? 'Prueba con otra palabra o vuelve al listado general.' : 'Crea el primer usuario con el botón "Crear usuario".'}
            action={
              query ? (
                <Button type="button" variant="outline" className="h-11 text-base" onClick={() => setSearch('')}>
                  Ver listado general
                </Button>
              ) : null
            }
          />
        ) : data ? (
          <div className={usersQuery.isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <UsersTable
              users={data.data}
              currentUserId={actor.id}
              pendingUserId={pendingUserId}
              onChangeRole={requestRoleChange}
              onResetPassword={setResetUser}
              onDelete={setDeleteUser}
            />
          </div>
        ) : null}
      </div>

      {data ? <Paginator page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} noun="usuarios" disabled={usersQuery.isFetching} /> : null}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ResetPasswordDialog key={resetUser?.id ?? 'none'} user={resetUser} open={resetUser !== null} onOpenChange={(o) => !o && setResetUser(null)} />

      <ConfirmDialog
        open={deleteUser !== null}
        onOpenChange={(o) => !o && setDeleteUser(null)}
        title={`¿Eliminar a ${deleteUser?.name ?? ''}?`}
        description={
          <div className="space-y-2">
            <p>
              La cuenta <strong>{deleteUser?.email}</strong> dejará de existir y la persona no podrá volver a ingresar.
            </p>
            <p>Los registros y la auditoría que creó se conservan. Esta acción no se puede deshacer.</p>
          </div>
        }
        confirmLabel="Eliminar usuario"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteUser) deleteMutation.mutate(deleteUser);
        }}
      />

      <ConfirmDialog
        open={roleConfirm !== null}
        onOpenChange={(o) => !o && setRoleConfirm(null)}
        title={roleConfirm?.role === 'admin' ? `¿Nombrar administrador a ${roleConfirm.user.name}?` : `¿Quitar el rol a ${roleConfirm?.user.name ?? ''}?`}
        description={
          roleConfirm?.role === 'admin' ? (
            <p>{roleDescriptions.admin} Podrás cambiarlo después si hace falta.</p>
          ) : (
            <p>
              Sin rol, la persona solo podrá consultar la información (igual que un Visor) hasta que le asignes uno nuevo.
            </p>
          )
        }
        confirmLabel={roleConfirm?.role === 'admin' ? 'Nombrar administrador' : 'Quitar rol'}
        destructive={roleConfirm?.role === null}
        pending={roleMutation.isPending}
        onConfirm={async () => {
          if (!roleConfirm) return;
          await roleMutation.mutateAsync(roleConfirm).catch(() => undefined);
          setRoleConfirm(null);
        }}
      />
    </section>
  );
}
