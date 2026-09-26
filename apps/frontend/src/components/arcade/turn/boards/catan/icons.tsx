/**
 * Eigene Symbole für Rohstoffe und Entwicklungskarten.
 *
 * Alle Glyphen leben in einem 24×24-Raster, damit dieselbe Zeichnung auf dem
 * Brett (als `<g>` mit Verschiebung und Skalierung) und in der Hand (als
 * eigenes `<svg>`) verwendet werden kann. Die Farben sind Spielgrafik, keine
 * Oberflächenfarben – deshalb stehen sie hier literal und nicht als Tokens.
 */

/** Landschaftsfarben je Rohstoff: [hell, dunkel]. Index 5 = Wüste. */
export const LAND_COLORS: readonly (readonly [string, string])[] = [
  ['#4fae5a', '#1f6b35'],
  ['#e0784a', '#9c3b1c'],
  ['#b6e37a', '#5f9a34'],
  ['#f7d460', '#c9921c'],
  ['#a3adbb', '#4f5866'],
  ['#f1dfa6', '#c9a65c'],
];

export function landColor(res: number): readonly [string, string] {
  return LAND_COLORS[res < 0 ? 5 : res] ?? ['#999', '#555'];
}

/** Rohstoff-Glyphe im 24er-Raster. */
export function ResGlyph({ res }: { res: number }) {
  switch (res) {
    case 0:
      // Wald: zwei Tannen, die kleinere dahinter.
      return (
        <g>
          <rect x="15.2" y="15" width="1.6" height="4" fill="#6b3f1d" />
          <path d="M16 5 L20.5 15.5 H11.5 Z" fill="#2e7d3a" />
          <rect x="7.3" y="16" width="2" height="5" fill="#7a4822" />
          <path d="M8.3 3 L14 16.8 H2.6 Z" fill="#1b5e2c" />
          <path d="M8.3 3 L11 9.5 H5.6 Z" fill="#4caf50" />
        </g>
      );
    case 1:
      // Hügel: gestapelte Ziegel.
      return (
        <g stroke="#6d2a12" strokeWidth="0.8">
          <rect x="3" y="14" width="8.5" height="4.5" rx="0.8" fill="#d2633a" />
          <rect x="12.5" y="14" width="8.5" height="4.5" rx="0.8" fill="#c0512b" />
          <rect x="7.5" y="9" width="8.5" height="4.5" rx="0.8" fill="#e27a4f" />
          <rect x="10" y="4" width="6" height="4.5" rx="0.8" fill="#d2633a" />
        </g>
      );
    case 2:
      // Weide: ein rundes Schaf, das verschmitzt guckt.
      return (
        <g>
          <rect x="7" y="16" width="1.6" height="4" rx="0.6" fill="#3b3b3b" />
          <rect x="14.5" y="16" width="1.6" height="4" rx="0.6" fill="#3b3b3b" />
          <circle cx="8" cy="12" r="4" fill="#fbfbf5" />
          <circle cx="12" cy="10" r="4.5" fill="#ffffff" />
          <circle cx="15.5" cy="13" r="4" fill="#f4f4ec" />
          <circle cx="10.5" cy="14.5" r="3.6" fill="#fafaf2" />
          <ellipse cx="19.3" cy="10.5" rx="2.8" ry="2.3" fill="#3b3b3b" />
          <circle cx="20.2" cy="10" r="0.6" fill="#fff" />
        </g>
      );
    case 3:
      // Acker: drei Ähren.
      return (
        <g stroke="#9a6a10" strokeWidth="1" strokeLinecap="round">
          <path d="M12 21 V6 M7 21 Q7 14 5 8 M17 21 Q17 14 19 8" fill="none" />
          {[
            [12, 5],
            [12, 8.5],
            [12, 12],
            [5.2, 8],
            [5.8, 11.2],
            [18.8, 8],
            [18.2, 11.2],
          ].map(([x, y], i) => (
            <ellipse
              key={i}
              cx={x}
              cy={y}
              rx="1.6"
              ry="2.3"
              fill="#f2b631"
              stroke="#b07a12"
              strokeWidth="0.5"
            />
          ))}
        </g>
      );
    case 4:
      // Gebirge: Gipfel mit Schneekappe.
      return (
        <g>
          <path d="M1.5 20 L9 7 L16.5 20 Z" fill="#6b7482" />
          <path d="M8 20 L15.5 4 L23 20 Z" fill="#8a94a3" />
          <path d="M15.5 4 L18.4 10.2 L16.6 9.3 L15 10.8 L13.2 9 L12.7 10 Z" fill="#f3f6fa" />
          <path d="M9 7 L10.9 10.3 L9.4 9.8 L8.2 10.8 L7.1 10.3 Z" fill="#e6ebf2" />
        </g>
      );
    default:
      // Wüste: Düne mit Kaktus.
      return (
        <g>
          <path d="M1 20 Q8 13 14 17 T23 18 V21 H1 Z" fill="#d8b56a" />
          <rect x="11" y="6" width="3" height="12" rx="1.5" fill="#4d8f3a" />
          <path
            d="M11 12 H8.5 V9"
            stroke="#4d8f3a"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M14 10.5 H16.5 V7.5"
            stroke="#4d8f3a"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
  }
}

/** Eigenständiges Rohstoff-Symbol für DOM-Stellen (Hand, Kosten, Handel). */
export function ResIcon({
  res,
  size = 22,
  className,
}: {
  res: number;
  size?: number;
  className?: string;
}) {
  const [light, dark] = landColor(res);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="6"
        fill={light}
        stroke={dark}
        strokeWidth="1"
        opacity="0.35"
      />
      <ResGlyph res={res} />
    </svg>
  );
}

