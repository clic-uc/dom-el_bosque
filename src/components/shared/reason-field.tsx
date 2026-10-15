'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Mínimo de `reasonSchema` (src/shared/schemas/common.ts). */
const REASON_MIN_LENGTH = 3;

export const isValidReason = (reason: string) => reason.trim().length >= REASON_MIN_LENGTH;

/** Motivo obligatorio para operaciones que quedan en el registro de auditoría (§8.8). */
export function ReasonField({
  id,
  value,
  onChange,
  placeholder = 'Por ejemplo: capa duplicada',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-base">
        Motivo (obligatorio)
      </Label>
      <Input
        id={id}
        className="h-11 text-base"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={500}
        autoComplete="off"
      />
      <p className="text-sm text-muted-foreground">Queda guardado en el registro de auditoría.</p>
    </div>
  );
}
