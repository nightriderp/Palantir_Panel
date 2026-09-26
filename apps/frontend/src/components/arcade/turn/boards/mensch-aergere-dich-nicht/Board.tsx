'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { seatColor } from '../../seatColors';

/** Spiegel von `MaednView`/`MaednMove` aus `@palantir/arcade` (Typen einzelner Spiele sind nicht exportiert). */
type MaednMove = { type: 'wuerfeln' } | { type: 'figur'; piece: number };

interface MaednChoice {
  piece: number;
  from: number;
  to: number;
  captures: number | null;
}

interface MaednView {
  players: number;
  corners: number[];
  pieces: number[][];
  turn: number;
  phase: 'wuerfeln' | 'ziehen';
  die: number;
  attempts: number;
  threeTries: boolean;
  legal: MaednChoice[];
  lastMove: { seat: number; piece: number; from: number; to: number } | null;
  schlagpflicht: boolean;
  finished: boolean;
}

// ---------------------------------------------------------------------------
// Brett: 11×11-Raster, Laufbahn im Uhrzeigersinn ab dem Startfeld der Ecke
// oben links. Ecken 0–3: oben links, oben rechts, unten rechts, unten links.
// ---------------------------------------------------------------------------

const TRACK: [number, number][] = [
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
  [4, 4],
  [4, 3],
  [4, 2],
  [4, 1],
  [4, 0],
  [5, 0],
  [6, 0],
  [6, 1],
  [6, 2],
  [6, 3],
  [6, 4],
  [7, 4],
  [8, 4],
  [9, 4],
  [10, 4],
  [10, 5],
  [10, 6],
  [9, 6],
  [8, 6],
  [7, 6],
  [6, 6],
  [6, 7],
  [6, 8],
  [6, 9],
  [6, 10],
  [5, 10],
  [4, 10],
  [4, 9],
  [4, 8],
  [4, 7],
  [4, 6],
  [3, 6],
  [2, 6],
  [1, 6],
  [0, 6],
  [0, 5],
];

const GOALS: [number, number][][] = [
  [
    [1, 5],
    [2, 5],
    [3, 5],
    [4, 5],
  ],
  [
    [5, 1],
    [5, 2],
    [5, 3],
    [5, 4],
  ],
  [
    [9, 5],
    [8, 5],
    [7, 5],
    [6, 5],
  ],
  [
    [5, 9],
    [5, 8],
    [5, 7],
    [5, 6],
  ],
];

const HOUSES: [number, number][][] = [
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [9, 0],
    [10, 0],
    [9, 1],
    [10, 1],
  ],
  [
    [9, 9],
    [10, 9],
    [9, 10],
    [10, 10],
  ],
  [
    [0, 9],
    [1, 9],
    [0, 10],
    [1, 10],
  ],
];

const CELL = 10;
const center = ([x, y]: [number, number]): [number, number] => [
  x * CELL + CELL / 2,
  y * CELL + CELL / 2,
];

