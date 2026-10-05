import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * Componentes globales para MDX (requerido por `@next/mdx` en App Router).
 * Estilos de lectura pensados para funcionarios: texto 17 px, interlineado amplio, títulos claros.
 * No se usa `@tailwindcss/typography`; cada elemento recibe sus clases aquí.
 */
function Anchor({ href = '', children, ...rest }: ComponentProps<'a'>) {
  const className = 'font-medium text-primary underline underline-offset-4 hover:text-primary-light';
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

const components: MDXComponents = {
  h1: (props) => <h1 className="mt-10 mb-4 text-3xl font-semibold text-primary-dark" {...props} />,
  h2: (props) => (
    <h2 className="mt-10 mb-3 scroll-mt-24 text-2xl font-semibold text-primary-dark" {...props} />
  ),
  h3: (props) => <h3 className="mt-8 mb-2 scroll-mt-24 text-xl font-semibold text-foreground" {...props} />,
  h4: (props) => <h4 className="mt-6 mb-2 text-lg font-semibold text-foreground" {...props} />,
  p: (props) => <p className="my-4 text-[17px] leading-8 text-foreground" {...props} />,
  ul: (props) => <ul className="my-4 list-disc space-y-2 pl-7 text-[17px] leading-8" {...props} />,
  ol: (props) => <ol className="my-4 list-decimal space-y-2 pl-7 text-[17px] leading-8" {...props} />,
  li: (props) => <li className="pl-1 marker:text-primary" {...props} />,
  a: Anchor,
  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="my-6 rounded-r-md border-l-4 border-secondary bg-secondary-soft px-5 py-3 text-[17px] leading-8 text-foreground [&>p]:my-1"
      {...props}
    />
  ),
  code: (props) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.95em] text-primary-dark" {...props} />
  ),
  pre: (props) => (
    <pre className="my-6 overflow-x-auto rounded-md border bg-muted p-4 text-base leading-7" {...props} />
  ),
  table: (props) => (
    <div className="my-6 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-left text-base" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-muted" {...props} />,
  th: (props) => <th className="border-b px-4 py-3 font-semibold text-foreground" {...props} />,
  td: (props) => <td className="border-b px-4 py-3 align-top leading-7" {...props} />,
  hr: () => <hr className="my-10 border-border" />,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
