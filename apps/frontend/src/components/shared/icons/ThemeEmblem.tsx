'use client';

import { type ReactNode } from 'react';
import { useThemeId } from '@/lib/theme/ThemeProvider';
import { cn } from '../utils/cn';

/**
 * Das Zeichen, das ein Theme über der Bestenliste führt.
 *
 * **Motive, keine Figuren.** Jedes Emblem zeigt, wofür das Theme steht –
 * Amboss, Zielflagge, Bambus –, und keines zitiert eine bestimmte Gestalt aus
 * einem Film oder Spiel. Das ist keine Feinheit: Farben und Stimmungen
 * nachzubauen steht jedem frei, ein Charakterdesign nicht, und daran ändert
 * ein eigener Strich nichts – geschützt ist die erkennbare Figur. Dieses
 * Repository ist öffentlich.
 *
 * **Gezeichnet, nicht geladen.** Jedes Emblem ist ein paar Pfade im Markup:
 * Es erbt seine Farbe über `currentColor` vom Theme, bleibt bei jeder Größe
 * scharf, kostet keine Anfrage und keine Zwischenspeicherung. Die weichen
 * Enden (`stroke-linecap="round"`) und die bewusst nicht ganz gleichmäßigen
 * Kurven geben ihm den Zug eines Stifts statt den eines Vektorprogramms.
 *
 * Ein Theme ohne eigenes Motiv – und jede unbekannte Kennung – bekommt den
 * Lorbeer: Er passt zu einer Bestenliste und gehört keinem Genre.
 */

