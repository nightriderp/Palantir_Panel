/**
 * Farbwerte für das Zeichnen der Minispiele (Arbeitspaket F8).
 *
 * Canvas braucht konkrete Farben statt Tailwind-Klassen. Die Werte spiegeln die
 * Design-Tokens aus `tailwind.config.ts` (F2), damit die Spiele zum restlichen
 * Panel passen – hier bewusst als einzelne Konstante gebündelt, nicht in jedem
 * Spiel wiederholt.
 */
export const ARCADE_PALETTE = {
  /** Spielfeld-Hintergrund (surface.deep). */
  field: '#12141b',
  /** Dezentes Raster / Wände (line.strong). */
  grid: 'rgba(255,255,255,0.07)',
  /** Kräftige Markenfarbe – Spielfigur, Schläger. */
  brand: '#7c5cff',
  brandBright: '#9b82ff',
  /** Zweite Markenfarbe – Sammelobjekte, Ball. */
  accent: '#22d3ee',
  /** Positiv / Erfolg. */
  success: '#3ddc84',
  /** Hinweis. */
  warning: '#fbbf24',
  /** Gefahr – Gegner, Verlust. */
  danger: '#ff6b6b',
  /** Haupttext auf dem Feld. */
  ink: '#e8ebf2',
  /** Zurückhaltender Text. */
  muted: '#9aa2b2',
} as const;
