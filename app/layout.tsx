import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="es-CL">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
