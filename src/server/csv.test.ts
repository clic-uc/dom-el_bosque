import { describe, expect, it } from 'vitest';
import { neutralizeFormula, restoreFormulaText } from './csv';

const formulas = [
  '=1+1',
  '@SUM(A1)',
  '+56 9 1234 5678',
  '-5 años',
  '- pendiente',
  '=HYPERLINK("http://x")',
  '\t=1',
  '\r=1',
  '  =1+1',
  '\u00a0=1+1',
  ' -5 años',
];
const plain = ['-', '-0', '-1.234,5', '-33.565407', ' -33.565407', '', ' ', 'Calle 1', '12', 'a=b'];

describe('neutralizeFormula', () => {
  it('guarda como texto lo que una planilla leería como fórmula, aunque vaya tras espacios', () => {
    for (const s of formulas) {
      expect(neutralizeFormula(s), JSON.stringify(s)).toBe(`'${s}`);
    }
  });

  it('deja intactos los números negativos, el guion solo y el texto común', () => {
    for (const s of plain) {
      expect(neutralizeFormula(s), JSON.stringify(s)).toBe(s);
    }
  });
});

describe('restoreFormulaText', () => {
  it('quita el apóstrofo que puso la exportación', () => {
    for (const s of [...formulas, ...plain]) {
      expect(restoreFormulaText(neutralizeFormula(s)), JSON.stringify(s)).toBe(s);
    }
  });

  it('deja el apóstrofo que no viene de la exportación', () => {
    for (const s of ["'hola", "'", "''", "'-33.565407", "'-", "'12", "a'=b", "''=1"]) {
      expect(restoreFormulaText(s), JSON.stringify(s)).toBe(s);
    }
  });
});
