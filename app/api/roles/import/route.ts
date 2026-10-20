import { db } from '@/db/client';
import { ConflictError, ValidationError } from '@/server/errors';
import { assertBodySize, json, withActor } from '@/server/http';
import * as rolesService from '@/server/services/roles';
import { capabilities } from '@/shared/capabilities';

const MAX_PADRON_BYTES = 20 * 1024 * 1024;
const TOO_LARGE =
  'El archivo supera el máximo de 20 MB. Divide el padrón en partes o impórtalo desde la línea de comandos (roles:import)';

/** POST /api/roles/import (admin): multipart con campo `file` (CSV del padrón) → BulkImportSummary (§7.4). No en staging. */
export const POST = withActor(
  async ({ req, actor }) => {
    // El CLI `roles:import` usa el mismo servicio: la restricción de staging vive solo en la ruta web.
    if (!capabilities.padronUpload) throw new ConflictError(capabilities.notices.padron ?? 'No disponible en este ambiente.');
    assertBodySize(req, MAX_PADRON_BYTES, TOO_LARGE);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError('Adjunta el archivo CSV del padrón en el campo "file"');
    }
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('Adjunta el archivo CSV del padrón en el campo "file"');
    if (file.size === 0) throw new ValidationError('El archivo está vacío');
    if (file.size > MAX_PADRON_BYTES) throw new ValidationError(TOO_LARGE);
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await rolesService.importRoleCoordinates(db, actor, buffer, { fileName: file.name });
    return json(summary);
  },
  { roles: ['admin'] },
);
