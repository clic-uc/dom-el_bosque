import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sqlClient } from '@/db/client';
import { auditLogs, roles } from '@/db/schema';
import { renormalizeRoleAddresses, searchRoles } from '../roles';
import { createRole, db, setupDbSuite } from './helpers';

setupDbSuite();

const CLI = { userId: 'cli', email: 'cli@sigdom' };

/** Deja un rol como lo guardaba la normalización anterior, que cortaba la «n» inicial. */
async function breakNorm(id: string) {
  await db
    .update(roles)
    .set({ addressNorm: 'ueva imperial 100', streetNorm: 'ueva imperial', updatedAt: new Date('2020-01-01T00:00:00Z') })
    .where(eq(roles.id, id));
}

describe('renormalizeRoleAddresses', () => {
  it('recalcula la dirección normalizada guardada con una versión anterior, audita una vez y es idempotente', async () => {
    await createRole('00050-00001', { address: 'NUEVA IMPERIAL 100' });
    await createRole('00050-00002', { address: 'RIQUELME 111' });
    await createRole('00050-00003');
    await breakNorm('00050-00001');

    expect(await renormalizeRoleAddresses(db, CLI)).toEqual({ total: 2, changed: 1 });
    const [fixed] = await db.select().from(roles).where(eq(roles.id, '00050-00001'));
    expect(fixed).toMatchObject({
      addressNorm: 'nueva imperial 100',
      streetNorm: 'nueva imperial',
      houseNumber: 100,
    });
    expect(fixed!.updatedAt.getTime()).toBeGreaterThan(new Date('2020-01-02T00:00:00Z').getTime());
    expect((await searchRoles(db, 'nueva imperial')).map((r) => r.id)).toContain('00050-00001');

    const logs = await db.select().from(auditLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: 'cli',
      action: 'UPDATE',
      entityType: 'ROLE',
      entityId: 'padron',
      metadata: { operation: 'renormalize', totalRoles: 2, changedRoles: 1 },
    });

    // Segunda pasada: nada que cambiar, y no deja otra entrada en la auditoría.
    expect(await renormalizeRoleAddresses(db, CLI)).toEqual({ total: 2, changed: 0 });
    expect(await db.select().from(auditLogs)).toHaveLength(1);
  });

  it('con el padrón vacío no hace nada', async () => {
    expect(await renormalizeRoleAddresses(db, CLI)).toEqual({ total: 0, changed: 0 });
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it('no pisa la dirección que una importación cambió mientras recalculaba', async () => {
    await createRole('00050-00001', { address: 'NUEVA IMPERIAL 100' });
    await breakNorm('00050-00001');

    // Una importación del padrón en curso: cambió la dirección (y su normalización) pero aún no confirma.
    const importConn = await sqlClient.reserve();
    try {
      await importConn`BEGIN`;
      await importConn`
        UPDATE roles SET address = 'LOS NOGALES 55', address_norm = 'los nogales 55', street_norm = 'los nogales',
          house_number = 55, updated_at = now()
        WHERE id = '00050-00001'`;

      // El recálculo lee la dirección confirmada (la antigua) y su UPDATE queda esperando el bloqueo de la fila.
      const running = renormalizeRoleAddresses(db, CLI);
      for (let i = 0; i < 100; i++) {
        const [w] = await db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'transactionid'`);
        if (w!.n > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await importConn`COMMIT`;

      expect(await running).toEqual({ total: 1, changed: 0 });
    } finally {
      importConn.release();
    }

    const [row] = await db.select().from(roles).where(eq(roles.id, '00050-00001'));
    expect(row).toMatchObject({ address: 'LOS NOGALES 55', addressNorm: 'los nogales 55', streetNorm: 'los nogales', houseNumber: 55 });
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});
