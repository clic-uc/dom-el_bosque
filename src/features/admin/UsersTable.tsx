'use client';

import { KeyRound, ShieldAlert, Trash2 } from 'lucide-react';
import { RoleBadge } from '@/components/shared/role-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { UserRole } from '@/shared/constants';
import type { UserItem } from '@/shared/types';
import { RoleActions } from './RoleActions';

type Props = {
  users: UserItem[];
  currentUserId: string;
  /** id del usuario cuya mutación está en curso. */
  pendingUserId: string | null;
  onChangeRole: (user: UserItem, role: UserRole | null) => void;
  onResetPassword: (user: UserItem) => void;
  onDelete: (user: UserItem) => void;
};

/** Tabla de usuarios (§10.3): nombre, correo, rol, último acceso, aviso de contraseña temporal y acciones. */
export function UsersTable({ users, currentUserId, pendingUserId, onChangeRole, onResetPassword, onDelete }: Props) {
  return (
    <Table className="text-base">
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead className="h-12 text-sm">Usuario</TableHead>
          <TableHead className="h-12 text-sm">Rol</TableHead>
          <TableHead className="h-12 text-sm">Último acceso</TableHead>
          <TableHead className="h-12 text-sm">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => {
          const isSelf = u.id === currentUserId;
          const pending = pendingUserId === u.id;
          return (
            <TableRow key={u.id} className="align-top">
              <TableCell className="py-3">
                <p className="font-semibold">
                  {u.name}
                  {isSelf ? <span className="ml-2 text-sm font-normal text-muted-foreground">(tú)</span> : null}
                </p>
                <p className="text-sm text-muted-foreground">{u.email}</p>
              </TableCell>
              <TableCell className="py-3">
                <div className="flex flex-col items-start gap-1.5">
                  <RoleBadge role={u.role} className="text-sm" />
                  {u.mustChangePassword ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                      <ShieldAlert className="size-3.5" aria-hidden /> Debe cambiar contraseña
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="py-3 whitespace-nowrap">
                {u.lastSignInAt ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help underline decoration-dotted underline-offset-4">{formatRelative(u.lastSignInAt)}</span>
                    </TooltipTrigger>
                    <TooltipContent>{formatDateTime(u.lastSignInAt)}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground">Nunca ha ingresado</span>
                )}
              </TableCell>
              <TableCell className="py-3">
                <div className="flex flex-col gap-2">
                  <RoleActions user={u} isSelf={isSelf} pending={pending} onChange={(role) => onChangeRole(u, role)} />
                  <div className="flex flex-wrap gap-1.5">
                    {isSelf ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex rounded-md">
                            <Button type="button" variant="outline" className="h-11 text-sm" disabled>
                              <KeyRound aria-hidden /> Asignar contraseña temporal
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-sm">Para cambiar tu propia contraseña usa &quot;Mi cuenta&quot; en el menú de usuario.</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button type="button" variant="outline" className="h-11 text-sm" disabled={pending} onClick={() => onResetPassword(u)}>
                        <KeyRound aria-hidden /> Asignar contraseña temporal
                      </Button>
                    )}
                    {isSelf ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex rounded-md">
                            <Button type="button" variant="outline" className="h-11 text-sm text-destructive" disabled>
                              <Trash2 aria-hidden /> Eliminar
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-sm">No puedes eliminar tu propia cuenta. Pídeselo a otro administrador.</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 border-destructive/40 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={pending}
                        onClick={() => onDelete(u)}
                      >
                        <Trash2 aria-hidden /> Eliminar
                      </Button>
                    )}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
