import type { Metadata } from 'next';
import { EmptyState } from '@/components/shared/states';

export const metadata: Metadata = { title: 'Usuarios' };

/** Placeholder: se implementa en la fase 8 (`features/admin/UsersTable`). */
export default function AdminUsersPage() {
  return <EmptyState title="Gestión de usuarios" description="Esta sección se está preparando." />;
}
