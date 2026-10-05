import Image from 'next/image';
import { cn } from '@/lib/utils';

/** Logo + nombre de la plataforma. */
export function Brand({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const px = size === 'lg' ? 72 : size === 'md' ? 44 : 32;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Image src="/logo_el_bosque.png" alt="Municipalidad de El Bosque" width={px} height={px} className="rounded-sm" priority />
      <div className="leading-tight">
        <p className={cn('font-semibold text-primary-dark', size === 'lg' ? 'text-xl' : 'text-base')}>SIGDOM El Bosque</p>
        <p className={cn('text-muted-foreground', size === 'lg' ? 'text-sm' : 'text-xs')}>Georreferenciación DOM</p>
      </div>
    </div>
  );
}
