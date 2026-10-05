'use client';

import type { RoleDto } from '@/shared/types';

/**
 * CONTRATO (fase 4): input de Rol SII con máscara 00000-00000, validación en vivo y sugerencias
 * de `GET /api/roles?q=` (Combobox). Badge "existente" / "nuevo" / "no vigente".
 * Este archivo es un stub; la implementación real lo reemplaza manteniendo estas props.
 */
export type RoleInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Se llama cuando el valor normalizado corresponde a un rol existente (o null si no existe / inválido). */
  onRoleResolved?: (role: RoleDto | null) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
  'aria-describedby'?: string;
};

export function RoleInput(_props: RoleInputProps) {
  return null;
}
