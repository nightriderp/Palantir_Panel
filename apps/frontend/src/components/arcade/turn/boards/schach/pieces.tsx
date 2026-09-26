/**
 * Eigene Schachfiguren als SVG (100×100). Bewusst schlicht: klare Silhouetten,
 * die auch bei 40 px auf dem Handy noch eindeutig sind, keine Nachbildung
 * eines bekannten Figurensatzes.
 */

import { type CSSProperties, type ReactNode } from 'react';

const BASE = <rect x="20" y="79" width="60" height="10" rx="4" />;

const SHAPES: Record<string, ReactNode> = {
  p: (
    <>
      <path d="M38 79 C40 62 44 52 44 46 L56 46 C56 52 60 62 62 79 Z" />
      <rect x="37" y="42" width="26" height="6" rx="3" />
      <circle cx="50" cy="30" r="13" />
      {BASE}
    </>
  ),
  r: (
    <>
      <path d="M32 79 L35 46 L65 46 L68 79 Z" />
      <path d="M28 46 V22 H37 V30 H45 V22 H55 V30 H63 V22 H72 V46 Z" />
      <rect x="30" y="44" width="40" height="5" rx="2" />
      {BASE}
    </>
  ),
  n: (
    <>
      <path d="M33 79 C33 66 40 60 46 52 C40 54 32 56 27 52 C22 47 26 41 33 37 C39 31 43 24 48 19 L50 11 L56 18 C69 22 76 36 73 53 C71 65 68 72 68 79 Z" />
      <circle cx="46" cy="31" r="3" fill="var(--piece-stroke)" stroke="none" />
      <path d="M60 24 C66 32 68 44 64 56" fill="none" />
      {BASE}
    </>
  ),
  b: (
    <>
      <path d="M36 79 C40 67 44 60 44 56 H56 C56 60 60 67 64 79 Z" />
      <path d="M50 19 C63 29 67 42 58 54 H42 C33 42 37 29 50 19 Z" />
      <circle cx="50" cy="14" r="5.5" />
      <path d="M55 29 L46 40" fill="none" />
      {BASE}
    </>
  ),
  q: (
    <>
      <path d="M34 79 C38 66 42 58 42 52 H58 C58 58 62 66 66 79 Z" />
      <path d="M29 52 L22 25 L37 39 L42 18 L50 35 L58 18 L63 39 L78 25 L71 52 Z" />
      <circle cx="22" cy="23" r="4.5" />
      <circle cx="42" cy="15" r="4.5" />
      <circle cx="58" cy="15" r="4.5" />
      <circle cx="78" cy="23" r="4.5" />
      {BASE}
    </>
  ),
  k: (
    <>
      <path d="M34 79 C38 66 42 58 42 54 H58 C58 58 62 66 66 79 Z" />
      <path d="M31 55 C25 42 32 30 42 33 C44 29 46 27 50 27 C54 27 56 29 58 33 C68 30 75 42 69 55 Z" />
      <rect x="47" y="5" width="6" height="22" rx="1.5" />
      <rect x="40" y="10" width="20" height="6" rx="1.5" />
      {BASE}
    </>
  ),
};

/** Figur aus einem FEN-Buchstaben (groß = Weiß). */
export function Piece({ code, className }: { code: string; className?: string }) {
  const white = code === code.toUpperCase();
  const shape = SHAPES[code.toLowerCase()];
  if (!shape) return null;
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden
      style={
        {
          // Weiß: Elfenbein mit dunkler Kontur; Schwarz: Schiefer mit heller Kontur,
          // damit beide auf hellen wie dunklen Feldern lesbar bleiben.
          '--piece-fill': white ? '#f8f5ee' : '#1f2937',
          '--piece-stroke': white ? '#1e293b' : '#cbd5e1',
        } as CSSProperties
      }
    >
      <g
        fill="var(--piece-fill)"
        stroke="var(--piece-stroke)"
        strokeWidth="3"
        strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 2px 1.5px rgba(0,0,0,0.45))' }}
      >
        {shape}
      </g>
    </svg>
  );
}
