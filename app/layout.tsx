import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible_Mono, Lexend } from 'next/font/google';
import './globals.css';

/** Lexend para leer con fluidez; Atkinson Mono (cero tachado, 1/l/I distintos) solo para roles y códigos. */
const sans = Lexend({ subsets: ['latin', 'latin-ext'], variable: '--font-lexend' });
const mono = Atkinson_Hyperlegible_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-atkinson-mono' });

export const metadata: Metadata = {
  title: {
    default: 'SIGDOM El Bosque',
    template: '%s · SIGDOM El Bosque',
  },
  description: 'Georreferenciación DOM — Dirección de Obras Municipales, Municipalidad de El Bosque',
  icons: { icon: '/logo_el_bosque.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#73308a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
