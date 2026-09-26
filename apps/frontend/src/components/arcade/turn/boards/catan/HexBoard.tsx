'use client';

import { memo } from 'react';
import { ResGlyph, landColor } from './icons';
import { type CatanView } from './types';

/**
 * Das Inselbrett als SVG.
 *
 * Die Regel liefert ganzzahlige Koordinaten (x in √3/2-Schritten, y in
 * halben Feldgrößen); hier werden sie nur noch mit der Feldgröße gestreckt.
 * Klickbare Ziele bekommen eine unsichtbare, breite Trefferfläche – auf dem
 * Handy sind Kreuzungen und Kanten sonst kaum zu treffen.
 */

export const HEX = 56;
const SX = HEX * 0.8660254;
const SY = HEX / 2;
const CORNERS = [
  [0, -2],
  [1, -1],
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
] as const;

const px = (x: number): number => x * SX;
const py = (y: number): number => y * SY;

function hexCenter(q: number, r: number): { cx: number; cy: number } {
  return { cx: px(2 * q + r), cy: py(3 * r) };
}

function hexPoints(cx: number, cy: number, scale: number): string {
  return CORNERS.map(
    ([x, y]) => `${(cx + px(x) * scale).toFixed(1)},${(cy + py(y) * scale).toFixed(1)}`,
  ).join(' ');
}

function pipsOf(num: number): number {
  return num >= 2 && num <= 12 && num !== 7 ? 6 - Math.abs(7 - num) : 0;
}

export type BoardMode = 'none' | 'settlement' | 'road' | 'city' | 'robber';

export interface HexBoardProps {
  view: CatanView;
  colors: string[];
  uid: string;
  mode: BoardMode;
  targetVertices: number[];
  targetEdges: number[];
  targetHexes: number[];
  onVertex(v: number): void;
  onEdge(e: number): void;
  onHex(h: number): void;
}

function Settlement({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <path
      d={`M${x - 8} ${y + 7} V${y - 2} L${x} ${y - 10} L${x + 8} ${y - 2} V${y + 7} Z`}
      fill={color}
      stroke="#111827"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  );
}

function City({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g stroke="#111827" strokeWidth="2" strokeLinejoin="round">
      <path
        d={`M${x - 13} ${y + 9} V${y - 3} L${x - 6} ${y - 10} L${x + 1} ${y - 3} V${y - 1} H${x + 13} V${y + 9} Z`}
        fill={color}
      />
      <rect x={x + 3} y={y + 2} width="4" height="4" fill="#fef3c7" strokeWidth="1" />
      <rect x={x - 8} y={y} width="4" height="4" fill="#fef3c7" strokeWidth="1" />
    </g>
  );
}

function Robber({ cx, cy }: { cx: number; cy: number }) {
  // Kapuzengestalt mit leuchtenden Augen – bewusst nicht die bekannte Holzfigur.
  return (
    <g
      pointerEvents="none"
      className="transition-transform duration-500"
      style={{ transform: `translate(${cx}px, ${cy}px)` }}
    >
      <ellipse cx="0" cy="14" rx="11" ry="3.5" fill="#000" opacity="0.35" />
      <path
        d="M-10 14 Q-11 -2 0 -14 Q11 -2 10 14 Z"
        fill="#1f2230"
        stroke="#0b0c12"
        strokeWidth="1.5"
      />
      <circle cx="0" cy="-5" r="6" fill="#0b0c12" />
      <circle cx="-2.2" cy="-5.5" r="1.3" fill="#fbbf24" />
      <circle cx="2.2" cy="-5.5" r="1.3" fill="#fbbf24" />
    </g>
  );
}

