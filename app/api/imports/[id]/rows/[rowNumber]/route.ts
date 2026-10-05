import { z } from 'zod';
import { db } from '@/db/client';
import { json, parseBody, parseParams, withActor } from '@/server/http';
import { patchRow } from '@/server/import/review';
import { uuidParamSchema } from '@/shared/schemas/common';
import { importRowPatchSchema } from '@/shared/schemas/imports';

const rowNumberSchema = z.coerce.number().int().positive();

/** `PATCH /api/imports/:id/rows/:rowNumber`: corregir, resolver, excluir o fijar ubicación de una fila. */
export const PATCH = withActor<{ id: string; rowNumber: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    const rowNumber = parseParams(params.rowNumber, rowNumberSchema);
    const patch = await parseBody(req, importRowPatchSchema);
    const row = await patchRow(db, actor, id, rowNumber, patch);
    return json(row);
  },
  { roles: ['editor', 'admin'] },
);
