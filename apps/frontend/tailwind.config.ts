import type { Config } from 'tailwindcss';

/**
 * Design-Tokens (Farben, Abstände, Typografie) werden im Arbeitspaket
 * F2 – Shared UI / Design-System ergänzt (siehe STRUKTUR.md).
 * Mobile-First ist Vorgabe aus dem Lastenheft (§4).
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
