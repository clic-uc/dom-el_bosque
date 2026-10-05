/**
 * Fixtures y helpers compartidos por los tests e2e (§12.5).
 *
 * Usuarios de prueba: los crea `pnpm e2e:seed --temp` (scripts/e2e-seed-users.ts). Las sesiones por rol las
 * guarda e2e/global.setup.ts en e2e/.auth/<rol>.json; aquí se exponen como páginas ya autenticadas
 * (`adminPage`, `editorPage`, `viewerPage`) y como `request` contexts (`adminRequest`, …).
 */
import {
  test as base,
  expect,
  request,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test';
import path from 'node:path';

export type E2ERole = 'admin' | 'editor' | 'viewer';

export const E2E_PASSWORD = 'Sigdom-e2e-2026!';

export const E2E_USERS: Record<E2ERole, { email: string; name: string }> = {
  admin: { email: 'admin@e2e.test', name: 'Admin E2E' },
  editor: { email: 'editor@e2e.test', name: 'Editor E2E' },
  viewer: { email: 'viewer@e2e.test', name: 'Visor E2E' },
};

/** Usuario con contraseña temporal (must_change_password = true), creado por `pnpm e2e:seed --temp`. */
export const E2E_TEMP_USER = { email: 'temporal@e2e.test', name: 'Temporal E2E' };

export const AUTH_DIR = path.join(__dirname, '.auth');

/**
 * Better Auth limita el inicio de sesión a 5 intentos por minuto por IP (§6.1) y toma la IP de `X-Forwarded-For`.
 * Para que la suite no se bloquee a sí misma, cada contexto usa una IP de prueba distinta. En producción Caddy
 * reemplaza esta cabecera por la IP real del cliente, así que esto solo surte efecto contra la app directa.
 */
export function uniqueTestIp(): string {
  const b = () => Math.floor(Math.random() * 254) + 1;
  return `10.${b()}.${b()}.${b()}`;
}

export function authFile(role: E2ERole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/** Inicia sesión por el formulario de ingreso (§10.1). No asume a dónde redirige después. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

/** Inicia sesión con uno de los usuarios e2e y espera llegar al mapa. */
export async function loginAs(page: Page, role: E2ERole): Promise<void> {
  await signIn(page, E2E_USERS[role].email, E2E_PASSWORD);
  await expect(page).toHaveURL(/\/map(\?|$)/);
}

/**
 * Solo obtiene la cookie de sesión (para el proyecto `setup`): espera la respuesta 200 de Better Auth sin
 * depender de que la pantalla de destino renderice. La redirección a /map se prueba en e2e/auth.spec.ts.
 */
export async function establishSession(page: Page, role: E2ERole): Promise<void> {
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/auth/sign-in/email') && r.request().method() === 'POST',
  );
  await signIn(page, E2E_USERS[role].email, E2E_PASSWORD);
  expect((await response).status(), `inicio de sesión de ${role}`).toBe(200);
}

/** Cierra sesión desde el menú de usuario (§10.4). */
export async function signOut(page: Page): Promise<void> {
  // En /map la hidratación puede llegar después del primer clic: reintentamos hasta que el menú abra.
  const item = page.getByRole('menuitem', { name: 'Cerrar sesión' });
  for (let attempt = 0; attempt < 5 && !(await item.isVisible().catch(() => false)); attempt++) {
    await page.getByRole('button', { name: /^Menú de / }).click();
    await item.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  }
  await item.click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
}

async function pageFor(browser: Browser, role: E2ERole, provide: (page: Page) => Promise<void>) {
  const context = await browser.newContext({
    storageState: authFile(role),
    extraHTTPHeaders: { 'X-Forwarded-For': uniqueTestIp() },
  });
  const page = await context.newPage();
  await provide(page);
  await context.close();
}

async function requestFor(
  baseURL: string | undefined,
  role: E2ERole,
  provide: (ctx: APIRequestContext) => Promise<void>,
) {
  const ctx = await request.newContext({
    baseURL,
    storageState: authFile(role),
    // Better Auth exige un Origin coherente con BETTER_AUTH_URL en las peticiones POST.
    extraHTTPHeaders: { 'X-Forwarded-For': uniqueTestIp(), ...(baseURL ? { Origin: baseURL } : {}) },
  });
  await provide(ctx);
  await ctx.dispose();
}

type RoleFixtures = {
  adminPage: Page;
  editorPage: Page;
  viewerPage: Page;
  adminRequest: APIRequestContext;
  editorRequest: APIRequestContext;
  viewerRequest: APIRequestContext;
};

export const test = base.extend<RoleFixtures>({
  // IP de prueba distinta por test (ver uniqueTestIp). Aplica al contexto del navegador y a `page.request`.
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ 'X-Forwarded-For': uniqueTestIp() });
  },
  adminPage: ({ browser }, use) => pageFor(browser, 'admin', use),
  editorPage: ({ browser }, use) => pageFor(browser, 'editor', use),
  viewerPage: ({ browser }, use) => pageFor(browser, 'viewer', use),
  adminRequest: ({ baseURL }, use) => requestFor(baseURL, 'admin', use),
  editorRequest: ({ baseURL }, use) => requestFor(baseURL, 'editor', use),
  viewerRequest: ({ baseURL }, use) => requestFor(baseURL, 'viewer', use),
});

export { expect };
