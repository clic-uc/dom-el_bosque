/**
 * Crea el primer administrador (§6.1).
 *
 *   pnpm auth:create-admin --email admin@municipalidad.cl --name "Administrador DOM" [--password ...]
 *
 * Si no se pasa --password, la pide por stdin (sin eco cuando hay TTY) o genera una y la imprime una vez.
 * Este usuario NO queda con cambio obligatorio de contraseña.
 */
import './_env';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { eq } from 'drizzle-orm';
import { db, sqlClient } from '@/db/client';
import { users } from '@/db/schema';
import { auth } from '@/server/auth';

function generatePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!#$%&*+-=?';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function askPassword(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Contraseña (vacío = generar una): ');
  rl.close();
  return answer.trim() || null;
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      password: { type: 'string' },
    },
  });
  if (!values.email || !values.name) {
    console.error('Uso: pnpm auth:create-admin --email <correo> --name "<nombre>" [--password <clave>]');
    process.exit(1);
  }
  const email = values.email.trim().toLowerCase();

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.error(`Ya existe un usuario con el correo ${email}.`);
    process.exit(1);
  }

  let password = values.password ?? (await askPassword());
  let generated = false;
  if (!password) {
    password = generatePassword();
    generated = true;
  }
  if (password.length < 10) {
    console.error('La contraseña debe tener al menos 10 caracteres.');
    process.exit(1);
  }

  const created = await auth.api.createUser({
    body: { email, password, name: values.name, role: 'admin', data: { mustChangePassword: false } },
  });

  console.log(`Administrador creado: ${created.user.email} (${created.user.id})`);
  if (generated) {
    console.log('Contraseña generada (se muestra una sola vez):');
    console.log(`  ${password}`);
  }
  await sqlClient.end();
}

main().catch((err) => {
  console.error('No se pudo crear el administrador:', err?.body?.message ?? err);
  process.exit(1);
});
