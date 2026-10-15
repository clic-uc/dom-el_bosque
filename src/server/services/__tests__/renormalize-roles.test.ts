import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { roles } from '@/db/schema';
import { renormalizeRoleAddresses, searchRoles } from '../roles';
import { createRole, db, setupDbSuite } from './helpers';

setupDbSuite();

describe('renormalizeRoleAddresses', () => {
  it('recalcula la dirección normalizada guardada con una versión anterior, y es idempotente', async () => {
    await createRole('00050-00001', { address: 'NUEVA IMPERIAL 100' });
    await createRole('00050-00002', { address: 'RIQUELME 111' });
    await createRole('00050-00003');
    // Como lo guardaba la normalización anterior, que cortaba la «n» inicial.
    await db
      .update(roles)
      .set({ addressNorm: 'ueva imperial 100', streetNorm: 'ueva imperial' })
      .where(eq(roles.id, '00050-00001'));

    expect(await renormalizeRoleAddresses(db)).toEqual({ total: 2, changed: 1 });
    const [fixed] = await db.select().from(roles).where(eq(roles.id, '00050-00001'));
    expect(fixed).toMatchObject({
      addressNorm: 'nueva imperial 100',
      streetNorm: 'nueva imperial',
      houseNumber: 100,
    });
    expect((await searchRoles(db, 'nueva imperial')).map((r) => r.id)).toContain('00050-00001');

    expect(await renormalizeRoleAddresses(db)).toEqual({ total: 2, changed: 0 });
  });
});
