import { db } from '@/db/client';
import { ValidationError } from '@/server/errors';
import { json, withActor } from '@/server/http';
import * as rolesService from '@/server/services/roles';

const MAX_PADRON_BYTES = 20 * 1024 * 1024;

/** POST /api/roles/import (admin): multipart con campo `file` (CSV del padrón) → BulkImportSummary (§7.4). */
export const POST = withActor(
  async ({ req, actor }) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError('Adjunta el archivo CSV del padrón en el campo "file"');
    }
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('Adjunta el archivo CSV del padrón en el campo "file"');
    if (file.size === 0) throw new ValidationError('El archivo está vacío');
    if (file.size > MAX_PADRON_BYTES) {
      throw new ValidationError(
        'El archivo supera el máximo de 20 MB. Divide el padrón en partes o impórtalo desde la línea de comandos (roles:import)',
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await rolesService.importRoleCoordinates(db, actor, buffer, { fileName: file.name });
    return json(summary);
  },
  { roles: ['admin'] },
);
