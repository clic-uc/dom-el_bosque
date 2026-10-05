import { db } from '@/db/client';
import { parseParams, withActor } from '@/server/http';
import * as attachmentsService from '@/server/services/attachments';
import { uuidParamSchema } from '@/shared/schemas/common';

/** Nombre seguro para el parámetro filename (ASCII); el nombre real va en filename* (UTF-8, RFC 5987). */
function asciiFileName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return ascii.trim() || 'archivo';
}

/** GET descarga del archivo con Content-Disposition: attachment y el mimeType guardado. */
export const GET = withActor<{ id: string }>(async ({ params }) => {
  const id = parseParams(params.id, uuidParamSchema);
  const { row, stream } = await attachmentsService.getDownload(db, id);
  const fileName = row.fileName ?? row.title;
  const headers = new Headers({
    'Content-Type': row.mimeType ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${asciiFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (row.sizeBytes) headers.set('Content-Length', String(row.sizeBytes));
  return new Response(stream, { status: 200, headers });
});
