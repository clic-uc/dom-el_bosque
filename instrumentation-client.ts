import { z } from 'zod';

// Corre antes de hidratar y antes de que se cree cualquier esquema: sin esto Zod prueba `new Function`
// y la CSP (sin 'unsafe-eval') lo reporta como violación aunque Zod capture el error.
z.config({ jitless: true });
