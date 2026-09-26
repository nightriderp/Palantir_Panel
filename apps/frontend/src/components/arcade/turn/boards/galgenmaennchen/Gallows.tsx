'use client';

/**
 * Galgen-Zeichnung in zehn Etappen – je Fehler ein Strich mehr.
 *
 * Jede Linie wird über `pathLength` und einen Strichversatz „gezeichnet",
 * damit der neue Strich sichtbar entsteht, statt einfach aufzuploppen. Der
 * kleine Vogel auf dem Balken ist nur Zierde; er fliegt beim Verlieren davon.
 */

const STROKE = '#f5d0fe';

interface Part {
  d: string;
  width?: number;
}

/** Reihenfolge: Hügel, Mast, Balken + Strebe, Seil, Kopf, Körper, Arme, Beine. */
const PARTS: Part[] = [
  { d: 'M20 190 Q80 168 140 190', width: 6 },
  { d: 'M60 182 L60 22', width: 6 },
  { d: 'M54 24 L150 24 M60 58 L94 24', width: 5 },
  { d: 'M140 24 L140 50', width: 3 },
  { d: 'M140 50 a14 14 0 1 1 -0.01 0', width: 4 },
  { d: 'M140 78 L140 124', width: 4 },
  { d: 'M140 90 L120 108', width: 4 },
  { d: 'M140 90 L160 108', width: 4 },
  { d: 'M140 124 L124 152', width: 4 },
  { d: 'M140 124 L156 152', width: 4 },
];

export function Gallows({ wrong, lost, won }: { wrong: number; lost: boolean; won: boolean }) {
  const face = wrong >= 5;
  return (
    <svg
      viewBox="0 0 200 200"
      className="h-auto w-full max-w-[220px]"
      role="img"
      aria-label={`${wrong} von 10 Fehlern`}
    >
      <defs>
        <radialGradient id="galgen-mond" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fdf4ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#e879f9" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="170" cy="40" r="26" fill="url(#galgen-mond)" />
      {PARTS.map((part, i) => {
        const shown = i < wrong;
        return (
          <path
            key={i}
            d={part.d}
            pathLength={1}
            fill="none"
            stroke={i >= 4 ? (lost ? '#fb7185' : '#fdf4ff') : STROKE}
            strokeWidth={part.width ?? 4}
            strokeLinecap="round"
            strokeDasharray="1 1"
            strokeDashoffset={shown ? 0 : 1}
            style={{ transition: 'stroke-dashoffset 450ms ease-out, stroke 300ms' }}
          />
        );
      })}
      {face && (
        <g style={{ transition: 'opacity 300ms' }}>
          {lost ? (
            <path
              d="M133 60 l5 5 m0 -5 l-5 5 M142 60 l5 5 m0 -5 l-5 5"
              stroke="#fb7185"
              strokeWidth={1.8}
            />
          ) : (
            <>
              <circle cx="135" cy="62" r="1.8" fill="#fdf4ff" />
              <circle cx="145" cy="62" r="1.8" fill="#fdf4ff" />
            </>
          )}
          <path
            d={wrong >= 8 || lost ? 'M134 71 Q140 67 146 71' : 'M135 70 L145 70'}
            stroke="#fdf4ff"
            strokeWidth={1.6}
            fill="none"
          />
        </g>
      )}
      {/* Vogel auf dem Balken */}
      <g
        style={{
          transition: 'transform 900ms ease-in, opacity 900ms',
          transform: lost ? 'translate(60px,-60px)' : won ? 'translate(0,-6px)' : 'none',
          opacity: wrong >= 3 && !lost ? 1 : 0,
        }}
      >
        <ellipse cx="108" cy="17" rx="7" ry="5" fill="#fbbf24" />
        <circle cx="114" cy="13" r="3.5" fill="#fbbf24" />
        <path d="M117 13 l4 1 l-4 1 z" fill="#f97316" />
        <circle cx="115" cy="12.5" r="0.9" fill="#1f2937" />
      </g>
    </svg>
  );
}
