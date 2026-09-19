import { cn } from '../utils/cn';

export interface LogoMarkProps {
  /** Kantenlänge der Kachel in Pixeln (Standard 34, wie in der Navigation). */
  size?: number;
  className?: string;
}

/**
 * Maße des Signets in der Vorlage `apps/frontend/public/logo.png` – der Pfad
 * unten ist daran vermessen, deshalb bleibt das Seitenverhältnis fest.
 */
const SIGNET_BREITE = 372;
const SIGNET_HOEHE = 584;

/**
 * Höhe des Signets im Verhältnis zur Kachel.
 *
 * Höher als bei den App-Icons (0,62 auf 512 px): Das Signet ist schmal, seine
 * Breite beträgt nur 0,64 seiner Höhe. Bei 0,62 stünde es auf der 34-px-Kachel
 * der Navigation verloren in der Fläche.
 */
const SIGNET_ANTEIL = 0.78;

/**
 * Das Signet aus dem Projektlogo: Ring, senkrecht durchgehende Lanzette, Punkt.
 *
 * An der Vorlage vermessen statt nachgezeichnet – Ring aussen r 184,8 / innen
 * r 137,4 um (186, 287), senkrecht bei x 154 und 218 geschnitten; Punkt r 63,9
 * um (186, 289); die Lanzette läuft als kubische Kurve von Spitze zu Spitze und
 * endet mit 19 px Luft vor dem Punkt. Die gerenderte Fläche weicht von der
 * Vorlage nur in der Kantenglättung ab (unter 4 % der Pixel, alle am Rand).
 */
const SIGNET_PFAD =
  'M154 104.99A184.8 184.8 0 0 0 154 469.01L154 420.62A137.4 137.4 0 0 1 154 153.38Z' +
  'M218 104.99A184.8 184.8 0 0 1 218 469.01L218 420.62A137.4 137.4 0 0 0 218 153.38Z' +
  'M186 0C194.66 65.74 200.5 60.4 201.76 207.61L170.24 207.61C171.5 60.4 177.34 65.74 186 0Z' +
  'M186 584C194.66 518.26 200.5 523.6 201.76 376.39L170.24 376.39C171.5 523.6 177.34 518.26 186 584Z' +
  'M186 225.1A63.9 63.9 0 1 0 186 352.9A63.9 63.9 0 1 0 186 225.1Z';

/**
 * Kennung des Verlaufs.
 *
 * Fest und nicht je Instanz erzeugt: `LogoMark` steht serverseitig gerenderte
 * Seiten (`not-found.tsx`), dort ist `useId` nicht verfügbar. Zwei Signets auf
 * einer Seite trügen dieselbe Kennung – unschön, aber folgenlos, weil jede
 * Instanz denselben Verlauf zeichnet.
 */
const VERLAUF_ID = 'palantir-signet-verlauf';

/**
 * Palantir-Signet aus dem Projektlogo: dunkle Kachel, Signet im Markenverlauf.
 *
 * Wird in der Seitennavigation, auf den Auth-Seiten (F1) und auf der 404-Seite
 * verwendet – dieselbe Gestaltung wie das Tab-Icon (`src/app/icon.png`). Auf
 * `canvas` als Seitengrund verschwindet die Kachel und das Signet steht frei;
 * auf `surface-deep` (Navigation, Auth-Spalte) setzt sie sich leicht ab.
 */
export function LogoMark({ size = 34, className }: LogoMarkProps) {
  const hoehe = Math.round(size * SIGNET_ANTEIL);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-tile bg-canvas',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={Math.round((hoehe * SIGNET_BREITE) / SIGNET_HOEHE)}
        height={hoehe}
        viewBox={`0 0 ${SIGNET_BREITE} ${SIGNET_HOEHE}`}
        aria-hidden
      >
        <defs>
          {/*
            Der Verlauf läuft schräg über die Höhe statt über die Diagonale des
            Signets: Es ist schmal und hoch, diagonal bliebe das Cyan-Ende in
            der leeren Ecke liegen und das Zeichen wäre durchgehend blau.

            Die Farben kommen als `stop-color` aus den Tokens `brand` und
            `accent` – dieselben Werte, aus denen `bg-brand-gradient` gebaut
            ist. SVG-Farbstopps haben keine eigene Utility-Klasse, deshalb die
            Schreibweise mit `theme()`; ein literaler Hex-Wert im Markup wäre
            ein Verstoß gegen die Regel aus `tailwind.config.ts` (Audit W3-2,
            frontend-lib-17).
          */}
          <linearGradient id={VERLAUF_ID} x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" className="[stop-color:theme(colors.brand.DEFAULT)]" />
            <stop offset="1" className="[stop-color:theme(colors.accent)]" />
          </linearGradient>
        </defs>
        <path d={SIGNET_PFAD} fill={`url(#${VERLAUF_ID})`} />
      </svg>
    </span>
  );
}
