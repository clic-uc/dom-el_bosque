'use client';

import { BookOpen, ChevronDown, LogOut, Settings, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RoleBadge } from '@/components/shared/role-badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';
import { initials } from '@/shared/text';
import { AccountDialog } from './AccountDialog';
import { useActor } from './actor-context';

/** Menú de usuario (§10.2): abre por click, accesible por teclado. */
export function UserMenu() {
  const actor = useActor();
  const router = useRouter();
  const [accountOpen, setAccountOpen] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.replace('/');
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-11 gap-2 px-2" aria-label={`Menú de ${actor.name}`}>
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary-soft text-sm font-semibold text-primary-dark">
                {initials(actor.name)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-40 truncate text-sm font-medium md:inline">{actor.name}</span>
            <RoleBadge role={actor.role} className="hidden md:inline-flex" />
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="space-y-1">
            <p className="truncate text-base font-semibold">{actor.name}</p>
            <p className="truncate text-sm font-normal text-muted-foreground">{actor.email}</p>
            <RoleBadge role={actor.role} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-11 text-base" onSelect={() => setAccountOpen(true)}>
            <Settings aria-hidden /> Mi cuenta
          </DropdownMenuItem>
          <DropdownMenuItem className="h-11 text-base" asChild>
            <Link href="/help">
              <BookOpen aria-hidden /> Manual de uso
            </Link>
          </DropdownMenuItem>
          {actor.role === 'admin' ? (
            <DropdownMenuItem className="h-11 text-base" asChild>
              <Link href="/admin">
                <UserCog aria-hidden /> Panel de administración
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-11 text-base" onSelect={() => void signOut()}>
            <LogOut aria-hidden /> Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </>
  );
}
