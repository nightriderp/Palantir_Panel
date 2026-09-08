import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      // Erzeugt von Next und ausdrücklich als „should not be edited" markiert –
      // jeder Build schreibt sie neu. Ihre `/// <reference path=…>`-Zeile
      // verstößt gegen `@typescript-eslint/triple-slash-reference`, und die
      // Meldung wäre nicht behebbar (Fundpunkt 165).
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Konfigurationsdateien liest ihr Werkzeug, importiert wird keine von ihnen.
    // `import/no-anonymous-default-export` will einen benannten Export, damit
    // der Aufrufer beim Importieren einen Namen sieht – hier gibt es keinen
    // Aufrufer, der Name bliebe unbenutzt. Nur diese eine Regel und nur für
    // diese Dateien, kein pauschales `eslint-disable`.
    files: ['*.config.{js,mjs,ts}'],
    rules: {
      'import/no-anonymous-default-export': 'off',
    },
  },
];
