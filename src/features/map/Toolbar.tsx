'use client';

import { Download, Filter, Map as MapIcon, PanelLeftOpen, Plus, Table2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCan } from '@/features/auth/actor-context';
import { UserMenu } from '@/features/auth/UserMenu';
import { cn } from '@/lib/utils';
import type { GeocodeResult, LayerWithCount, RecordListItem } from '@/shared/types';
import { RecordSearch } from './RecordSearch';
import type { MapView } from './url-state';

type Props = {
  workingLayer: LayerWithCount | null;
  view: MapView;
  query: string;
  activeFilters: number;
  filtersOpen: boolean;
  sidebarCollapsed: boolean;
  onOpenSidebar: () => void;
  onToggleFilters: () => void;
  onQueryChange: (q: string) => void;
  onSelectRecord: (record: RecordListItem) => void;
  onSelectRole: (roleId: string) => void;
  onGoToAddress: (result: GeocodeResult) => void;
  onImport: () => void;
  onExport: () => void;
  onCreate: () => void;
  onViewChange: (view: MapView) => void;
};

/** Barra superior del espacio de trabajo (§10.2). */
export function Toolbar({
  workingLayer,
  view,
  query,
  activeFilters,
  filtersOpen,
  sidebarCollapsed,
  onOpenSidebar,
  onToggleFilters,
  onQueryChange,
  onSelectRecord,
  onSelectRole,
  onGoToAddress,
  onImport,
  onExport,
  onCreate,
  onViewChange,
}: Props) {
  const can = useCan();
  return (
    <header className="z-(--z-index-toolbar) flex h-16 shrink-0 items-center gap-2 border-b bg-background px-3" role="banner">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon-lg" className={cn('size-11', !sidebarCollapsed && 'lg:hidden')} onClick={onOpenSidebar} aria-label="Mostrar departamentos y capas">
            <PanelLeftOpen className="size-5" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Departamentos y capas</TooltipContent>
      </Tooltip>

      <RecordSearch workingLayer={workingLayer} value={query} view={view} onQueryChange={onQueryChange} onSelectRecord={onSelectRecord} onSelectRole={onSelectRole} onGoToAddress={onGoToAddress} className="min-w-56 flex-1" />

      <Button variant={filtersOpen || activeFilters > 0 ? 'secondary' : 'outline'} size="lg" className="h-11 gap-2" onClick={onToggleFilters} disabled={!workingLayer} aria-pressed={filtersOpen} aria-label={activeFilters ? `Filtros (${activeFilters} activos)` : 'Filtros'}>
        <Filter aria-hidden />
        <span className="hidden md:inline">Filtros</span>
        {activeFilters > 0 ? (
          <Badge className="rounded-full bg-primary px-2 text-xs text-white" aria-hidden>
            {activeFilters}
          </Badge>
        ) : null}
      </Button>

      <div className="ml-auto flex items-center gap-2">
        {can('imports.write') ? (
          <Button variant="outline" size="lg" className="h-11 gap-2" onClick={onImport} disabled={!workingLayer} title={workingLayer ? `Importar registros a ${workingLayer.name}` : 'Elige una capa de trabajo'}>
            <Upload aria-hidden /> <span className="hidden 2xl:inline">Importar</span>
          </Button>
        ) : null}
        {can('export') ? (
          <Button variant="outline" size="lg" className="h-11 gap-2" onClick={onExport}>
            <Download aria-hidden /> <span className="hidden 2xl:inline">Exportar</span>
          </Button>
        ) : null}
        {can('records.write') ? (
          <Button size="lg" className="h-11 gap-2" onClick={onCreate} disabled={!workingLayer}>
            <Plus aria-hidden /> Crear registro
          </Button>
        ) : null}
        <div className="flex rounded-md border" role="group" aria-label="Ver los registros en el mapa o en la tabla">
          <Button variant={view === 'map' ? 'secondary' : 'ghost'} size="lg" className="h-11 gap-2 rounded-r-none" onClick={() => onViewChange('map')} aria-pressed={view === 'map'}>
            <MapIcon aria-hidden /> <span className="hidden md:inline">Mapa</span>
          </Button>
          <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="lg" className="h-11 gap-2 rounded-l-none border-l" onClick={() => onViewChange('table')} aria-pressed={view === 'table'}>
            <Table2 aria-hidden /> <span className="hidden md:inline">Tabla</span>
          </Button>
        </div>
        <UserMenu />
      </div>
    </header>
  );
}
