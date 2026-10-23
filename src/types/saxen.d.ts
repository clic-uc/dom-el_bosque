/** Tipos mínimos de `saxen` (el paquete no trae los suyos): solo lo que usa la lectura de KML. */
declare module 'saxen' {
  type DecodeEntities = (value: string) => string;
  type AttrGetter = () => Record<string, string> | false;

  export class Parser {
    constructor(options?: { proxy?: boolean });
    on(
      event: 'openTag',
      cb: (name: string, attrs: AttrGetter, decode: DecodeEntities, selfClosing: boolean) => void,
    ): this;
    on(event: 'closeTag', cb: (name: string, decode: DecodeEntities, selfClosing: boolean) => void): this;
    on(event: 'text', cb: (value: string, decode: DecodeEntities) => void): this;
    on(event: 'cdata', cb: (value: string) => void): this;
    on(event: 'error' | 'warn', cb: (err: Error) => void): this;
    parse(xml: string): Error | undefined;
  }

  export function decode(value: string): string;
}
