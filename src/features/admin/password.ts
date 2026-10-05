/**
 * Contraseña temporal legible (16 caracteres): sin caracteres que se confunden (0/O, 1/l/I) y con al menos
 * una mayúscula, una minúscula, un dígito y un símbolo. Se muestra una sola vez y el usuario deberá cambiarla.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '#$%&*+-=?!';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function pick(alphabet: string, bytes: Uint8Array, i: number): string {
  return alphabet[bytes[i]! % alphabet.length]!;
}

export function generatePassword(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const chars = Array.from({ length }, (_, i) => pick(ALL, bytes, i));
  // garantiza cada tipo en posiciones fijas y luego mezcla
  chars[0] = pick(UPPER, bytes, 0);
  chars[1] = pick(LOWER, bytes, 1);
  chars[2] = pick(DIGITS, bytes, 2);
  chars[3] = pick(SYMBOLS, bytes, 3);
  const order = crypto.getRandomValues(new Uint8Array(length));
  for (let i = length - 1; i > 0; i--) {
    const j = order[i]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
