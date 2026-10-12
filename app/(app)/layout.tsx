import { redirect } from 'next/navigation';
import { Providers } from '@/app/providers';
import { STAGING_BANNER_HEIGHT, StagingBanner } from '@/components/shared/staging-banner';
import { ActorProvider } from '@/features/auth/actor-context';
import { getOptionalActor } from '@/server/auth/session';
import { capabilities } from '@/shared/capabilities';
import type { CurrentUser } from '@/shared/types';

/**
 * Shell autenticado (§10.4): valida la sesión en servidor. El cambio obligatorio de contraseña se exige en `(main)`.
 * En staging muestra el aviso de ambiente de pruebas y publica su alto en `--app-banner-h`.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getOptionalActor();
  if (!actor) redirect('/');

  const current: CurrentUser = {
    id: actor.userId,
    name: actor.name,
    email: actor.email,
    role: actor.rawRole,
    mustChangePassword: actor.mustChangePassword,
  };

  const showBanner = !!capabilities.notices.banner;
  return (
    <Providers>
      <ActorProvider actor={current}>
        {showBanner ? (
          <div style={{ '--app-banner-h': STAGING_BANNER_HEIGHT } as React.CSSProperties}>
            <StagingBanner />
            {children}
          </div>
        ) : (
          children
        )}
      </ActorProvider>
    </Providers>
  );
}
