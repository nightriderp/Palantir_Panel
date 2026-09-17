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
    // eslint-plugin-react-hooks 7 (mit eslint-config-next 16) bringt die Regeln
    // des React Compilers mit und setzt sie auf `error`. Sie melden Muster, die
    // hier bewusst so gebaut sind (Refs im Render lesen, setState in Effekten
    // nach einem Wiederanlauf): 42 Stellen in 26 Dateien beim Umzug auf Next 16.
    // Bis dahin waren es keine Fehler, und ein Umzug der Laufzeit ist nicht der
    // Ort, 26 Komponenten umzubauen. Deshalb Warnung statt Fehler – sichtbar
    // im Lint, nicht blockierend; `rules-of-hooks` und `exhaustive-deps`
    // bleiben Fehler. Nachziehen als eigenes Paket.
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/globals': 'warn',
    },
  },
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
