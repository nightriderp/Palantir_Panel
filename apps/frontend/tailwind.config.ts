import type { Config } from 'tailwindcss';

/**
 * Design-Tokens des Arbeitspakets F2 – Shared UI / Design-System (STRUKTUR.md).
 *
 * Die Werte sind aus dem Referenz-Mockup (`docs/mockup/Palantir.dc.html`) abgeleitet,
 * wo Farben, Radien und Schriftgrößen noch als literale Werte im Markup stehen.
 * Ab hier gilt: **kein literaler Farb-/Radius-/Schriftwert mehr in Komponenten** –
 * ausschließlich diese Tokens verwenden, damit F3–F11 dasselbe Bild ergeben.
 *
 * Mobile-First ist Vorgabe aus dem Lastenheft §4; die Breakpoints bleiben deshalb
 * bewusst auf den Tailwind-Standardwerten (`md` = 768px, `lg` = 1024px), die auch
 * das Mockup verwendet.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    /**
     * Vollständig ersetzte Schriftgrößen-Skala. Das Mockup arbeitet mit einer
     * deutlich kompakteren Skala als der Tailwind-Standard – `text-base` ist hier
     * 13px, nicht 16px.
     */
    fontSize: {
      '3xs': ['0.5625rem', { lineHeight: '1.2' }], // 9px  – Ring-Beschriftung
      '2xs': ['0.625rem', { lineHeight: '1.3' }], // 10px – Badges, Sektionslabels
      xs: ['0.6875rem', { lineHeight: '1.4' }], // 11px – Meta-Angaben, Status-Pill
      sm: ['0.75rem', { lineHeight: '1.45' }], // 12px – Sekundärtext
      base: ['0.8125rem', { lineHeight: '1.5' }], // 13px – Standardtext, Buttons
      md: ['0.875rem', { lineHeight: '1.5' }], // 14px
      lg: ['0.9375rem', { lineHeight: '1.45' }], // 15px – Kartentitel
      xl: ['1rem', { lineHeight: '1.4' }], // 16px – Modal-Titel
      '2xl': ['1.125rem', { lineHeight: '1.35' }], // 18px – Kennzahlen
      '3xl': ['1.25rem', { lineHeight: '1.3' }], // 20px – Seitentitel
      '4xl': ['1.5rem', { lineHeight: '1.25' }], // 24px
      '5xl': ['2.25rem', { lineHeight: '1.15' }], // 36px – Login-Headline
    },
    extend: {
      colors: {
        /** Seitenhintergrund. */
        canvas: '#0a0b0f',
        /** Erhabene Flächen: Modals, Popover, Dropdowns, Select-Optionen. */
        surface: {
          DEFAULT: '#1a1c24',
          muted: '#14161d',
          deep: '#12141b',
        },
        /** Textfarben, von kräftig nach zurückhaltend. */
        ink: {
          DEFAULT: '#e8ebf2',
          muted: '#9aa2b2',
          soft: '#7e8696',
          faint: '#6b7283',
          disabled: '#4a505e',
        },
        /** Markenfarbe (Primäraktion, aktive Navigation, Fokus). */
        brand: {
          DEFAULT: '#7c5cff',
          bright: '#9b82ff',
          soft: 'rgba(124,92,255,0.13)',
          line: 'rgba(124,92,255,0.3)',
        },
        /** Zweite Markenfarbe, nur im Verlauf und für RAM-Kennzahlen. */
        accent: '#22d3ee',
        /** Status „läuft" / positiv. */
        success: {
          DEFAULT: '#3ddc84',
          soft: 'rgba(61,220,132,0.12)',
          line: 'rgba(61,220,132,0.3)',
        },
        /** Status „in Arbeit" / Hinweis. */
        warning: {
          DEFAULT: '#fbbf24',
          soft: 'rgba(251,191,36,0.12)',
          line: 'rgba(251,191,36,0.3)',
        },
        /** Status „stoppt" – zwischen Warnung und Gefahr. */
        caution: '#fb923c',
        /** Status „Fehler"/„abgestürzt" und Gefahrenaktionen. */
        danger: {
          DEFAULT: '#ff6b6b',
          soft: 'rgba(255,107,107,0.12)',
          line: 'rgba(255,107,107,0.3)',
        },
        /** Trennlinien und Rahmen. */
        line: {
          DEFAULT: 'rgba(255,255,255,0.07)',
          strong: 'rgba(255,255,255,0.1)',
        },
        /** Dezente Füllflächen (Sekundär-Buttons, Eingabefelder, Chips). */
        fill: {
          DEFAULT: 'rgba(255,255,255,0.03)',
          strong: 'rgba(255,255,255,0.07)',
        },
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px', // Buttons, Eingabefelder
        tile: '11px', // Server-Kachel, Segment-Leiste
        lg: '12px',
        xl: '14px',
        '2xl': '16px', // Karten, Modals
      },
      spacing: {
        4.5: '1.125rem', // 18px
        5.5: '1.375rem', // 22px
      },
      boxShadow: {
        /** Popover, Dropdown, Toast. */
        panel: '0 16px 40px rgba(0,0,0,0.5)',
        /** Modal-Dialog. */
        modal: '0 30px 90px rgba(0,0,0,0.55)',
        /** Primär-Button. */
        brand: '0 4px 18px rgba(124,92,255,0.3)',
      },
      backgroundImage: {
        /** Marken-Verlauf: Logo-Kachel, Primär-Button, Server-Initialen. */
        'brand-gradient': 'linear-gradient(135deg,#7c5cff,#22d3ee)',
        /** Flächenverlauf für Karten und Kennzahlen-Panels. */
        'card-gradient': 'linear-gradient(180deg, rgba(22,24,32,.9), rgba(18,20,27,.9))',
        /** Dezenter Lichtschein hinter dem gesamten Dashboard. */
        'app-glow':
          'radial-gradient(1200px 600px at 80% -10%, rgba(124,92,255,0.10), transparent 60%)',
      },
      keyframes: {
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.45' } },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        materialize: {
          from: { opacity: '0', transform: 'scale(.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        startupSweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        'fade-up': 'fadeUp 0.25s ease',
        materialize: 'materialize 0.18s ease',
        'startup-sweep': 'startupSweep 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
