'use client';

import { type CSSProperties, useId } from 'react';
import { type UnoCard, type UnoColor } from './types';

/**
 * Eine Karte als SVG – eigene Gestaltung: Rauten-Emblem statt des bekannten
 * Ovals, Verläufe je Farbe, Eckzeichen oben links und unten rechts. Als SVG
 * skaliert sie ohne Unschärfe vom Mini-Stapel bis zur großen Ablage.
 */

export const CARD_GRADIENTS: Record<UnoColor | 'schwarz', [string, string]> = {
  rot: ['#fb7185', '#be123c'],
  gelb: ['#fde047', '#ca8a04'],
  gruen: ['#4ade80', '#15803d'],
  blau: ['#60a5fa', '#1d4ed8'],
  schwarz: ['#3f3f46', '#09090b'],
};

export const CARD_SOLID: Record<UnoColor, string> = {
  rot: '#e11d48',
  gelb: '#eab308',
  gruen: '#16a34a',
  blau: '#2563eb',
};

function cornerText(card: UnoCard): string {
  switch (card.art) {
    case 'zahl':
      return String(card.zahl);
    case 'plus2':
      return '+2';
    case 'plus4':
      return '+4';
    default:
      return '';
  }
}

/** Kleines Symbol für Aussetzen/Richtung/Farbwahl – in Ecken und Mitte gleich. */
function Glyph({ card, color, size }: { card: UnoCard; color: string; size: number }) {
  const s = size;
  if (card.art === 'aussetzen') {
    return (
      <g>
        <circle r={s * 0.42} fill="none" stroke={color} strokeWidth={s * 0.14} />
        <line
          x1={-s * 0.3}
          y1={s * 0.3}
          x2={s * 0.3}
          y2={-s * 0.3}
          stroke={color}
          strokeWidth={s * 0.14}
          strokeLinecap="round"
        />
      </g>
    );
  }
  if (card.art === 'richtung') {
    const w = s * 0.12;
    return (
      <g fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">
        <path
          d={`M ${-s * 0.4} ${-s * 0.08} Q ${-s * 0.4} ${-s * 0.4} ${-s * 0.05} ${-s * 0.4} L ${s * 0.35} ${-s * 0.4}`}
        />
        <path
          d={`M ${s * 0.22} ${-s * 0.55} L ${s * 0.4} ${-s * 0.4} L ${s * 0.22} ${-s * 0.25}`}
        />
        <path
          d={`M ${s * 0.4} ${s * 0.08} Q ${s * 0.4} ${s * 0.4} ${s * 0.05} ${s * 0.4} L ${-s * 0.35} ${s * 0.4}`}
        />
        <path
          d={`M ${-s * 0.22} ${s * 0.55} L ${-s * 0.4} ${s * 0.4} L ${-s * 0.22} ${s * 0.25}`}
        />
      </g>
    );
  }
  // Farbwahl und +4: Raute aus vier farbigen Dreiecken.
  const r = s * 0.48;
  return (
    <g>
      <path d={`M 0 ${-r} L ${r} 0 L 0 0 Z`} fill={CARD_SOLID.rot} />
      <path d={`M ${r} 0 L 0 ${r} L 0 0 Z`} fill={CARD_SOLID.blau} />
      <path d={`M 0 ${r} L ${-r} 0 L 0 0 Z`} fill={CARD_SOLID.gelb} />
      <path d={`M ${-r} 0 L 0 ${-r} L 0 0 Z`} fill={CARD_SOLID.gruen} />
      <path
        d={`M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`}
        fill="none"
        stroke="#fff"
        strokeWidth={s * 0.06}
      />
    </g>
  );
}

