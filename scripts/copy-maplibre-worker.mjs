/**
 * Copia el worker de MapLibre a `public/` para servirlo desde la misma origen (§2, CSP `worker-src 'self'`).
 * Turbopack no puede resolver la URL del worker desde `import.meta.url`, así que `MapView` la fija con
 * `setWorkerUrl('/maplibre-gl-worker.mjs')`. Se ejecuta en `predev` y `prebuild` para mantenerlo en sintonía
 * con la versión instalada del paquete.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('maplibre-gl/package.json'));
// El worker es un módulo ES que importa `./maplibre-gl-shared.mjs`: van los dos.
const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];
mkdirSync(path.resolve('public'), { recursive: true });
for (const f of files) copyFileSync(path.join(pkgDir, 'dist', f), path.resolve('public', f));
console.log(`Worker de MapLibre copiado a public/ (${files.join(', ')})`);
