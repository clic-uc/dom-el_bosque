import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HelpArticle } from '@/features/help/HelpArticle';
import { HelpIndex } from '@/features/help/HelpIndex';
import { HelpLayout } from '@/features/help/HelpLayout';
import type { HelpNavItem } from '@/features/help/HelpNav';
import { HelpPager } from '@/features/help/HelpPager';
import { helpSections, isHelpSlug } from '@/shared/help-slugs';
import { getHelpPage, listHelpPages, prevNext } from '../../../../../content/help/registry';

type Params = Promise<{ slug?: string[] }>;

function slugFrom(parts: string[] | undefined): string | null {
  return parts && parts.length > 0 ? parts.join('/') : null;
}

function navItems(): HelpNavItem[] {
  return listHelpPages().map((p) => ({
    slug: p.slug,
    title: p.meta.title,
    section: p.meta.section,
    draft: p.meta.draft,
  }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = slugFrom((await params).slug);
  if (slug === null) return { title: 'Manual de uso' };
  if (!isHelpSlug(slug)) return { title: 'Página no encontrada' };
  return { title: `${getHelpPage(slug).meta.title} · Manual de uso` };
}

/** Manual de uso (§10.7): sin slug muestra el índice; con slug válido, la página MDX; si no existe, 404. */
export default async function HelpPage({ params }: { params: Params }) {
  const slug = slugFrom((await params).slug);
  const pages = navItems();

  if (slug === null) {
    return (
      <HelpLayout pages={pages} activeSlug={null}>
        <HelpIndex pages={pages} />
      </HelpLayout>
    );
  }

  if (!isHelpSlug(slug)) notFound();

  const page = getHelpPage(slug);
  const { default: Content } = await page.load();
  const { prev, next } = prevNext(slug);
  const sectionTitle = helpSections.find((s) => s.id === page.meta.section)?.title;

  return (
    <HelpLayout pages={pages} activeSlug={slug}>
      <HelpArticle title={page.meta.title} eyebrow={sectionTitle}>
        <Content />
      </HelpArticle>
      <HelpPager
        prev={prev ? { slug: prev.slug, title: prev.meta.title } : null}
        next={next ? { slug: next.slug, title: next.meta.title } : null}
      />
    </HelpLayout>
  );
}
