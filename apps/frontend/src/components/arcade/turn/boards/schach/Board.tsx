'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { Piece } from './pieces';
import { type SchachMove, type SchachPromotion, type SchachView } from './types';

const FILES = 'abcdefgh';
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PROMOTIONS: SchachPromotion[] = ['q', 'r', 'b', 'n'];
const PROMO_LABEL: Record<SchachPromotion, string> = {
  q: 'Dame',
  r: 'Turm',
  b: 'Läufer',
  n: 'Springer',
};
const COLOR_NAME = ['Weiß', 'Schwarz'];

const LIGHT = '#c9d2de';
const DARK = '#5d6d85';

function isWhite(code: string): boolean {
  return code !== '.' && code === code.toUpperCase();
}

function material(pieces: string): number {
  let sum = 0;
  for (const p of pieces) sum += VALUE[p.toLowerCase()] ?? 0;
  return sum;
}

function sortCaptured(pieces: string): string[] {
  return [...pieces].sort((a, b) => (VALUE[b.toLowerCase()] ?? 0) - (VALUE[a.toLowerCase()] ?? 0));
}

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<SchachView, SchachMove>) {
  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);

  // Schwarz sieht das Brett von seiner Seite.
  const flipped = mySeat === 1;
  const myColor = mySeat === 0 || mySeat === 1 ? mySeat : null;
  const myTurn = canAct && !finished && !view.result && myColor === view.side;

  // Auswahl verwerfen, sobald sich die Stellung ändert (Zug des Gegners, Sitzwechsel).
  const [seenBoard, setSeenBoard] = useState(view.board);
  if (seenBoard !== view.board) {
    setSeenBoard(view.board);
    setSelected(null);
    setPromo(null);
    setConfirmResign(false);
  }

  const targets = useMemo(() => {
    const t = new Set<number>();
    if (selected === null) return t;
    for (const [from, to] of view.legal) if (from === selected) t.add(to);
    return t;
  }, [selected, view.legal]);

  const movable = useMemo(() => new Set(view.legal.map(([from]) => from)), [view.legal]);

  // Geräusche aus dem Unterschied zur vorigen Sicht.
  const prev = useRef<SchachView | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before) return;
    if (view.result && !before.result) {
      const won = mySeat !== null && view.result.winners.includes(mySeat);
      const lost = mySeat !== null && view.result.winners.length > 0 && !won;
      sfx(won ? 'win' : lost ? 'lose' : 'score');
      return;
    }
    if (view.san.length !== before.san.length) {
      const capture =
        view.captured[0].length + view.captured[1].length >
        before.captured[0].length + before.captured[1].length;
      sfx(capture ? 'capture' : 'move');
      if (view.checkSquare >= 0) sfx('tick');
    }
  }, [view, sfx, mySeat]);

  const submit = (from: number, to: number, promotion?: SchachPromotion) => {
    setSelected(null);
    setPromo(null);
    onMove(promotion ? { type: 'zug', from, to, promotion } : { type: 'zug', from, to });
  };

  const tap = (sq: number) => {
    if (!myTurn) return;
    const code = view.board[sq] ?? '.';
    if (selected !== null && targets.has(sq)) {
      const piece = view.board[selected] ?? '.';
      const lastRank = view.side === 0 ? 7 : 0;
      if (piece.toLowerCase() === 'p' && sq >> 3 === lastRank) {
        setPromo({ from: selected, to: sq });
        sfx('click');
        return;
      }
      submit(selected, sq);
      return;
    }
    const own = code !== '.' && isWhite(code) === (view.side === 0);
    if (own && movable.has(sq)) {
      setSelected(sq === selected ? null : sq);
      sfx('click');
    } else if (own) {
      setSelected(null);
      sfx('error');
    } else setSelected(null);
  };

  const squares: number[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const rank = flipped ? row : 7 - row;
      const file = flipped ? 7 - col : col;
      squares.push(rank * 8 + file);
    }
  }

  // Oben der Gegner, unten die eigene Seite (Zuschauer: Weiß unten).
  const bottomColor = flipped ? 1 : 0;
  const topColor = 1 - bottomColor;
  const diff = material(view.captured[0]) - material(view.captured[1]);
  const seatName = (i: number) => seats[i]?.name ?? COLOR_NAME[i] ?? '';

  const capturedRow = (color: number) => {
    const lead = color === 0 ? diff : -diff;
    return (
      <div className="flex min-h-7 items-center gap-2 text-sm">
        <span
          className={cn(
            'h-3 w-3 shrink-0 rounded-full border',
            color === 0 ? 'border-slate-500 bg-[#f8f5ee]' : 'border-slate-400 bg-[#1f2937]',
          )}
        />
        <span
          className={cn(
            'truncate font-semibold',
            view.side === color && !view.result ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {seatName(color)}
        </span>
        <span className="flex min-w-0 flex-wrap items-center">
          {sortCaptured(view.captured[color] ?? '').map((p, i) => (
            <Piece key={`${p}${i}`} code={p} className="-mr-1.5 h-5 w-5" />
          ))}
        </span>
        {lead > 0 && <span className="text-xs font-semibold text-ink-muted">+{lead}</span>}
      </div>
    );
  };

  const offerFromOpponent =
    view.drawOffer !== null && myColor !== null && view.drawOffer !== myColor && !view.result;
  const myOfferOpen = view.drawOffer !== null && view.drawOffer === myColor;

  let status: string;
  if (view.result) status = view.result.summary;
  else if (myTurn) status = view.checkSquare >= 0 ? 'Schach! Du bist am Zug.' : 'Du bist am Zug.';
  else status = `${COLOR_NAME[view.side]} ist am Zug${view.checkSquare >= 0 ? ' – Schach!' : '.'}`;

  // Zugliste als Paare, die letzten Züge zuerst sichtbar.
  const pairs: string[] = [];
  for (let i = 0; i < view.san.length; i += 2) {
    pairs.push(`${i / 2 + 1}. ${view.san[i] ?? ''} ${view.san[i + 1] ?? ''}`.trim());
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2 select-none">
      {capturedRow(topColor)}

      <div
        className="relative aspect-square w-full overflow-hidden rounded-tile shadow-lg ring-1 ring-black/40"
        role="grid"
        aria-label="Schachbrett"
      >
        <div className="grid h-full w-full grid-cols-8 grid-rows-8">
          {squares.map((sq, i) => {
            const file = sq & 7;
            const rank = sq >> 3;
            const dark = (file + rank) % 2 === 0;
            const code = view.board[sq] ?? '.';
            const isLast =
              view.lastMove !== null && (view.lastMove[0] === sq || view.lastMove[1] === sq);
            const isTarget = targets.has(sq);
            const showFile = i >= 56;
            const showRank = i % 8 === 0;
            return (
              <button
                key={sq}
                type="button"
                onClick={() => tap(sq)}
                disabled={!myTurn}
                aria-label={`${FILES[file]}${rank + 1}${code !== '.' ? '' : ' leer'}`}
                className="relative flex items-center justify-center disabled:cursor-default"
                style={{ background: dark ? DARK : LIGHT }}
              >
                {isLast && <span className="absolute inset-0 bg-amber-300/35" />}
                {selected === sq && <span className="absolute inset-0 bg-sky-400/45" />}
                {view.checkSquare === sq && (
                  <span
                    className="absolute inset-0"
                    style={{
                      background:
                        'radial-gradient(circle, rgba(239,68,68,0.95) 0%, rgba(239,68,68,0.5) 45%, transparent 75%)',
                    }}
                  />
                )}
                {showRank && (
                  <span
                    className="absolute left-0.5 top-0 text-[9px] font-semibold leading-none sm:text-[11px]"
                    style={{ color: dark ? LIGHT : DARK }}
                  >
                    {rank + 1}
                  </span>
                )}
                {showFile && (
                  <span
                    className="absolute bottom-0 right-0.5 text-[9px] font-semibold leading-none sm:text-[11px]"
                    style={{ color: dark ? LIGHT : DARK }}
                  >
                    {FILES[file]}
                  </span>
                )}
                {code !== '.' && (
                  <Piece
                    code={code}
                    className={cn(
                      'relative h-[88%] w-[88%] transition-transform duration-150',
                      selected === sq && 'scale-110',
                    )}
                  />
                )}
                {isTarget &&
                  (code === '.' ? (
                    <span className="absolute h-[28%] w-[28%] rounded-full bg-slate-900/40" />
                  ) : (
                    <span className="absolute inset-[4%] rounded-full border-[5px] border-slate-900/45" />
                  ))}
              </button>
            );
          })}
        </div>

        {promo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2 rounded-tile border border-line-strong bg-surface-deep p-3 shadow-xl">
              <p className="text-sm font-semibold text-ink">Umwandeln in …</p>
              <div className="flex gap-2">
                {PROMOTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => submit(promo.from, promo.to, p)}
                    className="flex h-16 w-16 flex-col items-center justify-center rounded-tile bg-fill transition hover:bg-brand-soft"
                    aria-label={PROMO_LABEL[p]}
                  >
                    <Piece code={view.side === 0 ? p.toUpperCase() : p} className="h-11 w-11" />
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="text-xs text-ink-muted underline"
                onClick={() => setPromo(null)}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>

      {capturedRow(bottomColor)}

      <p
        className={cn('text-center text-sm', myTurn ? 'font-semibold text-ink' : 'text-ink-muted')}
      >
        {status}
      </p>

      {offerFromOpponent && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-tile border border-line bg-fill px-3 py-2 text-sm text-ink">
          <span>{COLOR_NAME[view.drawOffer ?? 0]} bietet Remis an.</span>
          {myTurn && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onMove({ type: 'remis-annehmen' })}
            >
              Annehmen
            </Button>
          )}
          {myTurn && <span className="text-xs text-ink-muted">Ein Zug lehnt ab.</span>}
        </div>
      )}

      {myColor !== null && !view.result && !finished && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!myTurn || view.drawOffer !== null}
            onClick={() => onMove({ type: 'remis-anbieten' })}
          >
            {myOfferOpen ? 'Remis angeboten' : 'Remis anbieten'}
          </Button>
          {confirmResign ? (
            <>
              <Button
                size="sm"
                variant="danger"
                disabled={!myTurn}
                onClick={() => onMove({ type: 'aufgeben' })}
              >
                Wirklich aufgeben
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmResign(false)}>
                Doch nicht
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={!myTurn}
              onClick={() => setConfirmResign(true)}
            >
              Aufgeben
            </Button>
          )}
        </div>
      )}

      {pairs.length > 0 && (
        <ol className="flex max-h-20 flex-wrap gap-x-3 gap-y-0.5 overflow-y-auto rounded-tile bg-surface-deep px-3 py-2 font-mono text-xs text-ink-muted">
          {pairs.map((p, i) => (
            <li key={i} className={cn(i === pairs.length - 1 && 'text-ink')}>
              {p}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
