'use client';

import { type ReactNode } from 'react';
import { type TurnSeatInfo } from '../../types';
import { BRETT, BREITE, ECKE, figurPlatz, gruppenFarbe, kurzname, zelle } from './geometrie';
import { type Feld, type MonopolyView } from './types';

const ZELLE_FARBE = '#1a2332';
const ZELLE_RAND = '#334155';
const TEXT = '#e2e8f0';
const TEXT_LEISE = '#94a3b8';

/** Kleine eigene Symbole für die Sonderfelder – lokal um (0, 0) gezeichnet. */
function Symbol({ feld }: { feld: Feld }): ReactNode {
  switch (feld.typ) {
    case 'bahnhof':
      return (
        <g>
          <rect x={-22} y={-14} width={44} height={26} rx={6} fill="#cbd5e1" />
          <rect x={-16} y={-9} width={12} height={9} rx={2} fill="#1e293b" />
          <rect x={4} y={-9} width={12} height={9} rx={2} fill="#1e293b" />
          <rect x={-26} y={12} width={52} height={4} rx={2} fill="#64748b" />
          <circle cx={-12} cy={16} r={5} fill="#475569" />
          <circle cx={12} cy={16} r={5} fill="#475569" />
        </g>
      );
    case 'werk':
      return feld.name.startsWith('Elektr') ? (
        <path
          d="M4 -24 L-14 4 L-2 4 L-6 24 L14 -6 L2 -6 Z"
          fill="#facc15"
          stroke="#a16207"
          strokeWidth={2}
        />
      ) : (
        <path
          d="M0 -24 C 10 -8 16 0 16 9 A16 16 0 0 1 -16 9 C -16 0 -10 -8 0 -24 Z"
          fill="#38bdf8"
          stroke="#0369a1"
          strokeWidth={2}
        />
      );
    case 'ereignis':
      return (
        <g>
          <circle r={22} fill="#f97316" opacity={0.18} />
          <text y={14} textAnchor="middle" fontSize={40} fontWeight={800} fill="#fb923c">
            ?
          </text>
        </g>
      );
    case 'gemeinschaft':
      return (
        <g>
          <rect x={-20} y={-6} width={40} height={24} rx={3} fill="#60a5fa" />
          <path d="M-20 -6 Q0 -24 20 -6 Z" fill="#93c5fd" />
          <rect x={-4} y={-2} width={8} height={9} rx={1.5} fill="#1e3a8a" />
        </g>
      );
    case 'steuer':
      return (
        <g>
          <circle r={20} fill="#fbbf24" stroke="#b45309" strokeWidth={3} />
          <text y={8} textAnchor="middle" fontSize={22} fontWeight={800} fill="#78350f">
            €
          </text>
        </g>
      );
    default:
      return null;
  }
}