/** Die Pfade je Theme. `null` steht nirgends – wer fehlt, bekommt den Lorbeer. */
const MOTIVE: Record<string, ReactNode> = {
  /**
   * Medaille am Band – der neutrale Rückfall.
   *
   * Hier standen zwei Lorbeerzweige. Sie lasen bei 26px nicht als Kranz,
   * sondern als Flügelpaar: Die Blattstriche saßen außen und liefen spitz zu.
   * Eine Scheibe mit Stern und zwei Bändern ist eindeutig.
   */
  standard: (
    <>
      <path d="M11 3.5 14 12M21 3.5 18 12" />
      <circle cx="16" cy="19.5" r="9" />
      <path d="m16 14.5 1.5 3.1 3.4.5-2.5 2.4.6 3.4-3-1.6-3 1.6.6-3.4-2.5-2.4 3.4-.5z" />
    </>
  ),

  /**
   * Hammer mit zwei Funken.
   *
   * Vorher ein Amboss – der war bei dieser Größe nicht von einer Schüssel zu
   * unterscheiden: Das Horn verschwand, und das Fußstück las als Standfuß.
   * Ein Hammer hat zwei Teile und eine Schräglage; beides überlebt die
   * Verkleinerung.
   */
  schmiedefeuer: (
    <>
      <g transform="rotate(-38 16 16)">
        <path d="M16 29V13" />
        <path d="M8.5 6.5h15v6.5h-15z" />
      </g>
      <path d="M24.5 20.5 27 18.5M22.5 25 24.5 26.5" />
    </>
  ),

  /** Blitz. */
  neonnacht: <path d="M18.5 3 8 18.5h6.5L12 29l11.5-16h-7z" />,

  /** Federspitze mit Schlitz. */
  kanzlei: (
    <>
      <path d="M16 4.5 23 20l-7 7.5L9 20z" />
      <path d="M16 13.5v8" />
      <circle cx="16" cy="11" r="1.4" />
    </>
  ),

  /** Komet mit Schweif und zwei fernen Sternen. */
  hyperraum: (
    <>
      <circle cx="20.5" cy="11" r="4.5" />
      <path d="M17 14.5 6.5 25M20.5 16 12 26" />
      <path d="M7 8.5v2.5M5.75 9.75h2.5M26 22.5v2M24.75 23.5h2.5" />
    </>
  ),

  /** Sonne – für das helle Theme, sonst wie der Lorbeer neutral. */
  tageslicht: (
    <>
      <circle cx="16" cy="16" r="6.5" />
      <path d="M16 3v3.5M16 25.5V29M3 16h3.5M25.5 16H29M6.8 6.8l2.5 2.5M22.7 22.7l2.5 2.5M25.2 6.8l-2.5 2.5M9.3 22.7l-2.5 2.5" />
    </>
  ),

  /** Schild mit Stern. */
  heldenrot: (
    <>
      <path d="M16 3.5 27 7.5v8c0 6.5-5 11-11 13.5C10 26.5 5 22 5 15.5v-8z" />
      <path d="m16 10.5 1.6 3.4 3.7.5-2.7 2.6.7 3.7-3.3-1.8-3.3 1.8.7-3.7-2.7-2.6 3.7-.5z" />
    </>
  ),

  /**
   * Aufblitzende Energie – ein vierzackiger Funken mit zwei kleinen daneben.
   *
   * ⚠️ Hier stand eine Kugel mit Strahlenkranz. Im Markup war sie von der
   * Sonne des hellen Themes verschieden, **im Bild nicht**: Kreis plus
   * Strahlen ist eine Sonne, gleich welche Radien man wählt. Der Funken hat
   * eingezogene Flanken und keinen Kreis – er kann mit nichts verwechselt
   * werden.
   */
  kampfgeist: (
    <>
      <path d="M15 3c1 6.5 4.5 10.5 10.5 11.5C19.5 15.5 16 19.5 15 26c-1-6.5-4.5-10.5-10.5-11.5C10.5 13.5 14 9.5 15 3z" />
      <path d="M24 21c.4 2.4 1.7 3.8 4 4.2-2.3.4-3.6 1.8-4 4.2-.4-2.4-1.7-3.8-4-4.2 2.3-.4 3.6-1.8 4-4.2z" />
    </>
  ),

  /** Zielflagge am Mast. */
  boxenstopp: (
    <>
      <path d="M8 29V4" />
      <path d="M8 6h17v11H8z" />
      <path d="M8 6h8.5v5.5H8zM16.5 11.5H25V17h-8.5z" fill="currentColor" />
    </>
  ),

  /** Bambus mit zwei Blättern. */
  bambushain: (
    <>
      {/*
        Die Blätter setzen am Halm an und laufen nach außen. Vorher begannen
        sie in seiner Mitte und liefen über ihn hinweg – der Halm wirkte
        dadurch durchgestrichen statt bewachsen.
      */}
      <path d="M14 29V4" />
      <path d="M10.5 21.5h7M10.5 13.5h7" />
      <path d="M14 10c3.5-3 7.5-3.2 10.5-.5-3.5 2.8-7.5 3-10.5.5z" />
      <path d="M14 18c-2.8-2.4-6-2.6-8.5-.4 2.8 2.2 6 2.4 8.5.4z" />
    </>
  ),

  /** Flügel über einer Schuppe. */
  drachenfels: (
    <>
      {/*
        Die Hinterkante ist gezackt, nicht glatt: Eine glatte Kante las als
        Feder. Die Bögen zwischen den Fingern machen daraus eine Flughaut.
      */}
      <path d="M27.5 5.5C17 6.5 9 11 3.5 21.5c3 .5 4.5-1.5 6.5-2.5 1 2 3 1 5-.5 1 2 3 1 4.5-1.5 1.5 1.5 3 .5 4-2 1.5 1 2.5 0 3.5-3.5z" />
      <path d="M10 19 13 12M15 18.5 18.5 10.5M20 17 23 9.5" />
    </>
  ),
};

export interface ThemeEmblemProps {
  /** Kantenlänge in Pixeln. */
  size?: number;
  className?: string;
}

/**
 * Das Emblem des gerade gewählten Themes.
 *
 * `aria-hidden`, weil daneben immer eine Überschrift steht, die dasselbe in
 * Worten sagt: Das Zeichen schmückt, es informiert nicht. Eine Sprachausgabe
 * würde es sonst als zweite, stumme Überschrift vorlesen.
 */
export function ThemeEmblem({ size = 26, className }: ThemeEmblemProps) {
  const thema = useThemeId();
  const motiv = MOTIVE[thema] ?? MOTIVE.standard;

  return (
    <svg
      aria-hidden
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
    >
      {motiv}
    </svg>
  );
}
