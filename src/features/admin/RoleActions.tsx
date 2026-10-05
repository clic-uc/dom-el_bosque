'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { userRoleLabels, userRoles, type UserRole } from '@/shared/constants';
import type { UserItem } from '@/shared/types';

type Props = {
  user: UserItem;
  /** true si la fila es del propio administrador: no puede cambiarse ni quitarse el rol. */
  isSelf: boolean;
  pending: boolean;
  onChange: (role: UserRole | null) => void;
};

const SELF_MESSAGE = 'No puedes cambiar tu propio rol de administrador. Pídeselo a otro administrador.';

/** Tres botones "Asignar …" (el activo deshabilitado) + "Quitar rol" (§10.3). */
export function RoleActions({ user, isSelf, pending, onChange }: Props) {
  const current = user.role;

  function wrap(button: React.ReactNode, key: string) {
    if (!isSelf) return <span key={key}>{button}</span>;
    return (
      <Tooltip key={key}>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-primary">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-sm">{SELF_MESSAGE}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Cambiar el rol de ${user.name}`}>
      {userRoles.map((role) =>
        wrap(
          <Button
            type="button"
            variant={current === role ? 'default' : 'outline'}
            className="h-11 text-sm"
            disabled={isSelf || pending || current === role}
            aria-pressed={current === role}
            onClick={() => onChange(role)}
          >
            {pending && current !== role ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {current === role ? userRoleLabels[role] : `Asignar ${userRoleLabels[role]}`}
          </Button>,
          role,
        ),
      )}
      {wrap(
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-sm text-muted-foreground hover:text-destructive"
          disabled={isSelf || pending || current === null}
          onClick={() => onChange(null)}
        >
          Quitar rol
        </Button>,
        'none',
      )}
    </div>
  );
}
