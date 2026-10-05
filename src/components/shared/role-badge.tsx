import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { userRoleLabels, type UserRole } from '@/shared/constants';

/** Badge del rol de usuario (§10.2): admin morado, editor verde fuerte, viewer gris, sin rol gris con borde. */
export function RoleBadge({ role, className }: { role: UserRole | null | undefined; className?: string }) {
  const label = userRoleLabels[role ?? 'none'];
  const styles: Record<UserRole | 'none', string> = {
    admin: 'bg-primary text-white border-transparent',
    editor: 'bg-secondary-strong text-white border-transparent',
    viewer: 'bg-slate-200 text-slate-800 border-transparent',
    none: 'bg-transparent text-slate-600 border-slate-400',
  };
  return (
    <Badge variant="outline" className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', styles[role ?? 'none'], className)}>
      {label}
    </Badge>
  );
}
