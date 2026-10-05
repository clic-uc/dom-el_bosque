import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { helpRegistry, listHelpPages, prevNext } from '../../content/help/registry';
import { helpSections, helpSlugs, isHelpSlug } from './help-slugs';

const contentDir = path.resolve(__dirname, '../../content/help');
const sectionIds: readonly string[] = helpSections.map((s) => s.id);

/** Lista recursiva de archivos `.mdx` como slugs (`mapa/navegacion`), siempre con `/` como separador. */
function listMdxSlugs(dir: string, prefix = ''): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return listMdxSlugs(path.join(dir, entry.name), rel);
      return entry.name.endsWith('.mdx') ? [rel.slice(0, -'.mdx'.length)] : [];
    })
    .sort();
}

/** Extrae `export const meta = {...}` del texto del MDX sin compilarlo. */
function readMdxMeta(slug: string) {
  const source = fs.readFileSync(path.join(contentDir, `${slug}.mdx`), 'utf8');
  const block = /export const meta = \{([\s\S]*?)\};/.exec(source)?.[1];
  if (!block) throw new Error(`${slug}.mdx no exporta meta`);
  const str = (key: string) => new RegExp(`${key}:\\s*'([^']*)'`).exec(block)?.[1];
  const num = (key: string) => Number(new RegExp(`${key}:\\s*(\\d+)`).exec(block)?.[1]);
  const bool = (key: string) => new RegExp(`${key}:\\s*(true|false)`).exec(block)?.[1] === 'true';
  return { title: str('title'), section: str('section'), order: num('order'), draft: bool('draft'), source };
}

describe('manual de uso (§10.7)', () => {
  it('cada slug tiene su archivo MDX y cada archivo MDX está en la lista de slugs', () => {
    expect(listMdxSlugs(contentDir)).toEqual([...helpSlugs].sort());
  });

  it('el registro tiene exactamente las claves de helpSlugs', () => {
    expect(Object.keys(helpRegistry).sort()).toEqual([...helpSlugs].sort());
    for (const key of Object.keys(helpRegistry)) expect(isHelpSlug(key)).toBe(true);
  });

  it('cada entrada tiene sección válida, orden positivo y título', () => {
    for (const [slug, entry] of Object.entries(helpRegistry)) {
      expect(sectionIds, `${slug}: sección`).toContain(entry.meta.section);
      expect(entry.meta.order, `${slug}: order`).toBeGreaterThan(0);
      expect(entry.meta.title.trim().length, `${slug}: título`).toBeGreaterThan(0);
    }
  });

  it('el meta exportado por cada MDX coincide con el registro', () => {
    for (const [slug, entry] of Object.entries(helpRegistry)) {
      const fromFile = readMdxMeta(slug);
      expect(fromFile.title, `${slug}: title`).toBe(entry.meta.title);
      expect(fromFile.section, `${slug}: section`).toBe(entry.meta.section);
      expect(fromFile.order, `${slug}: order`).toBe(entry.meta.order);
      expect(fromFile.draft, `${slug}: draft`).toBe(entry.meta.draft);
    }
  });

  it('las páginas en borrador muestran el banner y la lista "Qué se explicará aquí"; las completas no', () => {
    for (const [slug, entry] of Object.entries(helpRegistry)) {
      const { source } = readMdxMeta(slug);
      const hasBanner = source.includes('<DraftBanner />');
      expect(hasBanner, `${slug}: DraftBanner`).toBe(entry.meta.draft);
      if (entry.meta.draft) {
        expect(source, `${slug}: import DraftBanner`).toContain(
          "import { DraftBanner } from '@/features/help/DraftBanner'",
        );
        expect(source, `${slug}: lista`).toContain('## Qué se explicará aquí');
      }
    }
  });

  it('no hay dos páginas con el mismo orden dentro de una sección', () => {
    const seen = new Set<string>();
    for (const p of listHelpPages()) {
      const key = `${p.meta.section}#${p.meta.order}`;
      expect(seen.has(key), `${p.slug}: orden repetido ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('listHelpPages ordena por sección y luego por orden; prevNext recorre esa lista', () => {
    const pages = listHelpPages();
    expect(pages).toHaveLength(helpSlugs.length);
    expect(pages[0]?.slug).toBe('primeros-pasos');
    expect(pages.at(-1)?.slug).toBe('administracion/padron-de-roles');

    expect(prevNext('primeros-pasos').prev).toBeNull();
    expect(prevNext('primeros-pasos').next?.slug).toBe('mapa/navegacion');
    expect(prevNext('administracion/padron-de-roles').next).toBeNull();

    const { prev, next } = prevNext('capas/campos-unicos');
    expect(prev?.slug).toBe('capas/campos');
    expect(next?.slug).toBe('capas/correlativos');
  });

  it('los enlaces internos del manual apuntan a páginas existentes', () => {
    for (const slug of helpSlugs) {
      const { source } = readMdxMeta(slug);
      for (const m of source.matchAll(/\]\(\/help\/([^)#]+)\)/g)) {
        expect(isHelpSlug(m[1] ?? ''), `${slug} enlaza a /help/${m[1]}`).toBe(true);
      }
    }
  });
});
