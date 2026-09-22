import type { Config } from 'tailwindcss';

/**
 * Design-Tokens des Arbeitspakets F2 – Shared UI / Design-System (STRUKTUR.md).
 *
 * Die Werte sind aus dem Referenz-Mockup (`docs/mockup/Palantir.dc.html`) abgeleitet,
 * wo Farben, Radien und Schriftgrößen noch als literale Werte im Markup stehen.
 * Ab hier gilt: **kein literaler Farb-/Radius-/Schriftwert mehr in Komponenten** –
 * ausschließlich diese Tokens verwenden, damit F3–F11 dasselbe Bild ergeben.
 *
 * **Farben stehen seit der Theme-Umstellung nicht mehr hier.** Sie führen auf
 * CSS-Variablen; die Werte liegen in `src/lib/theme/palette.ts`, je wählbarem
 * Theme ein Satz. Diese Datei legt damit nur noch fest, *welche* Farbstellen es
 * gibt und wie sie heißen – nicht mehr, wie sie aussehen. Radien, Abstände und
 * Schriftgrößen bleiben unverändert hier: Sie sind Struktur, nicht Anstrich,
 * und ein Theme, das sie verstellte, würde die Oberfläche nicht einfärben,
 * sondern verrücken.
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
        /**
         * Jede Farbe führt auf eine CSS-Variable, keine auf einen Wert.
         *
         * Die Werte stehen in `src/lib/theme/palette.ts` – je Theme ein Satz,
         * alle Sätze zugleich im Dokument, wirksam wird einer über `data-theme`
         * am `<html>`-Element. Für die Komponenten ändert sich dadurch nichts:
         * Sie schreiben weiter `bg-canvas` und `text-ink`.
         *
         * ⚠️ **Die Schreibweise ist Pflicht, nicht Geschmack.** Tailwind hängt
         * den Alpha-Wert einer Klasse wie `bg-surface/95` an, indem es
         * `<alpha-value>` ersetzt; dafür muss die Variable die drei Kanäle
         * **ohne** Klammer tragen (`26 28 36`). Ein `#1a1c24` oder ein
         * fertiges `rgb(...)` in der Variablen ergäbe eine ungültige Angabe –
         * und Tailwind ließe die Klasse still weg.
         */

        /** Seitenhintergrund. */
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        /** Erhabene Flächen: Modals, Popover, Dropdowns, Select-Optionen. */
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          muted: 'rgb(var(--c-surface-muted) / <alpha-value>)',
          deep: 'rgb(var(--c-surface-deep) / <alpha-value>)',
          /**
           * Grund der Live-Konsole – dunkler als jede Karte, damit das
           * Terminalfenster sich von der Seite absetzt.
           */
          console: 'rgb(var(--c-surface-console) / <alpha-value>)',
        },
        /**
         * Die drei Ampelpunkte in der Titelzeile der Konsole.
         *
         * Bewusst die bekannten Fensterfarben und keine Statusfarben des
         * Panels: Sie sagen „hier ist ein Terminal", nicht „hier ist ein
         * Fehler". Rot aus `danger` zu nehmen hiesse, dass ein ruhender
         * Konsolenkasten dauerhaft eine Störung anzeigt.
         *
         * ⚠️ **Die einzigen Farben, die kein Theme ändert** – und zwar aus
         * demselben Grund: Sie zitieren ein Fenster. Ein Theme, das sie
         * einfärbt, nimmt ihnen genau die Aussage, für die sie hier stehen.
         * Sie sind deshalb literal geblieben, wo alles andere auf eine
         * Variable zeigt.
         */
        terminal: {
          close: '#ff5f57',
          minimize: '#febc2e',
          zoom: '#28c840',
        },
        /**
         * Textfarben, von kräftig nach zurückhaltend.
         *
         * Vier Stufen mit fallendem Gewicht: `DEFAULT` trägt den Haupttext,
         * `muted` den Sekundärtext, `soft` Abschnittslabels, `faint`
         * Zeitstempel, Größen und Hinweise. `disabled` steht außerhalb der
         * Rampe – Inaktives darf als Einziges unter 4,5:1 liegen.
         *
         * Dass die vier Stufen lesbar **und** voneinander unterscheidbar
         * bleiben, ist keine Frage des guten Willens mehr: `farbtokens.test.tsx`
         * rechnet Kontrast und Abstand für **jedes** Theme nach. Womit die
         * Stufen im Standard besetzt sind und warum gerade so, steht bei den
         * Werten in `src/lib/theme/palette.ts`.
         */
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          soft: 'rgb(var(--c-ink-soft) / <alpha-value>)',
          faint: 'rgb(var(--c-ink-faint) / <alpha-value>)',
          disabled: 'rgb(var(--c-ink-disabled) / <alpha-value>)',
        },
        /**
         * Markenfarbe (Primäraktion, aktive Navigation, Fokus).
         *
         * `soft` und `line` sind keine eigenen Farben, sondern dieselbe mit
         * 13 % bzw. 30 % Deckkraft – vorher als ausgeschriebenes `rgba()`
         * hinterlegt, was bei jeder Änderung der Markenfarbe zweimal
         * nachgezogen werden musste (und bei einem Theme dreimal je Theme).
         * Jetzt folgen sie ihr von selbst.
         */
        brand: {
          DEFAULT: 'rgb(var(--c-brand) / <alpha-value>)',
          bright: 'rgb(var(--c-brand-bright) / <alpha-value>)',
          soft: 'rgb(var(--c-brand) / 0.13)',
          line: 'rgb(var(--c-brand) / 0.3)',
        },
        /** Zweite Markenfarbe, nur im Verlauf und für RAM-Kennzahlen. */
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        /** Status „läuft" / positiv. */
        success: {
          DEFAULT: 'rgb(var(--c-success) / <alpha-value>)',
          soft: 'rgb(var(--c-success) / 0.12)',
          line: 'rgb(var(--c-success) / 0.3)',
        },
        /** Status „in Arbeit" / Hinweis. */
        warning: {
          DEFAULT: 'rgb(var(--c-warning) / <alpha-value>)',
          soft: 'rgb(var(--c-warning) / 0.12)',
          line: 'rgb(var(--c-warning) / 0.3)',
        },
        /** Status „stoppt" – zwischen Warnung und Gefahr. */
        caution: 'rgb(var(--c-caution) / <alpha-value>)',
        /** Status „Fehler"/„abgestürzt" und Gefahrenaktionen. */
        danger: {
          DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)',
          soft: 'rgb(var(--c-danger) / 0.12)',
          line: 'rgb(var(--c-danger) / 0.3)',
        },
        /**
         * Die Grundfarbe aller Auflagen – **selten direkt zu verwenden**.
         *
         * Trennlinien (`line`) und dezente Füllflächen (`fill`) sind nichts
         * als diese Farbe mit wenigen Prozent Deckkraft. Gedacht ist sie
         * deshalb für die beiden darunter; als Klasse steht sie nur dort, wo
         * eine Auflage ausdrücklich kräftiger sein soll als die Stufen
         * hergeben (`border-overlay/60` in der Tabelle der Verwaltung).
         *
         * Auf dunklem Grund ist sie weiß, auf hellem müsste sie schwarz sein.
         * Genau dafür ist sie eine Variable: Stünde hier fest Weiß, wäre jedes
         * helle Theme ausgeschlossen – weiße Haarlinien auf weißer Karte sind
         * keine.
         */
        overlay: 'rgb(var(--c-overlay) / <alpha-value>)',
        /** Trennlinien und Rahmen. */
        line: {
          DEFAULT: 'rgb(var(--c-overlay) / 0.07)',
          strong: 'rgb(var(--c-overlay) / 0.1)',
        },
        /**
         * Dezente Füllflächen (Sekundär-Buttons, Eingabefelder, Chips).
         *
         * 4 % statt vormals 3 %: Bei 67 Verwendungen ist das die häufigste
         * Fläche der Oberfläche überhaupt, und mit 3 % hob sie sich auf einer
         * Karte praktisch nicht mehr von ihr ab – ein Chip sah aus wie Text
         * mit Rahmen. hafenmeister führt denselben Wert (`elev`) bei 4 %; ein
         * Prozentpunkt genügt, damit die Fläche als Fläche liest.
         */
        fill: {
          DEFAULT: 'rgb(var(--c-overlay) / 0.04)',
          strong: 'rgb(var(--c-overlay) / 0.07)',
        },
      },
      /**
       * Die beiden Schriftrollen kommen aus CSS-Variablen (Arbeitspaket S-3).
       *
       * Gesetzt werden sie vom erzeugten Stylesheet der eigenen Instanz
       * (`/public/fonts.css`, eingebunden im Root-Layout) – der Betreiber wählt
       * die Schriften in der Administration unter „Schriften". Vorher standen
       * hier die beiden Namen wörtlich; eine Auswahl hätte sie nie erreicht.
       *
       * **Der zweite Wert im `var(...)` ist wichtig.** Er greift, wenn das
       * Stylesheet nicht geladen werden konnte. Ohne ihn wäre die ganze
       * `font-family`-Angabe ungültig und die Fallback-Stacks dahinter
       * wirkungslos – die Oberfläche fiele auf die Vorgabeschrift des Browsers
       * zurück statt auf `system-ui` bzw. `ui-monospace`. Die Fallback-Stacks
       * selbst sind unverändert.
       */
      fontFamily: {
        /**
         * Die Schrift der ganzen Oberfläche.
         *
         * Drei Stufen, jede mit Grund: Das gewählte Theme bringt eine eigene
         * mit (`--palantir-font-theme`, gesetzt in `lib/theme/palette.ts`);
         * bringt es keine – oder ist sie in dieser Instanz nicht vorhanden –,
         * gilt die Wahl des Betreibers (`--palantir-font-ui`, Arbeitspaket
         * S-3); fehlt auch dessen Stylesheet, bleibt der Stack darunter.
         *
         * ⚠️ **Die dicktengleiche Rolle bleibt davon unberührt.** Konsole,
         * Adressen, Portnummern und Punktestände stehen in `font-mono`, und
         * dort zählt die gleiche Zeichenbreite: Eine Zierschrift ließe jede
         * Konsolenausgabe spaltenweise verrutschen.
         */
        sans: [
          'var(--palantir-font-theme, var(--palantir-font-ui, "Space Grotesk"))',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'sans-serif',
        ],
        mono: [
          'var(--palantir-font-mono, "JetBrains Mono")',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
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
        /**
         * Durchmesser der Kennzahlen-Ringe auf der Server-Kachel (54px).
         *
         * Eigenes Maß statt `h-14`, weil Ring, Bogenstärke und die Zahl in der
         * Mitte aufeinander abgestimmt sind: `MetricRing` zeichnet auf einem
         * 80er-Feld mit Radius 33 und Stärke 7, und dieses Verhältnis stimmt
         * genau bei 54px. Wer die Größe ändert, ändert sie hier – nicht in der
         * Komponente.
         */
        ring: '3.375rem', // 54px
        /** Kachel im Kopf der Server-Detailseite. */
        13: '3.25rem', // 52px
      },
      /**
       * Schatten sind überall schwarz – nur **wie viel** man von ihnen sieht,
       * hängt am Theme.
       *
       * Auf dunklem Grund fällt ein Schatten kaum auf und darf kräftig sein;
       * auf hellem Grund wird aus demselben Wert ein dunkler Hof um jedes
       * Modal. Die Deckkraft kommt deshalb aus einer Variablen, die
       * `lib/theme/palette.ts` je Theme aus einem Faktor ausrechnet – die
       * Farbe selbst bleibt, was sie immer war.
       */
      boxShadow: {
        /** Schein unter der Primäraktion – hebt den einen wichtigen Knopf heraus. */
        glow: '0 4px 18px rgb(var(--c-brand) / var(--schatten-glow))',
        /** Popover, Dropdown, Toast. */
        panel: '0 16px 40px rgb(0 0 0 / var(--schatten-panel))',
        /** Modal-Dialog. */
        modal: '0 30px 90px rgb(0 0 0 / var(--schatten-modal))',
      },
      backgroundImage: {
        /** Marken-Verlauf: Logo-Kachel, Primär-Button, Server-Initialen. */
        'brand-gradient': 'linear-gradient(135deg,rgb(var(--c-brand)),rgb(var(--c-accent)))',
        /**
         * Flächenverlauf für Karten und Kennzahlen-Panels.
         *
         * Der obere Stopp ist die einzige Fläche des Systems, die **kein**
         * eigenes Token hatte: Er lag als `rgba(22,24,32,.9)` nur hier und
         * traf keinen der `surface`-Werte. Beim Umstellen auf Themes wäre er
         * damit als Einziger blau geblieben, während die Karte um ihn herum
         * die Farbe wechselt – er steht deshalb jetzt als `surfaceCard` in der
         * Palette.
         */
        'card-gradient':
          'linear-gradient(180deg, rgb(var(--c-surface-card) / .9), rgb(var(--c-surface-deep) / .9))',
        /**
         * Kopfkarte der Server-Detailansicht: dieselbe Fläche, oben mit einem
         * Hauch der Markenfarbe – sie hebt den Kopf vom Rest der Seite ab,
         * ohne ihn einzufärben.
         */
        'hero-gradient':
          'linear-gradient(180deg, rgb(var(--c-brand) / 0.07), rgb(var(--c-surface-deep) / .9))',
        /**
         * Die Kanten des Rahmens – Seitenleiste nach rechts, Kopfzeile nach
         * unten (Betreiberwunsch 20.09.2026).
         *
         * Derselbe Verlauf wie Logo-Kachel und Primärknopf, nur leise:
         * Violett nach Türkis bei 40 % Deckkraft. Vorher trugen beide Kanten
         * `line`, also dieselbe weiße Haarlinie wie jede Karte – bei 7 % war
         * davon nichts mehr zu sehen, die Seitenleiste ging ohne Kontur in den
         * Inhalt über.
         *
         * Von 22,5 % auf 40 % angehoben (Betreiberwunsch 22.09.2026): Die
         * Farbe war richtig, nur blieb die Linie auf einem hellen Schreibtisch
         * und auf dem Telefon praktisch unsichtbar. Zusammen mit der leicht
         * größeren Stärke der Kante (`--rahmen-kante` in `globals.css`) steht
         * sie jetzt da, ohne zum Strich zu werden.
         *
         * ⚠️ Kein Rahmen, sondern eine 1px-Fläche: Eine `border-color` kann
         * keinen Verlauf tragen. Eingehängt wird sie über die Klassen
         * `rahmenkante-quer` und `rahmenkante-laengs` in `globals.css` – dort
         * steht auch, warum die waagerechte Kante über beide Köpfe hinweg
         * **ein** Verlauf sein muss.
         */
        'chrome-edge-x':
          'linear-gradient(90deg, rgb(var(--c-brand) / 0.4), rgb(var(--c-accent) / 0.4))',
        'chrome-edge-y':
          'linear-gradient(180deg, rgb(var(--c-brand) / 0.4), rgb(var(--c-accent) / 0.4))',
        /** Dezenter Lichtschein hinter dem gesamten Dashboard. */
        'app-glow':
          'radial-gradient(1200px 600px at 80% -10%, rgb(var(--c-brand) / 0.10), transparent 60%)',
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
        /**
         * Der Schleier hinter einem Modal: Tönung **und** Weichzeichner ziehen
         * zusammen auf, damit die Tiefe mit der Fläche ankommt statt vor ihr.
         *
         * Vorher trug der Schleier `fade-up` – also das Keyframe der Dialog-
         * Fläche samt `translateY(8px)`. Der Verdunkler rutschte dadurch von
         * unten herein, was bei einem ganzflächigen Element als Ruckeln
         * ankommt.
         *
         * ⚠️ Der Endwert `blur(3px)` muss zum `backdrop-blur-[3px]` passen,
         * das derselbe Schleier als Ruhezustand trägt – nach der Animation
         * übernimmt die Utility-Klasse. Wer den einen Wert ändert, ändert auch
         * den anderen.
         */
        scrimIn: {
          from: { opacity: '0', backdropFilter: 'blur(0)' },
          to: { opacity: '1', backdropFilter: 'blur(3px)' },
        },
        startupSweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        spin: {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        'fade-up': 'fadeUp 0.25s ease',
        materialize: 'materialize 0.18s ease',
        'scrim-in': 'scrimIn 0.2s ease-out',
        'startup-sweep': 'startupSweep 1.6s linear infinite',
        spin: 'spin 0.7s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
