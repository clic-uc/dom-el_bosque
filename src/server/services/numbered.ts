import type { NumberedRecordsDetails } from '@/shared/types';
import type { Actor } from '../auth/session';
import { ForbiddenError, ValidationError } from '../errors';
import type { LayerRow } from './_shared';
import { getAutonumberField } from './numbering';

/**
 * Registros con número asignado por la plataforma (§8.8). Misma regla que `deleteRecord`: que un número
 * se pierda (al borrar la capa, quitar el correlativo o revertir una importación) es solo de administrador
 * y con motivo. Los números quedan en el registro de auditoría.
 */

export type NumberedRecordRef = { id: number; number: unknown; year?: unknown };

/** Número (y año, en el correlativo anual) de cada registro, leídos con el correlativo de `layer`. */
export function numberedRefs(
  layer: Pick<LayerRow, 'fields'>,
  rows: { id: number; attributes: Record<string, unknown> }[],
): NumberedRecordRef[] {
  const field = getAutonumberField(layer);
  return rows.map((r) => {
    const ref: NumberedRecordRef = { id: r.id, number: field ? (r.attributes[field.key] ?? null) : null };
    if (field?.reset === 'yearly' && field.yearFieldKey) ref.year = r.attributes[field.yearFieldKey] ?? null;
    return ref;
  });
}

/**
 * Lanza `Forbidden` si quien no es admin intenta que `count` registros pierdan su número, y `Validation`
 * con `details.reasonRequired` si un admin no indicó el motivo (la UI lo pide y reenvía).
 */
export function assertCanDropNumbers(
  actor: Actor,
  count: number,
  reason: string | undefined,
  messages: { forbidden: string; reasonRequired: string },
): void {
  if (count === 0) return;
  if (actor.role !== 'admin') throw new ForbiddenError(messages.forbidden, { count });
  if (!reason) {
    const details: NumberedRecordsDetails = { reasonRequired: true, count };
    throw new ValidationError(messages.reasonRequired, details);
  }
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
