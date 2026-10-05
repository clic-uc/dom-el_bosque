import type { Metadata } from 'next';
import { EmptyState } from '@/components/shared/states';

export const metadata: Metadata = { title: 'Manual de uso' };

/** Placeholder: el manual MDX se implementa en la fase 10 (§10.7). */
export default async function HelpPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <EmptyState
        title="Manual de uso"
        description={slug?.length ? `La página "${slug.join('/')}" se está preparando.` : 'El manual se está preparando.'}
      />
    </main>
  );
}
