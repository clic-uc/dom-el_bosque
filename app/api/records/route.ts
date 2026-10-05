import { db } from '@/db/client';
import { created, parseBody, withActor } from '@/server/http';
import * as recordsService from '@/server/services/records';
import { createRecordSchema } from '@/shared/schemas/records';

/** POST /api/records (editor/admin) → RecordDetail 201 (§7.3). */
export const POST = withActor(
  async ({ req, actor }) => {
    const input = await parseBody(req, createRecordSchema);
    const record = await recordsService.createRecord(db, actor, input);
    return created(record);
  },
  { roles: ['editor', 'admin'] },
);
