'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { seatColor } from '../../seatColors';

/** Spiegel von `MuehleView`/`MuehleMove` aus `@palantir/arcade` (Typen einzelner Spiele sind nicht exportiert). */
interface MuehleMove {
  from?: number;
  to: number;
  remove?: number;
}

interface MuehleView {
  board: number[];
  inHand: [number, number];
  onBoard: [number, number];
  turn: number;
  springen: boolean;
  lastMove: MuehleMove | null;
  lastSeat: number | null;
  legal: MuehleMove[];
  finished: boolean;
}

/** Koordinaten der 24 Punkte im 100er-Raster: drei Ringe, je im Uhrzeigersinn ab links oben. */
const POS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let r = 0; r < 3; r += 1) {
    const a = 8 + r * 14;
    const b = 100 - a;
    const m = 50;
    out.push([a, a], [m, a], [b, a], [b, m], [b, b], [m, b], [a, b], [a, m]);
  }
  return out;
})();

const LINES: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let r = 0; r < 3; r += 1)
    for (let i = 0; i < 8; i += 1) out.push([r * 8 + i, r * 8 + ((i + 1) % 8)]);
  for (const k of [1, 3, 5, 7]) out.push([k, k + 8], [k + 8, k + 16]);
  return out;
})();

type Pending = { from?: number; to: number } | null;