function Ecke({ i, feld }: { i: number; feld: Feld }) {
  const z = zelle(i);
  const inhalt = (() => {
    switch (feld.typ) {
      case 'los':
        return (
          <g>
            <text y={-8} textAnchor="middle" fontSize={34} fontWeight={900} fill="#f8fafc">
              LOS
            </text>
            <path d="M38 12 L-8 12 L-8 2 L-36 20 L-8 38 L-8 28 L38 28 Z" fill="#ef4444" />
          </g>
        );
      case 'parken':
        return (
          <g>
            <rect x={-24} y={-38} width={48} height={48} rx={10} fill="#2563eb" />
            <text y={0} textAnchor="middle" fontSize={36} fontWeight={900} fill="#fff">
              P
            </text>
            <text y={34} textAnchor="middle" fontSize={14} fill={TEXT}>
              Frei Parken
            </text>
          </g>
        );
      case 'gehGefaengnis':
        return (
          <g>
            <circle cy={-10} r={26} fill="#1e3a8a" stroke="#93c5fd" strokeWidth={3} />
            <path
              d="M-14 -12 L14 -12 M-14 -2 L14 -2 M-8 -26 L-8 6 M8 -26 L8 6"
              stroke="#bfdbfe"
              strokeWidth={3}
            />
            <text y={36} textAnchor="middle" fontSize={13} fill={TEXT}>
              Ins Gefängnis
            </text>
          </g>
        );
      default:
        return null;
    }
  })();
  if (feld.typ === 'gefaengnis') {
    // Käfig oben rechts (zur Brettmitte), Besucherstreifen außen.
    return (
      <g>
        <rect
          x={z.x}
          y={z.y}
          width={z.w}
          height={z.h}
          fill={ZELLE_FARBE}
          stroke={ZELLE_RAND}
          strokeWidth={2}
        />
        <rect x={z.x + 48} y={z.y} width={82} height={82} fill="#7c2d12" opacity={0.55} />
        {[0, 1, 2, 3].map((k) => (
          <line
            key={k}
            x1={z.x + 58 + k * 20}
            y1={z.y + 2}
            x2={z.x + 58 + k * 20}
            y2={z.y + 80}
            stroke="#fdba74"
            strokeWidth={3}
            opacity={0.8}
          />
        ))}
        <text x={z.x + 89} y={z.y + 100} textAnchor="middle" fontSize={12} fill={TEXT_LEISE}>
          Gefängnis
        </text>
        <text x={z.x + 40} y={z.y + 124} textAnchor="middle" fontSize={11} fill={TEXT_LEISE}>
          nur zu Besuch
        </text>
      </g>
    );
  }
  return (
    <g>
      <rect
        x={z.x}
        y={z.y}
        width={z.w}
        height={z.h}
        fill={ZELLE_FARBE}
        stroke={ZELLE_RAND}
        strokeWidth={2}
      />
      <g transform={`translate(${z.cx} ${z.cy}) rotate(${(z.rot + 315) % 360})`}>{inhalt}</g>
    </g>
  );
}

interface BrettProps {
  view: MonopolyView;
  seats: TurnSeatInfo[];
  auswahl: number | null;
  onWaehle(feld: number): void;
  /** Felder, auf denen der eigene Sitz gerade etwas tun kann (Hervorhebung). */
  markiert: number[];
  mitte: ReactNode;
}

