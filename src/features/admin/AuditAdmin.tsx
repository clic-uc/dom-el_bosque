'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HelpLink } from '@/features/help/HelpLink';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { LayerWithCount } from '@/shared/types';
import { AuditLogList } from './AuditLogList';
import { ImportList } from './ImportList';

/** Capas para los selectores de filtro (compartido por logs e importaciones). */
export function useLayerOptions() {
  return useQuery({
    queryKey: queryKeys.layers.list(),
    queryFn: () => api<LayerWithCount[]>('/api/layers'),
    staleTime: 5 * 60_000,
  });
}

/** Auditoría (§10.3): sub-pestañas Logs e Importaciones. `?tab=imports` abre la segunda. */
export function AuditAdmin() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') === 'imports' ? 'imports' : 'logs');

  return (
    <section className="space-y-5">
      <header>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          Auditoría <HelpLink slug="administracion/auditoria" />
        </h2>
        <p className="text-base text-muted-foreground">
          Quién hizo qué y cuándo: cambios en capas, registros, roles, usuarios, polígonos y adjuntos, además del historial de importaciones.
        </p>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-12 w-full max-w-md">
          <TabsTrigger value="logs" className="h-10 text-base">
            Logs
          </TabsTrigger>
          <TabsTrigger value="imports" className="h-10 text-base">
            Importaciones
          </TabsTrigger>
        </TabsList>
        <TabsContent value="logs" className="mt-4">
          <AuditLogList />
        </TabsContent>
        <TabsContent value="imports" className="mt-4">
          <ImportList />
        </TabsContent>
      </Tabs>
    </section>
  );
}
