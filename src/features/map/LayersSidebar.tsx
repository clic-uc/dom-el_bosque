'use client';

import { BookOpen, Eye, MoreHorizontal, PanelLeftClose, Plus, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { Brand } from '@/components/shared/brand';
import { LayerIcon } from '@/components/shared/layer-icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActor, useCan } from '@/features/auth/actor-context';
import { formatInt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { departmentLabels, departments, MAX_OVERLAY_LAYERS, type Department } from '@/shared/constants';
import type { LayerWithCount } from '@/shared/types';

export type LayersSidebarProps = {
  layers: LayerWithCount[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  workingLayerId: number | null;
  overlayLayerIds: number[];
  onSelectWorking: (layerId: number) => void;
  onToggleOverlay: (layerId: number) => void;
  onCreateLayer: (department?: Department) => void;
  onEditLayer: (layer: LayerWithCount) => void;
  onCollapse: () => void;
};

function LayerRow({ layer, isWorking, isOverlay, overlayFull, canEdit, onSelectWorking, onToggleOverlay, onEdit }: { layer: LayerWithCount; isWorking: boolean; isOverlay: boolean; overlayFull: boolean; canEdit: boolean; onSelectWorking: () => void; onToggleOverlay: () => void; onEdit: () => void }) {
  const radioId = `layer-radio-${layer.id}`;
  const overlayDisabled = isWorking || (!isOverlay && overlayFull);
  const overlayTip = isWorking ? 'Es la capa de trabajo: ya se muestra en el mapa' : isOverlay ? 'Dejar de mostrar en el mapa' : overlayFull ? `Ya hay ${MAX_OVERLAY_LAYERS} capas superpuestas; quita una para agregar otra` : 'Mostrar también en el mapa';
  return (
    <li className={cn('group flex min-h-12 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted', isWorking && 'bg-primary-soft hover:bg-primary-soft')}>
      <input
        type="radio"
        id={radioId}
        name="working-layer"
        className="size-5 shrink-0 cursor-pointer accent-primary"
        checked={isWorking}
        onChange={onSelectWorking}
        aria-label={`Trabajar en la capa ${layer.name}`}
      />
      <label htmlFor={radioId} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
        <LayerIcon name={layer.icon} color={layer.iconColor} className="mt-0.5 size-5 shrink-0" />
        <span className="min-w-0">
          <span className={cn('block text-base leading-snug break-words', isWorking && 'font-semibold text-primary-dark')}>{layer.name}</span>
          <span className="block text-sm text-muted-foreground tabular-nums">
            {formatInt(layer.recordCount)} {layer.recordCount === 1 ? 'registro' : 'registros'}
          </span>
        </span>
      </label>
      {isWorking ? (
        <span className="size-11 shrink-0" aria-hidden />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant={isOverlay ? 'secondary' : 'ghost'}
                size="icon-lg"
                className={cn('size-11', !isOverlay && 'text-muted-foreground')}
                onClick={onToggleOverlay}
                disabled={overlayDisabled}
                aria-pressed={isOverlay}
                aria-label={`${isOverlay ? 'Dejar de mostrar' : 'Mostrar también'} ${layer.name} en el mapa`}
              >
                <Eye className="size-5" aria-hidden />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{overlayTip}</TooltipContent>
        </Tooltip>
      )}
      {canEdit ? (
        <Button variant="ghost" size="icon-lg" className="size-11 shrink-0" onClick={onEdit} aria-label={`Editar la capa ${layer.name}`}>
          <MoreHorizontal className="size-5" aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/** Contenido del sidebar "Departamentos y Capas" (§10.2); se usa en el `aside` de escritorio y en el `Sheet` móvil. */
export function LayersSidebarContent(props: LayersSidebarProps) {
  const { layers, isPending, error, onRetry, workingLayerId, overlayLayerIds } = props;
  const can = useCan();
  const actor = useActor();
  const canEdit = can('layers.write');
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

  const byDepartment = useMemo(() => {
    const map = new Map<Department, LayerWithCount[]>();
    for (const d of departments) map.set(d, []);
    for (const l of layers ?? []) map.get(l.department)?.push(l);
    return map;
  }, [layers]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
        <Brand size="sm" />
        <Button variant="ghost" size="icon-lg" className="hidden size-11 lg:inline-flex" onClick={props.onCollapse} aria-label="Ocultar el panel de capas">
          <PanelLeftClose className="size-5" aria-hidden />
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-lg font-semibold">Capas</h2>
        {canEdit ? (
          <Button variant="outline" size="lg" className="h-11 gap-2 px-3" onClick={() => props.onCreateLayer()}>
            <Plus className="size-5" aria-hidden /> Crear capa
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isPending ? (
          <LoadingState rows={6} label="Cargando capas…" />
        ) : error ? (
          <ErrorState title="No se pudieron cargar las capas" onRetry={onRetry} />
        ) : (layers?.length ?? 0) === 0 ? (
          <EmptyState title="Todavía no hay capas" description={canEdit ? 'Crea la primera con el botón “Crear capa”.' : 'Pide a un editor que cree la primera capa.'} />
        ) : (
          <Accordion type="multiple" defaultValue={[...departments]} className="w-full">
            {departments.map((d) => {
              const list = byDepartment.get(d) ?? [];
              return (
                <AccordionItem key={d} value={d}>
                  <AccordionTrigger className="min-h-11 px-2 text-base hover:no-underline">
                    <span className="flex flex-1 items-center justify-between gap-2 pr-2">
                      <span>{departmentLabels[d]}</span>
                      <span className="shrink-0 text-sm font-normal whitespace-nowrap text-muted-foreground">
                        {list.length} {list.length === 1 ? 'capa' : 'capas'}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-2">
                    {list.length === 0 ? (
                      <div className="flex items-center justify-between gap-2 px-2 py-1 text-sm text-muted-foreground">
                        <span>Sin capas</span>
                        {canEdit ? (
                          <Button variant="link" size="sm" className="h-9 px-1 text-sm" onClick={() => props.onCreateLayer(d)}>
                            Crear capa
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <ul className="space-y-0.5">
                        {list.map((layer) => (
                          <LayerRow
                            key={layer.id}
                            layer={layer}
                            isWorking={layer.id === workingLayerId}
                            isOverlay={overlayLayerIds.includes(layer.id)}
                            overlayFull={overlayLayerIds.length >= MAX_OVERLAY_LAYERS}
                            canEdit={canEdit}
                            onSelectWorking={() => props.onSelectWorking(layer.id)}
                            onToggleOverlay={() => props.onToggleOverlay(layer.id)}
                            onEdit={() => props.onEditLayer(layer)}
                          />
                        ))}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}

      </div>

      <footer className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
        <span title="Versión de la plataforma">v{version}</span>
        <div className="flex items-center gap-1">
          <Link href="/help" className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-primary hover:bg-primary-soft">
            <BookOpen className="size-4" aria-hidden /> Manual de uso
          </Link>
          {actor.role === 'admin' ? (
            <Link href="/admin" className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-primary hover:bg-primary-soft">
              <UserCog className="size-4" aria-hidden /> Administración
            </Link>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** Sidebar izquierdo de escritorio (320 px, colapsable) + `Sheet` en pantallas angostas. */
export function LayersSidebar({ collapsed, mobileOpen, onMobileOpenChange, ...props }: LayersSidebarProps & { collapsed: boolean; mobileOpen: boolean; onMobileOpenChange: (open: boolean) => void }) {
  return (
    <>
      <aside className={cn('hidden h-full w-80 shrink-0 border-r bg-background lg:flex lg:flex-col', collapsed && 'lg:hidden')} aria-label="Departamentos y capas">
        <LayersSidebarContent {...props} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-80 p-0 sm:max-w-80" showCloseButton>
          <SheetHeader className="sr-only">
            <SheetTitle>Departamentos y capas</SheetTitle>
            <SheetDescription>Elige la capa de trabajo y las capas superpuestas.</SheetDescription>
          </SheetHeader>
          <LayersSidebarContent {...props} />
        </SheetContent>
      </Sheet>
    </>
  );
}
