import type { Metadata } from 'next';
import { UsersAdmin } from '@/features/admin/UsersAdmin';

export const metadata: Metadata = { title: 'Usuarios' };

/** Gestión de usuarios (§10.3). El guard admin está en el layout. */
export default function AdminUsersPage() {
  return <UsersAdmin />;
}
