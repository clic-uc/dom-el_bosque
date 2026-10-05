import type { Metadata } from 'next';
import { EmptyState } from '@/components/shared/states';

export const metadata: Metadata = { title: 'Auditoría' };

/** Placeholder: se implementa en la fase 8 (`features/admin/AuditLogList`). */
export default function AdminAuditPage() {
  return <EmptyState title="Auditoría" description="Esta sección se está preparando." />;
}