function cellOf(corner: number, piece: number, rel: number): [number, number] {
  if (rel < 0) return HOUSES[corner]![piece]!;
  if (rel >= 40) return GOALS[corner]![rel - 40]!;
  return TRACK[(corner * 10 + rel) % 40]!;
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

/** Spielfigur: Kegel mit Kopf, von oben gesehen als Scheibe mit Glanzlicht. */
function Pawn({ color, ring, pulse }: { color: string; ring?: boolean; pulse?: boolean }) {
  return (
    <g>
      <ellipse cx="0" cy="1.2" rx="3.9" ry="3.2" fill="#000" opacity="0.35" />
      <circle cx="0" cy="0" r="3.7" fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth="0.35" />
      <circle
        cx="0"
        cy="-0.6"
        r="1.9"
        fill={color}
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="0.35"
      />
      <circle cx="-0.9" cy="-1.4" r="0.8" fill="#fff" opacity="0.55" />
      {ring && (
        <circle
          className={cn(pulse && 'maedn-pulse')}
          cx="0"
          cy="0"
          r="4.8"
          fill="none"
          stroke="#fff"
          strokeWidth="0.7"
        />
      )}
    </g>
  );
}

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<MaednView, MaednMove>) {
  const color = (seat: number): string => seats[seat]?.color ?? seatColor(seat);
  const myTurn = canAct && !finished && !view.finished && mySeat === view.turn;
  const legal = myTurn && view.phase === 'ziehen' ? view.legal : [];
  const legalByPiece = new Map(legal.map((c) => [c.piece, c]));

  // Geräusche: neuer Wurf, gezogene Figur, geschlagene Figur, Sieg.
  const prev = useRef({
    pieces: JSON.stringify(view.pieces),
    die: view.die,
    turn: view.turn,
    attempts: view.attempts,
    last: view.lastMove,
  });
  useEffect(() => {
    const before = prev.current;
    const pieces = JSON.stringify(view.pieces);
    prev.current = {
      pieces,
      die: view.die,
      turn: view.turn,
      attempts: view.attempts,
      last: view.lastMove,
    };
    if (view.finished && before.pieces !== pieces) {
      sfx(view.lastMove?.seat === mySeat ? 'win' : 'lose');
      return;
    }
    if (before.pieces !== pieces) {
      const old = JSON.parse(before.pieces) as number[][];
      const captured = view.pieces.some((p, s) =>
        p.some((r, i) => r < 0 && (old[s]?.[i] ?? -1) >= 0),
      );
      sfx(captured ? 'capture' : 'move');
    } else if (
      before.die !== view.die ||
      before.attempts !== view.attempts ||
      before.turn !== view.turn
    ) {
      if (view.die > 0) sfx('dice');
    }
  }, [view.pieces, view.die, view.turn, view.attempts, view.lastMove, view.finished, mySeat, sfx]);

  function choose(piece: number) {
    if (!legalByPiece.has(piece)) return;
    onMove({ type: 'figur', piece });
  }

  function roll() {
    if (!myTurn || view.phase !== 'wuerfeln') return;
    onMove({ type: 'wuerfeln' });
  }

  const activeCorners = new Set(view.corners);
  const lastCell = view.lastMove
    ? cellOf(view.corners[view.lastMove.seat]!, view.lastMove.piece, view.lastMove.to)
    : null;
  const lastFrom = view.lastMove
    ? cellOf(view.corners[view.lastMove.seat]!, view.lastMove.piece, view.lastMove.from)
    : null;
  const canRoll = myTurn && view.phase === 'wuerfeln';
  const dieKey = `${view.turn}-${view.die}-${view.attempts}-${JSON.stringify(view.lastMove)}`;

  const hint = !myTurn
    ? view.finished || finished
      ? 'Partie beendet.'
      : `${seats[view.turn]?.name ?? 'Der Gegner'} ist am Zug …`
    : view.phase === 'wuerfeln'
      ? view.threeTries
        ? `Tippe auf den Würfel – Versuch ${view.attempts + 1} von 3.`
        : 'Tippe auf den Würfel.'
      : `Du hast eine ${view.die} – wähle eine leuchtende Figur.`;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3">
      <style>{`
        @keyframes maedn-roll { 0% { transform: rotate(-200deg) scale(.4) } 70% { transform: rotate(20deg) scale(1.12) } 100% { transform: rotate(0) scale(1) } }
        @keyframes maedn-pulse { 0%,100% { opacity: .3 } 50% { opacity: 1 } }
        @keyframes maedn-bob { 0%,100% { transform: scale(1) } 50% { transform: scale(1.08) } }
        .maedn-die { animation: maedn-roll .5s cubic-bezier(.2,.8,.3,1.2); transform-box: fill-box; transform-origin: center; }
        .maedn-pulse { animation: maedn-pulse 1s ease-in-out infinite; }
        .maedn-bob { animation: maedn-bob 1.1s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        .maedn-piece { transition: transform .35s cubic-bezier(.3,.7,.3,1); }
      `}</style>
      <svg
        viewBox="0 0 110 110"
        className="w-full touch-manipulation select-none"
        role="img"
        aria-label="Spielbrett"
      >
        <defs>
          <radialGradient id="maedn-board" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#fde7b0" />
            <stop offset="100%" stopColor="#e2b86a" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="110" height="110" rx="5" fill="url(#maedn-board)" />
        {/* Hausflächen je Ecke in der Sitzfarbe (nur belegte Ecken kräftig). */}
        {[0, 1, 2, 3].map((corner) => {
          const seat = view.corners.indexOf(corner);
          const [x, y] = HOUSES[corner]![0]!;
          return (
            <rect
              key={`hz${corner}`}
              x={x * CELL + 0.8}
              y={y * CELL + 0.8}
              width={CELL * 2 - 1.6}
              height={CELL * 2 - 1.6}
              rx="4"
              fill={seat >= 0 ? color(seat) : '#a8a29e'}
              opacity={seat >= 0 ? 0.28 : 0.12}
            />
          );
        })}
        {/* Laufweg */}
        <polyline
          points={[...TRACK, TRACK[0]!].map((c) => center(c).join(',')).join(' ')}
          fill="none"
          stroke="#7c4a14"
          strokeOpacity="0.35"
          strokeWidth="1.2"
        />
        {TRACK.map((c, i) => {
          const corner = i % 10 === 0 ? i / 10 : -1;
          const seat = corner >= 0 ? view.corners.indexOf(corner) : -1;
          const [cx, cy] = center(c);
          return (
            <circle
              key={`t${i}`}
              cx={cx}
              cy={cy}
              r="3.9"
              fill={seat >= 0 ? color(seat) : '#fffaf0'}
              fillOpacity={seat >= 0 ? 0.55 : 1}
              stroke="#7c4a14"
              strokeWidth="0.5"
            />
          );
        })}
        {GOALS.map((g, corner) =>
          g.map((c, i) => {
            const seat = view.corners.indexOf(corner);
            const [cx, cy] = center(c);
            return (
              <circle
                key={`g${corner}-${i}`}
                cx={cx}
                cy={cy}
                r="3.6"
                fill={activeCorners.has(corner) ? color(seat) : '#d6d3d1'}
                fillOpacity="0.35"
                stroke="#7c4a14"
                strokeWidth="0.5"
              />
            );
          }),
        )}
        {HOUSES.map((h, corner) =>
          h.map((c, i) => {
            const [cx, cy] = center(c);
            return (
              <circle
                key={`h${corner}-${i}`}
                cx={cx}
                cy={cy}
                r="3.6"
                fill="#fffaf0"
                fillOpacity="0.55"
                stroke="#7c4a14"
                strokeWidth="0.4"
              />
            );
          }),
        )}
        {lastFrom && (
          <circle
            cx={center(lastFrom)[0]}
            cy={center(lastFrom)[1]}
            r="4.6"
            fill="none"
            stroke="#b45309"
            strokeWidth="0.5"
            strokeDasharray="1 1"
          />
        )}
        {lastCell && (
          <circle
            cx={center(lastCell)[0]}
            cy={center(lastCell)[1]}
            r="5"
            fill="none"
            stroke="#b45309"
            strokeWidth="0.8"
          />
        )}
        {/* Ziele möglicher Züge */}
        {legal.map((c) => {
          const [cx, cy] = center(cellOf(view.corners[view.turn]!, c.piece, c.to));
          return (
            <g key={`z${c.piece}`} onClick={() => choose(c.piece)} className="cursor-pointer">
              <circle
                className="maedn-pulse"
                cx={cx}
                cy={cy}
                r="4.4"
                fill="none"
                stroke={color(view.turn)}
                strokeWidth="1"
                strokeDasharray="1.6 1"
              />
              {c.captures !== null && (
                <text x={cx} y={cy + 1.6} textAnchor="middle" fontSize="4.6" fill="#b91c1c">
                  ✕
                </text>
              )}
            </g>
          );
        })}
        {/* Figuren – gleitend über `transform`, damit ein Zug sichtbar wandert. */}
        {view.pieces.map((pcs, seat) =>
          pcs.map((rel, piece) => {
            const [cx, cy] = center(cellOf(view.corners[seat]!, piece, rel));
            const canPick = seat === view.turn && legalByPiece.has(piece);
            return (
              <g
                key={`p${seat}-${piece}`}
                className="maedn-piece"
                style={{ transform: `translate(${cx}px, ${cy}px)` }}
                onClick={() => (canPick ? choose(piece) : undefined)}
              >
                <g className={cn(canPick && 'maedn-bob cursor-pointer')}>
                  <Pawn color={color(seat)} ring={canPick} pulse={canPick} />
                </g>
                {/* Große unsichtbare Tippfläche für kleine Bildschirme. */}
                <circle cx="0" cy="0" r="5" fill="transparent" />
              </g>
            );
          }),
        )}
        {/* Würfel in der Mitte */}
        <g onClick={roll} className={cn(canRoll && 'cursor-pointer')}>
          <rect x="45.5" y="45.5" width="19" height="19" rx="4" fill="transparent" />
          <g transform="translate(55 55)">
            <g key={dieKey} className={cn(view.die > 0 && 'maedn-die')}>
              <rect
                x="-7"
                y="-7"
                width="14"
                height="14"
                rx="3"
                fill="#fffdf7"
                stroke={color(view.turn)}
                strokeWidth="1.1"
              />
              {(PIPS[view.die] ?? []).map(([dx, dy], i) => (
                <circle key={i} cx={dx * 3.6} cy={dy * 3.6} r="1.25" fill="#1f2937" />
              ))}
              {view.die === 0 && (
                <text x="0" y="1.8" textAnchor="middle" fontSize="5" fill="#78716c">
                  ?
                </text>
              )}
            </g>
            {canRoll && (
              <rect
                className="maedn-pulse"
                x="-8.5"
                y="-8.5"
                width="17"
                height="17"
                rx="3.8"
                fill="none"
                stroke={color(view.turn)}
                strokeWidth="0.8"
              />
            )}
          </g>
        </g>
      </svg>
      <p className="text-center text-sm text-ink-muted" aria-live="polite">
        {hint}
      </p>
      {canRoll && (
        <button
          type="button"
          onClick={roll}
          className="min-h-[44px] self-center rounded-tile bg-brand-gradient px-6 text-base font-semibold text-white shadow-glow"
        >
          Würfeln
        </button>
      )}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {view.pieces.map((pcs, seat) => (
          <div
            key={seat}
            className={cn(
              'flex items-center gap-2 rounded-tile border bg-surface-deep px-3 py-1.5 transition',
              seat === view.turn && !view.finished ? 'border-line-strong' : 'border-line',
            )}
          >
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color(seat) }} />
            <span className="min-w-0 flex-1 truncate text-ink">
              {seats[seat]?.name ?? `Sitz ${seat + 1}`}
            </span>
            <span className="text-xs text-ink-muted">{pcs.filter((r) => r >= 40).length}/4</span>
          </div>
        ))}
      </div>
    </div>
  );
}
