'use client';

import { CircleHelp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { HelpSlug } from '@/shared/help-slugs';

type Props = {
  slug: HelpSlug;
  /** Texto accesible/tooltip. Por defecto "¿Cómo funciona?". */
  label?: string;
  className?: string;
  /** Muestra el texto junto al ícono (para lugares con espacio). */
  withText?: boolean;
};

/** Enlace contextual al manual (§10.7). Abre la página en una pestaña nueva para no perder el trabajo en curso. */
export function HelpLink({ slug, label = '¿Cómo funciona?', className, withText = false }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={`/help/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className={cn(
            'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            className,
          )}
        >
          <CircleHelp className="size-5" aria-hidden />
          {withText ? <span className="text-sm font-medium">{label}</span> : null}
        </a>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
