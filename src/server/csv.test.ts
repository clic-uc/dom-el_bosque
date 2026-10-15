import { describe, expect, it } from 'vitest';
import { neutralizeFormula } from './csv';

describe('neutralizeFormula', () => {
  it('guarda como texto lo que una planilla leería como fórmula', () => {
    for (const s of [
      '=1+1',
      '@SUM(A1)',
      '+56 9 1234 5678',
      '-5 años',
      '=HYPERLINK("http://x")',
      '\t=1',
      '\r=1',
    ]) {
      expect(neutralizeFormula(s), JSON.stringify(s)).toBe(`'${s}`);
    }
  });

  it('deja intactos los números negativos, el guion solo y el texto común', () => {
    for (const s of ['-', '-0', '-1.234,5', '-33.565407', '', 'Calle 1', '12', 'a=b']) {
      expect(neutralizeFormula(s), JSON.stringify(s)).toBe(s);
    }
  });
});
