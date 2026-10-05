import { db } from '@/db/client';
import { ValidationError, zodToValidationError } from '@/server/errors';
import { created, json, parseQuery, privateNoStore, withActor } from '@/server/http';
import { listImports } from '@/server/import/service';
import { uploadImport } from '@/server/import/upload';
import { rateLimit, rateLimits } from '@/server/rate-limit';
import { importUploadFieldsSchema, importsQuerySchema } from '@/shared/schemas/imports';

/** `GET /api/imports`: historial paginado (cualquier usuario autenticado; `userId` solo filtra para admin). */
export const GET = withActor(async ({ req, actor }) => {
  const q = parseQuery(req, importsQuerySchema);
  const data = await listImports(db, actor, q);
  return json(data, { headers: privateNoStore });
});

/** `POST /api/imports`: multipart `{ layerId, file }` → `ImportSource` 201. Límite 10 subidas/min por usuario. */
export const POST = withActor(
  async ({ req, actor }) => {
    rateLimit(
      `import-upload:${actor.userId}`,
      rateLimits.importUpload,
      'Subiste muchos archivos seguidos. Espera un minuto e intenta de nuevo.',
    );
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError(
        'El envío no trae un archivo. Elige un archivo .csv o .xlsx e intenta de nuevo.',
      );
    }
    const fields = importUploadFieldsSchema.safeParse({ layerId: form.get('layerId') });
    if (!fields.success) throw zodToValidationError(fields.error);
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('Adjunta un archivo .csv o .xlsx.');
    const source = await uploadImport(db, actor, fields.data.layerId, file);
    return created(source);
  },
  { roles: ['editor', 'admin'] },
);
