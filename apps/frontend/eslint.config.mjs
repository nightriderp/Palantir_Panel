import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

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
  // Seit eslint-config-next 16 als Flat-Config exportiert – kein FlatCompat mehr.
  ...coreWebVitals,
  ...nextTypescript,
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
