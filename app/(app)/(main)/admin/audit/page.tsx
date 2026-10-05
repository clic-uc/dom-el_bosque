import type { Metadata } from 'next';
import { AuditAdmin } from '@/features/admin/AuditAdmin';

export const metadata: Metadata = { title: 'Auditoría' };

/** Auditoría (§10.3): logs e importaciones. El guard admin está en el layout. */
export default function AdminAuditPage() {
  return <AuditAdmin />;
}