export function Brett({ view, seats, auswahl, onWaehle, markiert, mitte }: BrettProps) {
  const farbe = (seat: number): string => seats[seat]?.color ?? '#94a3b8';
  const ziel = view.letzteBewegung?.nach ?? null;

  // Figuren je Feld durchzählen, damit sie nebeneinander stehen.
  const belegung = new Map<number, number>();
  const figuren = view.spieler.flatMap((p, seat) => {
    if (p.bankrott) return [];
    const key = p.gefaengnis ? -1 : p.pos;
    const slot = belegung.get(key) ?? 0;
    belegung.set(key, slot + 1);
    const [x, y] = figurPlatz(p.pos, slot, p.gefaengnis);
    return [{ seat, x, y }];
  });

  return (
    <div className="relative aspect-square w-full select-none">
      <svg
        viewBox={`0 0 ${BRETT} ${BRETT}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Spielbrett"
      >
        <defs>
          <radialGradient id="mono-mitte" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor="#14532d" />
            <stop offset="100%" stopColor="#0b1f14" />
          </radialGradient>
          <pattern
            id="mono-hypothek"
            width={10}
            height={10}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={10} height={10} fill="#0f172a" opacity={0.55} />
            <line x1={0} y1={0} x2={0} y2={10} stroke="#f87171" strokeWidth={3} opacity={0.6} />
          </pattern>
        </defs>
        <rect width={BRETT} height={BRETT} fill="#0f172a" />
        <rect
          x={ECKE}
          y={ECKE}
          width={BRETT - 2 * ECKE}
          height={BRETT - 2 * ECKE}
          fill="url(#mono-mitte)"
        />

        {view.felder.map((feld, i) => {
          const z = zelle(i);
          if (z.ecke) return <Ecke key={i} i={i} feld={feld} />;
          const owner = view.besitzer[i] ?? null;
          const h = view.haeuser[i] ?? 0;
          const zeilen = kurzname(feld);
          const hatBalken = feld.typ === 'strasse';
          const oben = -ECKE / 2;
          const textStart = oben + (hatBalken ? 48 : 22);
          return (
            <g
              key={i}
              transform={`translate(${z.cx} ${z.cy}) rotate(${z.rot})`}
              onClick={() => onWaehle(i)}
              className="cursor-pointer"
            >
              <rect
                x={-BREITE / 2}
                y={oben}
                width={BREITE}
                height={ECKE}
                fill={ZELLE_FARBE}
                stroke={ZELLE_RAND}
                strokeWidth={2}
              />
              {hatBalken ? (
                <rect
                  x={-BREITE / 2 + 1}
                  y={oben + 1}
                  width={BREITE - 2}
                  height={28}
                  fill={gruppenFarbe(feld.gruppe)}
                />
              ) : null}
              {h > 0 && h < 5
                ? Array.from({ length: h }, (_, k) => (
                    <path
                      key={k}
                      d={`M${-33 + k * 18} ${oben + 22} l0 -9 l7 -7 l7 7 l0 9 Z`}
                      fill="#16a34a"
                      stroke="#052e16"
                      strokeWidth={1.5}
                    />
                  ))
                : null}
              {h === 5 ? (
                <rect
                  x={-22}
                  y={oben + 5}
                  width={44}
                  height={19}
                  rx={3}
                  fill="#dc2626"
                  stroke="#450a0a"
                  strokeWidth={2}
                />
              ) : null}
              {zeilen.map((zeile, k) => (
                <text
                  key={k}
                  y={textStart + k * 17}
                  textAnchor="middle"
                  fontSize={15}
                  fontWeight={600}
                  fill={TEXT}
                >
                  {zeile}
                </text>
              ))}
              <g transform={`translate(0 ${hatBalken ? 22 : 12})`}>
                <Symbol feld={feld} />
              </g>
              {feld.preis > 0 || feld.steuer > 0 ? (
                <text y={ECKE / 2 - 16} textAnchor="middle" fontSize={14} fill={TEXT_LEISE}>
                  {feld.preis || feld.steuer} €
                </text>
              ) : null}
              {owner !== null ? (
                <rect
                  x={-BREITE / 2 + 3}
                  y={ECKE / 2 - 9}
                  width={BREITE - 6}
                  height={7}
                  rx={3}
                  fill={farbe(owner)}
                />
              ) : null}
              {view.hypothek[i] ? (
                <rect
                  x={-BREITE / 2}
                  y={oben}
                  width={BREITE}
                  height={ECKE}
                  fill="url(#mono-hypothek)"
                />
              ) : null}
            </g>
          );
        })}

        {/* Markierungen: letzte Bewegung, Auswahl, mögliche Aktionen. */}
        {view.felder.map((_, i) => {
          const z = zelle(i);
          const istZiel = ziel === i;
          const istAuswahl = auswahl === i;
          const istMarkiert = markiert.includes(i);
          if (!istZiel && !istAuswahl && !istMarkiert) return null;
          return (
            <rect
              key={`m${i}`}
              x={z.x + 3}
              y={z.y + 3}
              width={z.w - 6}
              height={z.h - 6}
              rx={6}
              fill="none"
              pointerEvents="none"
              stroke={istAuswahl ? '#f8fafc' : istMarkiert ? '#4ade80' : '#fbbf24'}
              strokeWidth={istAuswahl ? 5 : 4}
              strokeDasharray={istMarkiert && !istAuswahl ? '10 6' : undefined}
              className={istMarkiert && !istAuswahl ? 'animate-pulse' : undefined}
            />
          );
        })}

        {figuren.map(({ seat, x, y }) => (
          <g
            key={seat}
            pointerEvents="none"
            style={{
              transform: `translate(${x}px, ${y}px)`,
              transition: 'transform 450ms cubic-bezier(.3,1.4,.5,1)',
            }}
          >
            <ellipse cy={10} rx={11} ry={4} fill="#000" opacity={0.35} />
            <circle
              r={11}
              fill={farbe(seat)}
              stroke={seat === view.am ? '#f8fafc' : '#0f172a'}
              strokeWidth={seat === view.am ? 4 : 2.5}
            />
            <circle cx={-3} cy={-4} r={3.5} fill="#fff" opacity={0.45} />
          </g>
        ))}
      </svg>
      <div
        className="absolute flex flex-col items-center justify-center"
        style={{ left: '13%', top: '13%', width: '74%', height: '74%' }}
      >
        {mitte}
      </div>
    </div>
  );
}