export function CardFace({
  card,
  className,
  wishColor,
}: {
  card: UnoCard;
  className?: string;
  wishColor?: UnoColor | null;
}) {
  const uid = useId().replace(/:/g, '');
  const [from, to] = CARD_GRADIENTS[card.farbe];
  const ink = card.farbe === 'schwarz' ? '#18181b' : CARD_SOLID[card.farbe];
  const corner = cornerText(card);
  const bigText = card.art === 'zahl' || card.art === 'plus2' || card.art === 'plus4';
  return (
    <svg viewBox="0 0 100 150" className={className} role="img" aria-label={cardAria(card)}>
      <defs>
        <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <radialGradient id={`s${uid}`} cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="98" height="148" rx="11" fill="#fafafa" />
      <rect x="5" y="5" width="90" height="140" rx="8" fill={`url(#g${uid})`} />
      {wishColor ? (
        <rect
          x="5"
          y="5"
          width="90"
          height="140"
          rx="8"
          fill="none"
          stroke={CARD_SOLID[wishColor]}
          strokeWidth="6"
        />
      ) : null}
      {/* Rauten-Emblem – bewusst eckig statt oval */}
      <g transform="translate(50 75)">
        <rect
          x="-30"
          y="-30"
          width="60"
          height="60"
          rx="10"
          transform="rotate(45)"
          fill="#fff"
          opacity="0.94"
        />
        {bigText ? (
          <>
            {card.art === 'plus4' ? (
              <g transform="translate(0 -1) scale(1.1)">
                <Glyph card={card} color={ink} size={50} />
              </g>
            ) : null}
            <text
              y="13"
              textAnchor="middle"
              fontSize={corner.length > 1 ? 34 : 44}
              fontWeight="900"
              fontFamily="system-ui, sans-serif"
              fill={card.art === 'plus4' ? '#fff' : ink}
              stroke={card.art === 'plus4' ? '#18181b' : 'none'}
              strokeWidth={card.art === 'plus4' ? 2.5 : 0}
              paintOrder="stroke"
              textDecoration={
                card.art === 'zahl' && (card.zahl === 6 || card.zahl === 9)
                  ? 'underline'
                  : undefined
              }
            >
              {corner}
            </text>
          </>
        ) : (
          <Glyph card={card} color={ink} size={44} />
        )}
      </g>
      {/* Eckzeichen */}
      {[0, 1].map((flip) => (
        <g key={flip} transform={flip ? 'translate(86 136) rotate(180)' : 'translate(14 14)'}>
          {corner ? (
            <text
              y="8"
              textAnchor="middle"
              fontSize="17"
              fontWeight="900"
              fontFamily="system-ui, sans-serif"
              fill="#fff"
              stroke="rgba(0,0,0,0.35)"
              strokeWidth="1"
              paintOrder="stroke"
            >
              {corner}
            </text>
          ) : (
            <Glyph card={card} color="#fff" size={20} />
          )}
        </g>
      ))}
      <rect x="5" y="5" width="90" height="140" rx="8" fill={`url(#s${uid})`} />
    </svg>
  );
}

export function CardBack({ className, style }: { className?: string; style?: CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 100 150" className={className} style={style} aria-hidden="true">
      <defs>
        <linearGradient id={`b${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#312e81" />
          <stop offset="1" stopColor="#0f0a1f" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="98" height="148" rx="11" fill="#fafafa" />
      <rect x="5" y="5" width="90" height="140" rx="8" fill={`url(#b${uid})`} />
      <g transform="translate(50 75)">
        {[0, 45, 90, 135].map((a, i) => (
          <rect
            key={a}
            x="-9"
            y="-42"
            width="18"
            height="84"
            rx="9"
            transform={`rotate(${a})`}
            fill={[CARD_SOLID.rot, CARD_SOLID.gelb, CARD_SOLID.gruen, CARD_SOLID.blau][i]}
            opacity="0.55"
          />
        ))}
        <circle r="15" fill="#0f0a1f" stroke="#fff" strokeWidth="2.5" />
        <circle r="6" fill="#fff" />
      </g>
    </svg>
  );
}

export function cardAria(card: UnoCard): string {
  const farben: Record<UnoColor, string> = {
    rot: 'Rot',
    gelb: 'Gelb',
    gruen: 'Grün',
    blau: 'Blau',
  };
  if (card.art === 'farbwahl') return 'Farbwahl';
  if (card.art === 'plus4') return 'Plus vier';
  const f = farben[card.farbe as UnoColor];
  if (card.art === 'zahl') return `${f} ${card.zahl}`;
  if (card.art === 'aussetzen') return `${f} Aussetzen`;
  if (card.art === 'richtung') return `${f} Richtungswechsel`;
  return `${f} plus zwei`;
}
