/**
 * Celdas de CSV que Excel o LibreOffice leerían como fórmula (`=`, `+`, `-`, `@`, tabulador, retorno de carro)
 * se guardan como texto anteponiendo `'`. Los números negativos simples (`-33.565407`, `-1.234,5`) y el `-`
 * solo, que las planillas usan de relleno, quedan intactos.
 */
export function neutralizeFormula(s: string): string {
  if (s === '' || s === '-') return s;
  const first = s[0];
  if (first === '-') return /^-\d[\d.,]*$/.test(s) ? s : `'${s}`;
  if (first === '=' || first === '+' || first === '@' || first === '\t' || first === '\r') return `'${s}`;
  return s;
}