function HexBoardImpl(props: HexBoardProps) {
  const { view, colors, uid, mode, targetVertices, targetEdges, targetHexes } = props;
  const { geo } = view;
  const color = (seat: number): string => colors[seat] ?? '#94a3b8';
  const vx = (v: number): number => px(geo.vertices[v]?.x ?? 0);
  const vy = (v: number): number => py(geo.vertices[v]?.y ?? 0);
  const edgeEnds = (e: number): [number, number] => geo.edges[e] ?? [0, 0];

  const lastVertices = new Set(
    view.lastBuilt.filter((b) => b.kind === 'settlement' || b.kind === 'city').map((b) => b.at),
  );
  const lastEdges = new Set(view.lastBuilt.filter((b) => b.kind === 'road').map((b) => b.at));
  const robberHex = geo.hexes[view.robber] ?? { q: 0, r: 0 };
  const robberAt = hexCenter(robberHex.q, robberHex.r);

  const sea = [0, 60, 120, 180, 240, 300]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return `${(322 * Math.cos(rad)).toFixed(1)},${(322 * Math.sin(rad)).toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox="-330 -290 660 580"
      className="block h-auto w-full select-none"
      role="img"
      aria-label="Spielbrett der Insel"
    >
      <defs>
        <radialGradient id={`${uid}-sea`} cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="#2aa7c9" />
          <stop offset="100%" stopColor="#0c4a6e" />
        </radialGradient>
        <pattern id={`${uid}-waves`} width="40" height="22" patternUnits="userSpaceOnUse">
          <path
            d="M0 11 Q10 5 20 11 T40 11"
            fill="none"
            stroke="#7dd3fc"
            strokeWidth="1.2"
            opacity="0.25"
          />
        </pattern>
        {[0, 1, 2, 3, 4, -1].map((res) => {
          const [light, dark] = landColor(res);
          return (
            <radialGradient key={res} id={`${uid}-land${res}`} cx="45%" cy="35%" r="75%">
              <stop offset="0%" stopColor={light} />
              <stop offset="100%" stopColor={dark} />
            </radialGradient>
          );
        })}
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Meer und Strand */}
      <polygon
        points={sea}
        fill={`url(#${uid}-sea)`}
        stroke="#082f49"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <polygon points={sea} fill={`url(#${uid}-waves)`} />
      {geo.hexes.map((h, i) => {
        const { cx, cy } = hexCenter(h.q, h.r);
        return (
          <polygon
            key={`sand${i}`}
            points={hexPoints(cx, cy, 1.1)}
            fill="#e9d8a6"
            stroke="#e9d8a6"
            strokeWidth="6"
          />
        );
      })}

      {/* Häfen: Steg von beiden Kreuzungen zu einem Schild im Wasser */}
      {view.ports.map((port, i) => {
        const [a, b] = edgeEnds(port.edge);
        const mx = (vx(a) + vx(b)) / 2;
        const my = (vy(a) + vy(b)) / 2;
        const len = Math.hypot(mx, my) || 1;
        const ox = mx + (mx / len) * 34;
        const oy = my + (my / len) * 34;
        return (
          <g key={`port${i}`}>
            <line
              x1={vx(a)}
              y1={vy(a)}
              x2={ox}
              y2={oy}
              stroke="#8b5a2b"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <line
              x1={vx(b)}
              y1={vy(b)}
              x2={ox}
              y2={oy}
              stroke="#8b5a2b"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx={ox} cy={oy} r="17" fill="#fff7e6" stroke="#8b5a2b" strokeWidth="2.5" />
            {port.kind >= 0 ? (
              <>
                <g transform={`translate(${ox - 8} ${oy - 15}) scale(0.68)`}>
                  <ResGlyph res={port.kind} />
                </g>
                <text
                  x={ox}
                  y={oy + 12}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="800"
                  fill="#5b3715"
                >
                  2:1
                </text>
              </>
            ) : (
              <text
                x={ox}
                y={oy + 4}
                textAnchor="middle"
                fontSize="12"
                fontWeight="800"
                fill="#5b3715"
              >
                3:1
              </text>
            )}
          </g>
        );
      })}

      {/* Landfelder */}
      {geo.hexes.map((h, i) => {
        const { cx, cy } = hexCenter(h.q, h.r);
        const res = view.hexRes[i] ?? -1;
        const num = view.hexNum[i] ?? 0;
        const red = num === 6 || num === 8;
        const pips = pipsOf(num);
        return (
          <g key={`hex${i}`}>
            <polygon
              points={hexPoints(cx, cy, 0.96)}
              fill={`url(#${uid}-land${res})`}
              stroke="#3f2d1a"
              strokeOpacity="0.35"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <g transform={`translate(${cx - 19} ${cy - 40}) scale(1.6)`} opacity="0.95">
              <ResGlyph res={res} />
            </g>
            {num > 0 && (
              <g>
                <circle
                  cx={cx}
                  cy={cy + 15}
                  r="16"
                  fill="#fdf6e3"
                  stroke="#7c5b33"
                  strokeWidth="1.5"
                />
                <text
                  x={cx}
                  y={cy + 18}
                  textAnchor="middle"
                  fontSize={red ? 17 : 15}
                  fontWeight="900"
                  fill={red ? '#dc2626' : '#2b2118'}
                >
                  {num}
                </text>
                {Array.from({ length: pips }, (_, k) => (
                  <circle
                    key={k}
                    cx={cx + (k - (pips - 1) / 2) * 3.6}
                    cy={cy + 25}
                    r="1.3"
                    fill={red ? '#dc2626' : '#2b2118'}
                  />
                ))}
              </g>
            )}
          </g>
        );
      })}

      {/* Räuber-Ziele */}
      {mode === 'robber' &&
        targetHexes.map((i) => {
          const h = geo.hexes[i];
          if (!h) return null;
          const { cx, cy } = hexCenter(h.q, h.r);
          return (
            <polygon
              key={`rt${i}`}
              points={hexPoints(cx, cy, 0.9)}
              fill="#ffffff"
              fillOpacity="0.14"
              stroke="#fde047"
              strokeWidth="3"
              strokeDasharray="7 5"
              className="cursor-pointer"
              onClick={() => props.onHex(i)}
            />
          );
        })}

      {/* Straßen */}
      {view.eOwner.map((owner, e) => {
        if (owner < 0) return null;
        const [a, b] = edgeEnds(e);
        const x1 = vx(a) + (vx(b) - vx(a)) * 0.14;
        const y1 = vy(a) + (vy(b) - vy(a)) * 0.14;
        const x2 = vx(b) + (vx(a) - vx(b)) * 0.14;
        const y2 = vy(b) + (vy(a) - vy(b)) * 0.14;
        const fresh = lastEdges.has(e);
        return (
          <g key={`road${e}`} filter={fresh ? `url(#${uid}-glow)` : undefined}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#111827"
              strokeWidth="11"
              strokeLinecap="round"
            />
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color(owner)}
              strokeWidth="7"
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {/* Mögliche Straßen */}
      {mode === 'road' &&
        targetEdges.map((e) => {
          const [a, b] = edgeEnds(e);
          return (
            <g key={`et${e}`} className="cursor-pointer" onClick={() => props.onEdge(e)}>
              <line
                x1={vx(a)}
                y1={vy(a)}
                x2={vx(b)}
                y2={vy(b)}
                stroke="#ffffff"
                strokeOpacity="0.85"
                strokeWidth="5"
                strokeDasharray="6 5"
                strokeLinecap="round"
                className="animate-pulse"
              />
              <line
                x1={vx(a)}
                y1={vy(a)}
                x2={vx(b)}
                y2={vy(b)}
                stroke="transparent"
                strokeWidth="22"
              />
            </g>
          );
        })}

      {/* Siedlungen und Städte */}
      {view.vOwner.map((owner, v) => {
        if (owner < 0) return null;
        const x = vx(v);
        const y = vy(v);
        return (
          <g key={`b${v}`} filter={lastVertices.has(v) ? `url(#${uid}-glow)` : undefined}>
            {view.vCity[v] ? (
              <City x={x} y={y} color={color(owner)} />
            ) : (
              <Settlement x={x} y={y} color={color(owner)} />
            )}
          </g>
        );
      })}

      {/* Mögliche Siedlungs- bzw. Stadtplätze */}
      {(mode === 'settlement' || mode === 'city') &&
        targetVertices.map((v) => (
          <g key={`vt${v}`} className="cursor-pointer" onClick={() => props.onVertex(v)}>
            <circle
              cx={vx(v)}
              cy={vy(v)}
              r={mode === 'city' ? 15 : 9}
              fill={mode === 'city' ? 'none' : '#ffffff'}
              fillOpacity="0.45"
              stroke="#ffffff"
              strokeWidth="2.5"
              className="animate-pulse"
            />
            <circle cx={vx(v)} cy={vy(v)} r="19" fill="transparent" />
          </g>
        ))}

      <Robber cx={robberAt.cx} cy={robberAt.cy - 18} />
    </svg>
  );
}

export const HexBoard = memo(HexBoardImpl);
