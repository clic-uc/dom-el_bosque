/**
 * Proyecto `setup` de Playwright: inicia sesión con cada rol y guarda el estado (cookies) en e2e/.auth/<rol>.json.
 * Los proyectos de tests dependen de este y reutilizan las sesiones mediante e2e/fixtures.ts.
 * Requiere los usuarios de `pnpm e2e:seed --temp`.
 */
import { mkdir } from 'node:fs/promises';
import { AUTH_DIR, authFile, establishSession, test as setup, type E2ERole } from './fixtures';

const roles: E2ERole[] = ['admin', 'editor', 'viewer'];

setup.beforeAll(async () => {
  await mkdir(AUTH_DIR, { recursive: true });
});

for (const role of roles) {
  setup(`sesión de ${role}`, async ({ page }) => {
    await establishSession(page, role);
    await page.context().storageState({ path: authFile(role) });
  });
}
