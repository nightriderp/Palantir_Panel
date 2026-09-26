'use client';

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { seatColor } from '../../seatColors';

/** Spiegel von `VierGewinntView`/`VierGewinntMove` aus `@palantir/arcade`. */
interface VierGewinntView {
  board: string;
  side: 0 | 1;
  playable: number[];
  lastCell: number | null;
  winLine: number[] | null;
  result: { winners: number[]; summary: string } | null;
}

interface VierGewinntMove {
  column: number;
}

const COLS = 7;
const ROWS = 6;

function discStyle(color: string): CSSProperties {
  return {
    background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${color} 45%, white) 0%, ${color} 50%, color-mix(in srgb, ${color} 65%, black) 100%)`,
    boxShadow: `inset 0 -3px 0 color-mix(in srgb, ${color} 60%, black), inset 0 0 0 4px color-mix(in srgb, ${color} 80%, black)`,
  };
}

// Fallen mit kleinem Nachfedern. Die Strecke kommt als Variable, weil sie von der Reihe abhängt.
const FALL_CSS = `@keyframes vgFall{0%{transform:translateY(var(--vg-drop))}62%{transform:translateY(0)}78%{transform:translateY(-14%)}100%{transform:translateY(0)}}
@keyframes vgGlow{0%,100%{box-shadow:0 0 0 3px rgba(255,255,255,.9),0 0 14px 4px rgba(255,255,255,.55)}50%{box-shadow:0 0 0 3px rgba(255,255,255,.6),0 0 22px 8px rgba(255,255,255,.3)}}
@media (prefers-reduced-motion: reduce){.vg-fall{animation:none!important}}`;

/** Fallzeit: je höher der Start über dem Ziel, desto länger. */
const fallMs = (row: number) => 260 + (ROWS - row) * 45;

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<VierGewinntView, VierGewinntMove>) {
  const [hover, setHover] = useState<number | null>(null);
  const touch = useRef(false);
  const myTurn = canAct && !finished && !view.result && mySeat === view.side;
  const color = (seat: number) => seats[seat]?.color ?? seatColor(seat);

  const [seenBoard, setSeenBoard] = useState(view.board);
  if (seenBoard !== view.board) {
    setSeenBoard(view.board);
    setHover(null);
  }

  const prev = useRef<VierGewinntView | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before || before.board === view.board) return;
    if (view.result && !before.result) {
      const won = mySeat !== null && view.result.winners.includes(mySeat);
      const lost = mySeat !== null && view.result.winners.length > 0 && !won;
      sfx(won ? 'win' : lost ? 'lose' : 'score');
    } else sfx('place');
  }, [view, sfx, mySeat]);

  const drop = (col: number) => {
    if (!myTurn || !view.playable.includes(col)) return;
    // Auf dem Handy zeigt der erste Tipp die Vorschau, der zweite wirft.
    if (touch.current && hover !== col) {
      setHover(col);
      sfx('click');
      return;
    }
    setHover(null);
    onMove({ column: col });
  };

  const heights = Array.from({ length: COLS }, (_, c) => {
    let h = 0;
    for (let r = 0; r < ROWS; r += 1) if (view.board[r * COLS + c] !== '.') h = r + 1;
    return h;
  });
  const winSet = new Set(view.winLine ?? []);

  let status: string;
  if (view.result) status = view.result.summary;
  else if (myTurn) status = 'Du bist dran – wähle eine Spalte.';
  else status = `${seats[view.side]?.name ?? 'Gegner'} ist dran.`;

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-2 select-none">
      <style>{FALL_CSS}</style>
      <div className="flex items-center justify-center gap-2 text-sm">
        <span className="h-3 w-3 rounded-full" style={discStyle(color(view.side))} />
        <span className={cn(myTurn ? 'font-semibold text-ink' : 'text-ink-muted')}>{status}</span>
      </div>

      <div
        className="rounded-[18px] p-2 shadow-xl sm:p-3"
        style={{
          background: 'linear-gradient(180deg, #2f6ee6 0%, #1d4fb8 60%, #173f94 100%)',
          boxShadow: '0 10px 30px rgba(29,79,184,0.35), inset 0 2px 0 rgba(255,255,255,0.25)',
        }}
      >
        <div
          className="grid grid-cols-7 gap-1 sm:gap-1.5"
          onPointerLeave={() => !touch.current && setHover(null)}
        >
          {Array.from({ length: COLS }, (_, c) => {
            const open = myTurn && view.playable.includes(c);
            const previewRow = hover === c && open ? heights[c]! : -1;
            return (
              <button
                key={c}
                type="button"
                disabled={!open}
                aria-label={`Spalte ${c + 1}`}
                onPointerDown={(e) => {
                  touch.current = e.pointerType !== 'mouse';
                }}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(c)}
                onClick={() => drop(c)}
                className={cn(
                  'flex flex-col-reverse gap-1 rounded-xl py-0.5 transition-colors sm:gap-1.5',
                  open && 'hover:bg-white/10',
                  hover === c && open && 'bg-white/10',
                )}
              >
                {Array.from({ length: ROWS }, (_, r) => {
                  const cell = r * COLS + c;
                  const v = view.board[cell];
                  const seat = v === '0' ? 0 : v === '1' ? 1 : null;
                  const isLast = cell === view.lastCell;
                  const inWin = winSet.has(cell);
                  return (
                    <span
                      key={r}
                      className="relative aspect-square w-full rounded-full"
                      style={{
                        background:
                          'radial-gradient(circle at 50% 40%, #0b1430 0%, #111c3d 70%, #0a1330 100%)',
                        boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.6)',
                      }}
                    >
                      {seat !== null && (
                        <span
                          className={cn(
                            'absolute inset-[6%] rounded-full transition-opacity duration-300',
                            isLast && 'vg-fall',
                            view.winLine && !inWin && 'opacity-45',
                          )}
                          style={{
                            ...discStyle(color(seat)),
                            ...(isLast
                              ? ({ '--vg-drop': `-${(ROWS - r) * 125}%` } as CSSProperties)
                              : {}),
                            animation:
                              [
                                isLast ? `vgFall ${fallMs(r)}ms cubic-bezier(.4,0,.8,.6)` : '',
                                inWin
                                  ? `vgGlow 1.4s ease-in-out ${isLast ? fallMs(r) : 0}ms infinite`
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(', ') || undefined,
                          }}
                        />
                      )}
                      {previewRow === r && (
                        <span
                          className="absolute inset-[6%] rounded-full opacity-40"
                          style={discStyle(color(view.side))}
                        />
                      )}
                    </span>
                  );
                })}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center gap-4 text-xs text-ink-muted">
        {[0, 1].map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full" style={discStyle(color(s))} />
            {seats[s]?.name ?? `Spieler ${s + 1}`}
          </span>
        ))}
      </div>
    </div>
  );
}
