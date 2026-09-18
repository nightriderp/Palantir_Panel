import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Testlauf des Frontends.
 *
 * Zwei Arten von Tests, bewusst getrennt:
 *
 * - `*.test.ts` – reine Logik (Filter, Reiter-Freigabe, Wizard-Schritte,
 *   Konsolenpuffer, Formatierungen). Läuft in der Node-Umgebung.
 * - `*.test.tsx` – gerenderte Komponenten mit Testing Library. Läuft in jsdom.
 *
 * Die DOM-Umgebung greift nur für `.tsx`, damit die vielen Logiktests nicht
 * jedes Mal einen jsdom-Aufbau bezahlen müssen (Arbeitspaket R4, „Gefundene
 * Punkte“ 30). Seit Vitest 4 sind das zwei Projekte in einer Konfiguration
 * (`test.projects`); `environmentMatchGlobs` gibt es nicht mehr. Beide erben
 * Alias, JSX-Umsetzung und Setup-Datei von hier (`extends: true`).
 *
 * `esbuild.jsx` ist nötig, weil die `tsconfig.json` für Next.js `preserve`
 * setzt: der Compiler von Next kümmert sich sonst um JSX, im Testlauf gibt es
 * ihn aber nicht. Deshalb hier die automatische Umsetzung – das erspart eine
 * zusätzliche Abhängigkeit (`@vitejs/plugin-react`), die nur für React Refresh
 * im Browser gut wäre.
 *
 * Der Alias `@/` entspricht dem aus `tsconfig.json`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'logik', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: ['src/**/*.test.tsx'] },
      },
    ],
  },
});
