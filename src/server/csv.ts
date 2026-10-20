/**
 * ¿Una planilla leería esta celda como fórmula? Sí si empieza con `=`, `+`, `-`, `@`, tabulador o retorno de
 * carro, aunque vaya precedida de espacios (Excel los ignora). Los números negativos simples (`-33.565407`,
 * `-1.234,5`) y el `-` solo, que las planillas usan de relleno, no cuentan.
 */
function readAsFormula(s: string): boolean {
  if (s[0] === '\t' || s[0] === '\r') return true;
  const t = s.trimStart();
  if (t === '' || t === '-') return false;
  if (t[0] === '-') return !/^-\d[\d.,]*$/.test(t);
  return t[0] === '=' || t[0] === '+' || t[0] === '@';
}

/**
 * Celdas de CSV que Excel o LibreOffice leerían como fórmula se guardan como texto anteponiendo `'`.
 * `restoreFormulaText` deshace el cambio al importar.
 */
export function neutralizeFormula(s: string): string {
  return readAsFormula(s) ? `'${s}` : s;
}

/**
 * Inverso de `neutralizeFormula` para la importación: quita el `'` que puso la exportación (Excel y LibreOffice
 * lo conservan al guardar el CSV). Solo lo quita si lo que sigue es algo que la exportación habría marcado; un
 * `'hola` escrito por el usuario queda igual.
 */
export function restoreFormulaText(s: string): string {
  return s[0] === "'" && readAsFormula(s.slice(1)) ? s.slice(1) : s;
}
