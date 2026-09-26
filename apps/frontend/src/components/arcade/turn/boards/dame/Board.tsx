'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';

/** Spiegel von `DameView`/`DameMove` aus `@palantir/arcade` (Typen einzelner Spiele sind nicht exportiert). */
interface DameView {
  board: string;
  side: 0 | 1;
  legal: number[][];
  mustCapture: boolean;
  lastPath: number[] | null;
  lastCaptured: number[];
  quiet: number;
  quietLimit: number;
  result: { winners: number[]; summary: string } | null;
}

interface DameMove {
  path: number[];
}

const COLOR_NAME = ['Weiß', 'Schwarz'];
const LIGHT = '#ead9b9';
const DARK = '#6e2c2c';

function startsWith(path: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((sq, i) => path[i] === sq);
}

function Stone({ code, className }: { code: string; className?: string }) {
  const white = code.toLowerCase() === 'w';
  const king = code === 'W' || code === 'B';
  return (
    <span
      className={cn('relative flex items-center justify-center rounded-full', className)}
      style={{
        background: white
          ? 'radial-gradient(circle at 35% 30%, #fffdf6 0%, #efe3c8 55%, #c9b48d 100%)'
          : 'radial-gradient(circle at 35% 30%, #4b4b52 0%, #232327 60%, #0e0e10 100%)',
        boxShadow: white
          ? '0 3px 0 #a08a62, 0 5px 8px rgba(0,0,0,0.45), inset 0 0 0 3px rgba(160,138,98,0.35)'
          : '0 3px 0 #000, 0 5px 8px rgba(0,0,0,0.55), inset 0 0 0 3px rgba(239,68,68,0.55)',
      }}
    >
      {king && (
        <svg viewBox="0 0 40 30" className="h-[46%] w-[46%]" aria-hidden>
          <path
            d="M4 26 L2 8 L12 16 L20 3 L28 16 L38 8 L36 26 Z"
            fill={white ? '#b8860b' : '#f59e0b'}
            stroke={white ? '#6b4f12' : '#fde68a'}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
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
}: TurnBoardProps<DameView, DameMove>) {
  const [prefix, setPrefix] = useState<number[]>([]);
  const flipped = mySeat === 1;
  const myTurn = canAct && !finished && !view.result && mySeat === view.side;

  const [seenBoard, setSeenBoard] = useState(view.board);
  if (seenBoard !== view.board) {
    setSeenBoard(view.board);
    setPrefix([]);
  }

  const candidates = useMemo(
    () => (prefix.length ? view.legal.filter((p) => startsWith(p, prefix)) : []),
    [prefix, view.legal],
  );
  const nextSteps = useMemo(
    () =>
      new Set(candidates.map((p) => p[prefix.length]).filter((x): x is number => x !== undefined)),
    [candidates, prefix.length],
  );
  const endSquares = useMemo(() => new Set(candidates.map((p) => p[p.length - 1]!)), [candidates]);
  const movable = useMemo(() => new Set(view.legal.map((p) => p[0]!)), [view.legal]);

  const prev = useRef<DameView | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before || before.board === view.board) return;
    if (view.result && !before.result) {
      const won = mySeat !== null && view.result.winners.includes(mySeat);
      const lost = mySeat !== null && view.result.winners.length > 0 && !won;
      sfx(won ? 'win' : lost ? 'lose' : 'score');
      return;
    }
    const kings = (b: string) => [...b].filter((c) => c === 'W' || c === 'B').length;
    if (kings(view.board) > kings(before.board)) sfx('powerup');
    else sfx(view.lastCaptured.length > 0 ? 'capture' : 'move');
  }, [view, sfx, mySeat]);

  const submit = (path: number[]) => {
    setPrefix([]);
    onMove({ path });
  };

  const tap = (sq: number) => {
    if (!myTurn) return;
    if (prefix.length > 0 && nextSteps.has(sq)) {
      const next = [...prefix, sq];
      const complete = candidates.find((p) => p.length === next.length && startsWith(p, next));
      if (complete) submit(complete);
      else {
        setPrefix(next);
        sfx('click');
      }
      return;
    }
    if (prefix.length > 0 && endSquares.has(sq)) {
      const matches = candidates.filter((p) => p[p.length - 1] === sq);
      if (matches.length === 1) submit(matches[0]!);
      else sfx('error');
      return;
    }
    if (movable.has(sq)) {
      setPrefix(prefix[0] === sq && prefix.length === 1 ? [] : [sq]);
      sfx('click');
      return;
    }
    const code = view.board[sq] ?? '.';
    const own = code !== '.' && (code.toLowerCase() === 'w') === (view.side === 0);
    if (own) sfx('error');
    setPrefix([]);
  };

  const squares: number[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const rank = flipped ? row : 7 - row;
      const file = flipped ? 7 - col : col;
      squares.push(rank * 8 + file);
    }
  }

  const count = (ch: string) => [...view.board].filter((c) => c.toLowerCase() === ch).length;
  const seatName = (i: number) => seats[i]?.name ?? COLOR_NAME[i] ?? '';
  const movesLeft = Math.ceil((view.quietLimit - view.quiet) / 2);

  let status: string;
  if (view.result) status = view.result.summary;
  else if (myTurn) {
    if (prefix.length > 1) status = 'Weiter springen – tipp das nächste Feld.';
    else status = view.mustCapture ? 'Du bist am Zug – Schlagpflicht!' : 'Du bist am Zug.';
  } else status = `${seatName(view.side)} ist am Zug.`;

  const lastSet = new Set(view.lastPath ?? []);
  const capturedSet = new Set(view.lastCaptured);

  const playerRow = (color: 0 | 1) => (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <Stone code={color === 0 ? 'w' : 'b'} className="h-4 w-4 shrink-0" />
        <span
          className={cn(
            'truncate font-semibold',
            view.side === color && !view.result ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {seatName(color)}
        </span>
      </span>
      <span className="text-xs text-ink-muted tabular-nums">
        {count(color === 0 ? 'w' : 'b')} Steine
      </span>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[540px] flex-col gap-2 select-none">
      {playerRow(flipped ? 0 : 1)}
      <div
        className="grid aspect-square w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-tile shadow-lg ring-1 ring-black/40"
        role="grid"
        aria-label="Damebrett"
      >
        {squares.map((sq) => {
          const file = sq & 7;
          const rank = sq >> 3;
          const dark = (file + rank) % 2 === 0;
          const code = view.board[sq] ?? '.';
          const inPrefix = prefix.includes(sq);
          const isNext = nextSteps.has(sq);
          const isEnd = endSquares.has(sq) && !isNext;
          const canMove = myTurn && prefix.length === 0 && movable.has(sq);
          return (
            <button
              key={sq}
              type="button"
              disabled={!myTurn || !dark}
              onClick={() => tap(sq)}
              aria-label={`${'abcdefgh'[file]}${rank + 1}`}
              className="relative flex items-center justify-center disabled:cursor-default"
              style={{ background: dark ? DARK : LIGHT }}
            >
              {lastSet.has(sq) && <span className="absolute inset-0 bg-amber-300/25" />}
              {inPrefix && <span className="absolute inset-0 bg-sky-400/40" />}
              {capturedSet.has(sq) && code === '.' && (
                <span className="absolute text-lg font-bold text-red-300/60 animate-fade-up">
                  ×
                </span>
              )}
              {code !== '.' && (
                <Stone
                  code={code}
                  className={cn(
                    'h-[76%] w-[76%] transition-transform duration-150',
                    view.lastPath?.[view.lastPath.length - 1] === sq && 'animate-materialize',
                    canMove && 'ring-2 ring-sky-300/70',
                    prefix[0] === sq && '-translate-y-0.5 scale-110',
                  )}
                />
              )}
              {isNext && (
                <span className="absolute h-[30%] w-[30%] rounded-full bg-sky-300/70 ring-2 ring-sky-100/60" />
              )}
              {isEnd && (
                <span className="absolute inset-[18%] rounded-full border-2 border-dashed border-sky-300/70" />
              )}
            </button>
          );
        })}
      </div>
      {playerRow(flipped ? 1 : 0)}
      <p
        className={cn('text-center text-sm', myTurn ? 'font-semibold text-ink' : 'text-ink-muted')}
      >
        {status}
      </p>
      {!view.result && view.quiet >= view.quietLimit - 20 && (
        <p className="text-center text-xs text-ink-muted">
          Noch {movesLeft} {movesLeft === 1 ? 'Zug' : 'Züge'} je Seite ohne Schlag, dann Remis.
        </p>
      )}
    </div>
  );
}
