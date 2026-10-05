/**
 * Autenticación y autorización (§6, aceptación de la Fase 2).
 * Requiere `pnpm e2e:seed --temp` (usuarios admin/editor/viewer/temporal @e2e.test).
 */
import {
  E2E_PASSWORD,
  E2E_TEMP_USER,
  E2E_USERS,
  expect,
  loginAs,
  signIn,
  signOut,
  test,
  uniqueTestIp,
} from './fixtures';

test.describe('sin sesión', () => {
  test('/map redirige al ingreso', async ({ page }) => {
    await page.goto('/map');
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.getByRole('heading', { name: /Ingreso a plataforma/i })).toBeVisible();
  });

  test('una ruta protegida guarda el destino en ?next=', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/\?next=%2Fadmin%2Fusers/);
  });

  test('/api/layers responde 401 JSON', async ({ request }) => {
    const res = await request.get('/api/layers', { headers: { Accept: 'application/json' } });
    expect(res.status()).toBe(401);
    expect(res.headers()['content-type']).toContain('application/json');
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(typeof body.error.message).toBe('string');
  });

  test('el registro público está deshabilitado', async ({ request, baseURL }) => {
    const res = await request.post('/api/auth/sign-up/email', {
      headers: { Origin: baseURL ?? '' },
      data: { email: `intruso-${Date.now()}@e2e.test`, password: 'Clave-super-larga-2026!', name: 'Intruso' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    // Y el usuario no debe poder entrar
    const login = await request.post('/api/auth/sign-in/email', {
      headers: { Origin: baseURL ?? '' },
      data: { email: 'intruso@e2e.test', password: 'Clave-super-larga-2026!' },
    });
    expect(login.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe('ingreso', () => {
  test('con credenciales correctas llega al mapa', async ({ page }) => {
    await loginAs(page, 'editor');
    await expect(page.getByRole('button', { name: `Menú de ${E2E_USERS.editor.name}` })).toBeVisible();
  });

  test('con credenciales incorrectas muestra el error en español', async ({ page }) => {
    await signIn(page, E2E_USERS.viewer.email, 'contraseña-equivocada');
    await expect(page.getByText('Correo o contraseña incorrectos')).toBeVisible();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
  });

  test('respeta ?next= tras ingresar', async ({ page }) => {
    await page.goto('/help');
    await expect(page).toHaveURL(/\?next=%2Fhelp/);
    await signIn(page, E2E_USERS.viewer.email, E2E_PASSWORD);
    await expect(page).toHaveURL(/\/help/);
  });

  test('6 intentos fallidos en un minuto responden 429 (límite de Better Auth)', async ({
    request,
    baseURL,
  }) => {
    const headers = { Origin: baseURL ?? '', 'X-Forwarded-For': uniqueTestIp() };
    const attempt = () =>
      request.post('/api/auth/sign-in/email', {
        headers,
        data: { email: E2E_USERS.viewer.email, password: 'clave-equivocada-123' },
      });
    for (let i = 0; i < 5; i++) {
      const res = await attempt();
      expect(res.status(), `intento ${i + 1}`).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status()).toBe(429);
  });

  test('cerrar sesión vuelve al ingreso y bloquea la API', async ({ page }) => {
    await loginAs(page, 'viewer');
    await signOut(page);
    await expect(page.getByRole('heading', { name: /Ingreso a plataforma/i })).toBeVisible();
    const res = await page.request.get('/api/layers');
    expect(res.status()).toBe(401);
  });
});

test.describe('sesiones guardadas por rol', () => {
  test('el admin ve el panel de administración', async ({ adminPage }) => {
    await adminPage.goto('/admin');
    await expect(adminPage).toHaveURL(/\/admin/);
    await expect(adminPage.getByText('Sin acceso')).toHaveCount(0);
  });

  test('un visor no accede al panel de administración', async ({ viewerPage }) => {
    await viewerPage.goto('/admin');
    await expect(viewerPage.getByText('Sin acceso')).toBeVisible();
    await expect(viewerPage.getByRole('link', { name: 'Volver al mapa' })).toBeVisible();
  });

  test('un visor no puede crear capas por API (403)', async ({ viewerRequest }) => {
    const res = await viewerRequest.post('/api/layers', {
      data: { name: 'Capa prohibida', department: 'edificacion' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  test('un editor lista capas por API', async ({ editorRequest }) => {
    const res = await editorRequest.get('/api/layers');
    expect(res.status()).toBe(200);
    const layers = await res.json();
    expect(Array.isArray(layers)).toBe(true);
    expect(layers.length).toBeGreaterThan(0);
  });

  test('un visor no ve el botón "Crear registro" en el mapa', async ({ editorPage, viewerPage }) => {
    // La UI del mapa la construye otro equipo (fase 4/6): si el botón aún no existe para el editor,
    // el test no puede distinguir "oculto por rol" de "no implementado".
    await editorPage.goto('/map');
    const editorButton = editorPage.getByRole('button', { name: /crear registro/i });
    const implemented = await editorButton
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.fixme(
      !implemented,
      'El botón "Crear registro" todavía no existe en /map (UI pendiente de otra fase)',
    );

    await viewerPage.goto('/map');
    await expect(viewerPage.getByRole('button', { name: `Menú de ${E2E_USERS.viewer.name}` })).toBeVisible();
    await expect(viewerPage.getByRole('button', { name: /crear registro/i })).toHaveCount(0);
  });
});

test.describe('contraseña temporal', () => {
  test('obliga a definir una contraseña propia antes de usar la plataforma', async ({
    page,
    adminRequest,
  }) => {
    const nuevaClave = `Propia-${Date.now()}-ok!`;

    // Preferimos crear un usuario nuevo con la API de administración (si ya existe); si no, usamos
    // el usuario `temporal@e2e.test` que deja `pnpm e2e:seed --temp`.
    let email = E2E_TEMP_USER.email;
    let temporal = E2E_PASSWORD;
    const created = await adminRequest.post('/api/admin/users', {
      data: {
        name: 'Nuevo Temporal',
        email: `temporal-${Date.now()}@e2e.test`,
        password: 'Temporal-2026-xyz!',
        role: 'viewer',
      },
    });
    if (created.status() === 201) {
      const user = await created.json();
      email = user.email;
      temporal = 'Temporal-2026-xyz!';
    } else {
      expect(created.status(), 'POST /api/admin/users no existe aún: se usa temporal@e2e.test').toBe(404);
    }

    await signIn(page, email, temporal);
    await expect(page).toHaveURL(/\/account\/password/);
    await expect(page.getByRole('heading', { name: 'Define tu contraseña' })).toBeVisible();

    // Mientras no la cambie, no accede a nada más
    await page.goto('/map');
    await expect(page).toHaveURL(/\/account\/password/);
    const api = await page.request.get('/api/layers');
    expect(api.status()).toBe(403);
    expect((await api.json()).error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    await page.getByLabel('Contraseña actual').fill(temporal);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(nuevaClave);
    await page.getByLabel('Repite la nueva contraseña').fill(nuevaClave);
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();

    await expect(page).toHaveURL(/\/map(\?|$)/);
    const ok = await page.request.get('/api/layers');
    expect(ok.status()).toBe(200);

    // La nueva contraseña sirve para volver a entrar, directo al mapa
    await signOut(page);
    await signIn(page, email, nuevaClave);
    await expect(page).toHaveURL(/\/map(\?|$)/);

    // Limpieza si el usuario fue creado por API (deja la base como estaba)
    if (created.status() === 201) {
      const user = await created.json();
      const del = await adminRequest.delete(`/api/admin/users/${user.id}`);
      expect([204, 404]).toContain(del.status());
    }
  });
});
