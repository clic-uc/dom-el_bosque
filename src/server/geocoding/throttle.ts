/**
 * Límite de 1 petición por segundo hacia proveedores externos (§8.7), compartido por proceso.
 * La cola `import.geocode-external` corre con concurrencia 1 en el worker, así que en todo el sistema
 * hay a lo más una petición en curso por proceso; en la app las peticiones puntuales también pasan por aquí.
 */
export class Throttle {
  private last = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  wait(): Promise<void> {
    const next = this.chain.then(async () => {
      const now = Date.now();
      const delay = Math.max(0, this.last + this.minIntervalMs - now);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      this.last = Date.now();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Solo para tests. */
  reset(): void {
    this.last = 0;
    this.chain = Promise.resolve();
  }
}

export const externalThrottle = new Throttle(1000);
