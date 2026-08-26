import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Testlauf des Frontends.
 *
 * Geprüft wird die reine Logik (Filter, Reiter-Freigabe, Wizard-Schritte,
 * Konsolenpuffer) – dafür genügt die Node-Umgebung. Für das Rendern von
 * Komponenten wäre zusätzlich eine DOM-Umgebung nötig; die kommt erst, wenn ein
 * Arbeitspaket sie wirklich braucht.
 *
 * Der Alias `@/` entspricht dem aus `tsconfig.json`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
