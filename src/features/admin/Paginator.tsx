'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatInt } from '@/lib/format';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Cómo se llaman los elementos ("usuarios", "registros de auditoría"). */
  noun?: string;
  disabled?: boolean;
};

/** Paginación real con "Mostrando a–b de N" y botones grandes Anterior / Siguiente (§10.3). */
export function Paginator({ page, pageSize, total, onPageChange, noun = 'elementos', disabled = false }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Paginación">
      <p className="text-base text-muted-foreground" aria-live="polite">
        {total === 0 ? `Sin ${noun}` : `Mostrando ${formatInt(from)}–${formatInt(to)} de ${formatInt(total)} ${noun}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 text-base"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden /> Anterior
        </Button>
        <span className="px-2 text-base">
          Página {formatInt(page)} de {formatInt(pages)}
        </span>
        <Button
          type="button"
          variant="outline"
          className="h-11 text-base"
          disabled={disabled || page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Siguiente <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
