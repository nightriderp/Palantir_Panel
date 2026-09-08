// Zentrale ESLint-Flat-Config für das gesamte Monorepo.
// Einzelne Workspaces erweitern diese Datei bei Bedarf (z. B. Next.js in apps/frontend).
//
// Wer prüft die Wurzel selbst? `pnpm lint` ist `turbo run lint` und geht nur
// über die Workspace-Pakete – diese Datei gehört zu keinem davon und lief
// deshalb in keinem Lauf mit (Fundpunkt 165). Das Wurzel-Skript ruft ESLint
// jetzt zusätzlich direkt auf den Dateien der obersten Ebene auf, bevor es an
// Turbo übergibt.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `any` ist laut CLAUDE.md §4 nur mit Begründung im Kommentar erlaubt –
      // die Regel bleibt daher als Warnung aktiv statt abgeschaltet.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': 'off',
    },
  },
  {
    // Reine Node-Skripte (`.mjs`). Sie laufen ohne Bundler und ohne TypeScript
    // direkt in Node, benutzen also `process`, `Buffer`, `console`, `setTimeout`,
    // `URL` und `fetch` als vorhandene Globals. ESLint weiß davon nur, wenn die
    // Umgebung benannt ist – ohne diesen Abschnitt meldet `no-undef` jede dieser
    // Stellen als undefiniert (83 Treffer über alle `.mjs`-Dateien). Genau
    // deshalb hatten `images/*` und `scripts` bisher gar kein `lint`-Skript:
    // Die Lücke bestand von Anfang an, sie fiel nur nie auf (Fundpunkt 143).
    //
    // `globals.node` statt einer selbst gepflegten Liste: Eine handgeschriebene
    // Aufzählung rostet still vor sich hin – das erste `setInterval` in einem
    // neuen Skript ließe den Lint mit einer irreführenden Meldung scheitern.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettier,
);
