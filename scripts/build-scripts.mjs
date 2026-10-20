/**
 * Empaqueta los scripts CLI de `scripts/*.ts` a `dist-scripts/*.js` con esbuild (§12.2).
 *
 *   pnpm build:scripts
 *
 * En Docker la etapa `build` ejecuta este script y el `runner` copia `dist-scripts/` como `scripts/`,
 * de modo que `node scripts/migrate.js`, `node scripts/worker.js`, etc. funcionen sin `tsx` ni código fuente.
 * Los alias `@/…` se resuelven con `paths` de tsconfig.json. Salida CommonJS (el package.json no es `type: module`).
 *
 * Externos: `next` (lo trae el standalone y no debe empaquetarse), `pg-native` (opcional de `pg`) y
 * `pino-pretty` (solo desarrollo; en producción pino escribe JSON).
 */
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist-scripts');

// `e2e-seed-users` no va en la imagen: la CI lo corre con tsx.
const scripts = ['migrate', 'seed', 'geo-import', 'import-roles', 'create-admin', 'worker'];

await rm(outdir, { recursive: true, force: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: Object.fromEntries(scripts.map((s) => [s, path.join(root, 'scripts', `${s}.ts`)])),
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  tsconfig: path.join(root, 'tsconfig.json'),
  external: ['next', 'next/*', 'pg-native', 'pino-pretty'],
  define: { 'process.env.SIGDOM_BUNDLED': '"1"' },
  logLevel: 'info',
  metafile: true,
});

for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  if (!file.endsWith('.js')) continue;
  process.stdout.write(`  ${path.relative(root, file)}  ${(meta.bytes / 1024).toFixed(0)} KB
`);
}
process.stdout.write(`Scripts empaquetados en ${path.relative(root, outdir)}/
`);
