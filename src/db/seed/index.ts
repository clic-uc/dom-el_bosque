import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { layers } from '../schema';
import { DEFAULT_LAYER_ICON_COLOR } from '@/shared/constants';
import type { LayerField } from '@/shared/schemas/layers';
import { toFieldKey, uniqueSuffix } from '@/shared/text';
import { LAYER_SEEDS, type LayerSeed } from './layers.seed';

export type SeedSummary = { created: string[]; updated: string[]; unchanged: string[] };

export function buildSeedFields(seed: LayerSeed): LayerField[] {
  const taken: string[] = [];
  return seed.fields.map((label) => {
    const key = uniqueSuffix(toFieldKey(label), taken);
    taken.push(key);
    return { key, label, type: 'string', required: false, options: {} };
  });
}

/**
 * Seed idempotente por `slug` (§11). Solo escribe cuando algo cambió; no toca `uniqueKeys`,
 * `heatmapFieldKey`, `iconColor` ni los campos de una capa que ya existe (los configura la DOM desde la UI).
 */
export async function seedLayers(db: DbOrTx): Promise<SeedSummary> {
  const summary: SeedSummary = { created: [], updated: [], unchanged: [] };

  for (const [index, seed] of LAYER_SEEDS.entries()) {
    const fields = buildSeedFields(seed);
    const addressFieldKey = seed.addressFieldLabel
      ? (fields.find((f) => f.label === seed.addressFieldLabel)?.key ?? null)
      : null;

    const [existing] = await db.select().from(layers).where(eq(layers.slug, seed.slug)).limit(1);

    if (!existing) {
      await db.insert(layers).values({
        slug: seed.slug,
        name: seed.name,
        department: seed.department,
        hasRole: seed.hasRole,
        fields,
        uniqueKeys: [],
        addressFieldKey,
        heatmapFieldKey: null,
        icon: seed.icon,
        iconColor: DEFAULT_LAYER_ICON_COLOR,
        sortOrder: index,
      });
      summary.created.push(seed.slug);
      continue;
    }

    // Para capas existentes solo alineamos metadatos estables; los campos pueden haber sido editados.
    const patch: Partial<typeof layers.$inferInsert> = {};
    if (existing.sortOrder !== index) patch.sortOrder = index;
    if (existing.fields.length === 0 && fields.length > 0) {
      patch.fields = fields;
      if (!existing.addressFieldKey && addressFieldKey) patch.addressFieldKey = addressFieldKey;
    }

    if (Object.keys(patch).length === 0) {
      summary.unchanged.push(seed.slug);
      continue;
    }
    await db.update(layers).set(patch).where(eq(layers.id, existing.id));
    summary.updated.push(seed.slug);
  }

  return summary;
}