function StoneRow({ count, color, label }: { count: number; color: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-24 shrink-0 truncate text-xs text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-1" aria-label={`${count} Steine`}>
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="h-3.5 w-3.5 rounded-full"
            style={{ background: color, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.35)' }}
          />
        ))}
        {count === 0 && <span className="text-xs text-ink-faint">–</span>}
      </div>
    </div>
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
}: TurnBoardProps<MuehleView, MuehleMove>) {
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const myTurn = canAct && !finished && !view.finished && mySeat === view.turn;
  const placing = (view.inHand[view.turn] ?? 0) > 0;
  const colors = [seats[0]?.color ?? seatColor(0), seats[1]?.color ?? seatColor(1)];

  // Neue Stellung ⇒ Auswahl verwerfen (ohne Effekt, damit kein Zwischenbild entsteht).
  const boardKey = view.board.join(',') + view.turn;
  const [seenKey, setSeenKey] = useState(boardKey);
  if (seenKey !== boardKey) {
    setSeenKey(boardKey);
    setSelected(null);
    setPending(null);
  }

  // Geräusch, wenn der Gegner (oder ein Bot) gezogen hat.
  const lastRef = useRef(view.lastMove);
  useEffect(() => {
    if (lastRef.current === view.lastMove) return;
    lastRef.current = view.lastMove;
    if (!view.lastMove) return;
    if (view.finished) sfx(view.lastSeat === mySeat ? 'win' : 'lose');
    else if (view.lastMove.remove !== undefined) sfx('capture');
    else if (view.lastSeat !== mySeat) sfx('place');
  }, [view.lastMove, view.lastSeat, view.finished, mySeat, sfx]);

  const legal = myTurn ? view.legal : [];
  // Höchstens ein paar hundert Züge – ohne Memo, das bei jeder neuen Sicht ohnehin verfiele.
  const movable = new Set(legal.filter((m) => m.from !== undefined).map((m) => m.from!));

  const targets = pending
    ? new Set<number>()
    : placing
      ? new Set(legal.map((m) => m.to))
      : selected === null
        ? new Set<number>()
        : new Set(legal.filter((m) => m.from === selected).map((m) => m.to));

  const removable = new Set(
    pending
      ? legal
          .filter((m) => m.to === pending.to && m.from === pending.from && m.remove !== undefined)
          .map((m) => m.remove!)
      : [],
  );

  function tryTarget(from: number | undefined, to: number) {
    const matches = legal.filter((m) => m.to === to && m.from === from);
    if (matches.length === 0) return;
    if (matches.some((m) => m.remove !== undefined)) {
      sfx('line');
      setPending(from === undefined ? { to } : { from, to });
      return;
    }
    sfx(from === undefined ? 'place' : 'move');
    onMove(from === undefined ? { to } : { from, to });
  }

  function tap(p: number) {
    if (!myTurn) return;
    if (pending) {
      if (removable.has(p)) {
        sfx('capture');
        onMove({ ...pending, remove: p });
      } else {
        setPending(null);
      }
      return;
    }
    if (placing) {
      tryTarget(undefined, p);
      return;
    }
    if (view.board[p] === mySeat) {
      if (movable.has(p)) {
        sfx('click');
        setSelected(selected === p ? null : p);
      }
      return;
    }
    if (selected !== null && targets.has(p)) tryTarget(selected, p);
    else setSelected(null);
  }

  // Vorschau: Während der Wahl des zu nehmenden Steins steht der eigene schon auf dem Ziel.
  const shown = [...view.board];
  if (pending) {
    if (pending.from !== undefined) shown[pending.from] = -1;
    shown[pending.to] = view.turn;
  }

  const last = view.lastMove;
  const hint = !myTurn
    ? view.finished || finished
      ? 'Partie beendet.'
      : 'Warte auf den Zug des Gegners …'
    : pending
      ? 'Mühle! Tippe einen gegnerischen Stein an, um ihn zu nehmen.'
      : placing
        ? `Setze einen Stein (${view.inHand[view.turn]} übrig).`
        : view.springen && view.onBoard[view.turn] === 3
          ? 'Nur noch drei Steine: Du darfst springen.'
          : selected === null
            ? 'Wähle einen Stein zum Ziehen.'
            : 'Tippe ein markiertes Feld an.';

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-3">
      <style>{`
        @keyframes muehle-drop { from { transform: scale(0.3); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        @keyframes muehle-pulse { 0%,100% { opacity: .35 } 50% { opacity: .9 } }
        .muehle-stone { transform-box: fill-box; transform-origin: center; animation: muehle-drop .22s ease-out; }
        .muehle-pulse { animation: muehle-pulse 1.2s ease-in-out infinite; }
      `}</style>
      <div className="flex flex-col gap-1 rounded-tile border border-line bg-surface-deep px-3 py-2">
        <StoneRow count={view.inHand[0]} color={colors[0]!} label={seats[0]?.name ?? 'Rot'} />
        <StoneRow count={view.inHand[1]} color={colors[1]!} label={seats[1]?.name ?? 'Blau'} />
      </div>
      <svg
        viewBox="0 0 100 100"
        className="w-full touch-manipulation select-none rounded-tile"
        role="img"
        aria-label="Mühlebrett"
      >
        <defs>
          <radialGradient id="muehle-wood" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#8a5a2b" />
            <stop offset="70%" stopColor="#5b3719" />
            <stop offset="100%" stopColor="#3a220e" />
          </radialGradient>
          <radialGradient id="muehle-shine" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" rx="4" fill="url(#muehle-wood)" />
        {LINES.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={POS[a]![0]}
            y1={POS[a]![1]}
            x2={POS[b]![0]}
            y2={POS[b]![1]}
            stroke="#f4d9a8"
            strokeOpacity="0.75"
            strokeWidth="0.9"
            strokeLinecap="round"
          />
        ))}
        {POS.map(([x, y], p) => (
          <circle key={`dot${p}`} cx={x} cy={y} r="1.4" fill="#f4d9a8" opacity="0.85" />
        ))}
        {last?.from !== undefined && (
          <circle
            cx={POS[last.from]![0]}
            cy={POS[last.from]![1]}
            r="3"
            fill="none"
            stroke="#fde68a"
            strokeWidth="0.6"
            strokeDasharray="1 1"
          />
        )}
        {last?.remove !== undefined && shown[last.remove] === -1 && (
          <g stroke="#f87171" strokeWidth="0.8" strokeLinecap="round" opacity="0.8">
            <line
              x1={POS[last.remove]![0] - 2}
              y1={POS[last.remove]![1] - 2}
              x2={POS[last.remove]![0] + 2}
              y2={POS[last.remove]![1] + 2}
            />
            <line
              x1={POS[last.remove]![0] + 2}
              y1={POS[last.remove]![1] - 2}
              x2={POS[last.remove]![0] - 2}
              y2={POS[last.remove]![1] + 2}
            />
          </g>
        )}
        {shown.map((owner, p) => {
          if (owner < 0) return null;
          const [x, y] = POS[p]!;
          const isLast = last?.to === p;
          return (
            <g key={`s${p}-${owner}`} className="muehle-stone">
              <circle cx={x} cy={y + 0.8} r="4.6" fill="#000" opacity="0.35" />
              <circle
                cx={x}
                cy={y}
                r="4.6"
                fill={colors[owner]}
                stroke="rgba(0,0,0,0.45)"
                strokeWidth="0.4"
              />
              <circle
                cx={x}
                cy={y}
                r="3"
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="0.35"
              />
              <circle cx={x} cy={y} r="4.6" fill="url(#muehle-shine)" />
              {isLast && (
                <circle cx={x} cy={y} r="5.8" fill="none" stroke="#fde68a" strokeWidth="0.6" />
              )}
              {selected === p && (
                <circle cx={x} cy={y} r="6" fill="none" stroke="#fff" strokeWidth="0.8" />
              )}
              {removable.has(p) && (
                <circle
                  className="muehle-pulse"
                  cx={x}
                  cy={y}
                  r="6"
                  fill="none"
                  stroke="#f87171"
                  strokeWidth="1"
                />
              )}
              {myTurn && !pending && selected === null && !placing && movable.has(p) && (
                <circle
                  cx={x}
                  cy={y}
                  r="5.6"
                  fill="none"
                  stroke="#fff"
                  strokeOpacity="0.35"
                  strokeWidth="0.4"
                />
              )}
            </g>
          );
        })}
        {[...targets].map((p) => (
          <circle
            key={`t${p}`}
            className="muehle-pulse"
            cx={POS[p]![0]}
            cy={POS[p]![1]}
            r="2.6"
            fill={colors[view.turn]}
          />
        ))}
        {POS.map(([x, y], p) => (
          <circle
            key={`hit${p}`}
            cx={x}
            cy={y}
            r="6.5"
            fill="transparent"
            className={cn(myTurn && 'cursor-pointer')}
            onClick={() => tap(p)}
          />
        ))}
      </svg>
      <p className="text-center text-sm text-ink-muted" aria-live="polite">
        {hint}
      </p>
      {pending && myTurn && (
        <button
          type="button"
          onClick={() => setPending(null)}
          className="self-center rounded-tile border border-line-strong bg-fill px-3 py-1.5 text-sm text-ink"
        >
          Zug zurücknehmen
        </button>
      )}
    </div>
  );
}
