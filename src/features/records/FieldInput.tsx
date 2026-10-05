'use client';

import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { LayerField } from '@/shared/types';

/**
 * Un control por tipo de campo (§10.2): texto → Input, número → Input numérico, Sí/No → Switch, fecha → input date.
 * El valor viaja "crudo" (string | number | boolean | null); `coerceFieldValue` lo convierte al tipo del campo al guardar.
 */
export type FieldValue = string | number | boolean | null;

export function coerceFieldValue(field: LayerField, raw: FieldValue | undefined): unknown {
  if (raw === undefined || raw === null || raw === '') return null;
  switch (field.type) {
    case 'number':
    case 'autonumber': {
      if (typeof raw === 'number') return raw;
      const n = Number(String(raw).replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 'Sí' || raw === 'si' || raw === '1';
    default:
      return typeof raw === 'string' ? raw.trim() : String(raw);
  }
}

/** Valor del registro → valor editable por el control. */
export function toFieldValue(field: LayerField, value: unknown): FieldValue {
  if (value === null || value === undefined) return field.type === 'boolean' ? false : '';
  if (field.type === 'boolean') return value === true || value === 'true';
  if (field.type === 'date') return typeof value === 'string' ? value.slice(0, 10) : '';
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}

type Props = {
  field: LayerField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Tamaño compacto para la edición en línea de la tabla. */
  compact?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

export function FieldInput({ field, value, onChange, id, disabled, className, compact, ...aria }: Props) {
  const h = compact ? 'h-10' : 'h-11';
  if (field.type === 'boolean') {
    const checked = value === true;
    return (
      <div className={cn('flex min-h-11 items-center gap-3', className)}>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={(c) => onChange(c)}
          disabled={disabled}
          className="h-6 w-11 [&_[data-slot=switch-thumb]]:size-5"
          aria-describedby={aria['aria-describedby']}
        />
        <span className="text-base">{checked ? 'Sí' : 'No'}</span>
      </div>
    );
  }
  if (field.type === 'number' || field.type === 'autonumber') {
    return (
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)}
        disabled={disabled}
        placeholder="Sin valor"
        className={cn(h, 'text-base', className)}
        {...aria}
      />
    );
  }
  if (field.type === 'date') {
    return (
      <Input
        id={id}
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(h, 'text-base', className)}
        {...aria}
      />
    );
  }
  return (
    <Input
      id={id}
      type="text"
      value={typeof value === 'string' ? value : value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Sin valor"
      className={cn(h, 'text-base', className)}
      {...aria}
    />
  );
}
