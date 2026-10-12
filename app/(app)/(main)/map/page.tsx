import type { Metadata } from 'next';
import { MapWorkspace } from '@/features/map/MapWorkspace';

export const metadata: Metadata = { title: 'Mapa' };

/** Vista principal (§10.2). Toda la lógica vive en `MapWorkspace` (cliente); el estado va en la URL. */
export default function MapPage() {
  return (
    <div className="h-app overflow-hidden">
      <MapWorkspace />
    </div>
  );
}