/** Entwicklungskarten-Symbol. */
export function DevIcon({ card, size = 22 }: { card: number; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {card === 0 && (
        // Ritter: Helm mit Federbusch.
        <g>
          <path
            d="M6 20 V12 Q6 5 12 5 Q18 5 18 12 V20 Z"
            fill="#9aa7b8"
            stroke="#4b5563"
            strokeWidth="1"
          />
          <rect x="8" y="11" width="8" height="1.8" rx="0.9" fill="#1f2937" />
          <path d="M12 5 Q15 1 19 2 Q16 4 15 6" fill="#ef4444" />
        </g>
      )}
      {card === 1 && (
        // Siegpunkt: kleiner Pokal.
        <g>
          <path
            d="M7 4 H17 V9 Q17 14 12 14 Q7 14 7 9 Z"
            fill="#facc15"
            stroke="#a16207"
            strokeWidth="1"
          />
          <rect x="10.8" y="14" width="2.4" height="3.5" fill="#ca8a04" />
          <rect x="7.5" y="17.5" width="9" height="2.5" rx="1" fill="#a16207" />
        </g>
      )}
      {card === 2 && (
        // Straßenbau: zwei Wegstücke.
        <g strokeLinecap="round">
          <path d="M3 19 L11 11" stroke="#b45309" strokeWidth="3.5" />
          <path d="M13 9 L21 3" stroke="#d97706" strokeWidth="3.5" />
          <circle cx="12" cy="10" r="1.8" fill="#fde68a" />
        </g>
      )}
      {card === 3 && (
        // Erfindung: Glühbirne.
        <g>
          <circle cx="12" cy="10" r="6" fill="#fde047" stroke="#ca8a04" strokeWidth="1" />
          <rect x="9.5" y="15.5" width="5" height="4" rx="1" fill="#9ca3af" />
          <path d="M10 10 L12 12 L14 10" stroke="#a16207" strokeWidth="1" fill="none" />
        </g>
      )}
      {card === 4 && (
        // Monopol: Sack voller Beute.
        <g>
          <path
            d="M8 8 Q4 20 12 21 Q20 20 16 8 Z"
            fill="#c08a4b"
            stroke="#7c4a1e"
            strokeWidth="1"
          />
          <path d="M9 8 L12 5 L15 8" stroke="#7c4a1e" strokeWidth="1.5" fill="none" />
          <circle cx="12" cy="15" r="2.4" fill="#fcd34d" />
        </g>
      )}
    </svg>
  );
}
