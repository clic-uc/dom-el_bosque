'use client';

import { Building2, icons, type LucideProps } from 'lucide-react';
import { DEFAULT_LAYER_ICON_COLOR } from '@/shared/constants';

/** kebab-case ('building-2') → PascalCase ('Building2'), como exporta `lucide-react`. */
export function iconNameToPascal(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

export function getLucideIcon(name: string | null | undefined) {
  if (!name) return Building2;
  const pascal = iconNameToPascal(name);
  const Icon = (icons as Record<string, React.ComponentType<LucideProps>>)[pascal];
  return Icon ?? Building2;
}

type Props = LucideProps & { name: string | null | undefined; color?: string };

/** Ícono de una capa por nombre lucide kebab-case y color (fallback building-2 azul). */
export function LayerIcon({ name, color = DEFAULT_LAYER_ICON_COLOR, ...props }: Props) {
  const Icon = getLucideIcon(name);
  return <Icon color={color} strokeWidth={2} aria-hidden {...props} />;
}
