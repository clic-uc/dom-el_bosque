/**
 * Amplía los tipos de `@types/mdx`: cada página del manual exporta `meta` (§10.7).
 * Este archivo es un "script" (sin import/export de nivel superior) para que la declaración se fusione.
 */
declare module '*.mdx' {
  export const meta: {
    title: string;
    section: string;
    order: number;
    draft: boolean;
  };
}
