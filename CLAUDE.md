# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server at http://localhost:3000
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

No test suite is configured yet.

## Stack

- **Next.js 16** with the App Router (`src/app/`)
- **React 19** with the React Compiler enabled (`reactCompiler: true` in `next.config.ts`)
- **Tailwind CSS v4** via PostCSS
- **TypeScript**

## Architecture

This is a freshly bootstrapped `create-next-app` project. All application code lives under `src/app/` using the Next.js App Router conventions:

- `src/app/layout.tsx` — root layout; loads Geist Sans and Geist Mono via `next/font/google`, applies them as CSS variables, and wraps all pages in a flex column body.
- `src/app/page.tsx` — home route (`/`).
- `src/app/globals.css` — global styles (Tailwind base imports go here).

The React Compiler is active, so avoid patterns that break its auto-memoization (manual `useMemo`/`useCallback` wrapping is unnecessary and may conflict).
