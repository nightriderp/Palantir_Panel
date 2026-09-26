'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { CardFace, CardBack, EmptySlot } from './Card';
import {
  canOnFoundation,
  canOnTableau,
  type Pile,
  type SolitaerMove,
  type SolitaerView,
} from './rules';

/**
 * Brett für Solitär (Klondike).
 *
 * Bedienung auf dem Handy: Karte antippen (wählt sie und alles darüber),
 * dann das Ziel antippen. Eine schon gewählte Karte noch einmal antippen
 * schickt sie auf die Ablage, wenn sie dort passt – das ersetzt den
 * Doppelklick, den es auf Touch nicht zuverlässig gibt. Mögliche Ziele
 * leuchten, damit man nicht raten muss.
 */

interface Selection {
  pile: Pile;
  count: number;
}

const FOUNDATIONS: Pile[] = ['f0', 'f1', 'f2', 'f3'];
const COLUMNS: Pile[] = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];

function topCards(view: SolitaerView, sel: Selection): number[] {
  if (sel.pile === 'w') return view.wasteTop.slice(-1);
  if (sel.pile.startsWith('f'))
    return (view.foundations[Number(sel.pile.slice(1))] ?? []).slice(-1);
  const col = view.tableau[Number(sel.pile.slice(1))];
  return col ? col.up.slice(col.up.length - sel.count) : [];
}

function legalTargets(view: SolitaerView, sel: Selection): Pile[] {
  const cards = topCards(view, sel);
  const lead = cards[0];
  if (lead === undefined) return [];
  const result: Pile[] = [];
  if (cards.length === 1 && !sel.pile.startsWith('f')) {
    for (const f of FOUNDATIONS) {
      if (canOnFoundation(lead, view.foundations[Number(f.slice(1))] ?? [])) result.push(f);
    }
  }
  for (const t of COLUMNS) {
    if (t === sel.pile) continue;
    const col = view.tableau[Number(t.slice(1))];
    if (col && canOnTableau(lead, col.up, col.down)) result.push(t);
  }
  return result;
}

export function Board({
  view,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<SolitaerView, SolitaerMove>) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const active = canAct && !finished;
  const prevMoves = useRef(view.moves);
  const prevWon = useRef(view.won);

  // Nach jedem angewandten Zug die Auswahl lösen und den passenden Klang spielen.
  useEffect(() => {
    if (view.moves !== prevMoves.current) {
      prevMoves.current = view.moves;
      setSelection(null);
      if (view.last?.to === 'stock') sfx('shuffle');
      else if (view.last?.to.startsWith('f')) sfx('place');
      else sfx('card');
    }
    if (view.won && !prevWon.current) sfx('win');
    prevWon.current = view.won;
  }, [view.moves, view.won, view.last, sfx]);

  const targets = selection ? legalTargets(view, selection) : [];

  function send(move: SolitaerMove) {
    if (!active) return;
    onMove(move);
  }

  function tryTo(target: Pile) {
    if (!selection) return false;
    if (!targets.includes(target)) return false;
    send({ type: 'verschieben', from: selection.pile, to: target, count: selection.count });
    setSelection(null);
    return true;
  }

  /** Schickt die gewählte Karte auf die erste passende Ablage. */
  function toFoundation(sel: Selection): boolean {
    if (sel.count !== 1) return false;
    const found = legalTargets(view, sel).find((p) => p.startsWith('f'));
    if (!found) return false;
    send({ type: 'verschieben', from: sel.pile, to: found, count: 1 });
    setSelection(null);
    return true;
  }

  function pick(pile: Pile, count: number) {
    if (!active) return;
    if (selection && selection.pile === pile && selection.count === count) {
      if (!toFoundation(selection)) setSelection(null);
      return;
    }
    if (selection && tryTo(pile)) return;
    sfx('click');
    setSelection({ pile, count });
  }

  function tapPile(pile: Pile) {
    if (!active) return;
    if (selection && tryTo(pile)) return;
    if (selection) {
      sfx('error');
      setSelection(null);
    }
  }

  const lastTo = view.last?.to;
  const ringFor = (pile: Pile) =>
    cn(
      targets.includes(pile) && 'ring-2 ring-emerald-300 ring-offset-2 ring-offset-transparent',
      !selection && lastTo === pile && 'ring-1 ring-amber-300/60',
    );

  return (
    <div className="mx-auto w-full max-w-[560px] select-none px-1 pb-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <div className="flex gap-3 text-ink-muted">
          <span>
            Punkte <b className="text-ink">{view.score}</b>
          </span>
          <span>
            Züge <b className="text-ink">{view.moves}</b>
          </span>
          <span className="hidden sm:inline">
            {view.draw === 3 ? 'Drei ziehen' : 'Eine ziehen'}
          </span>
        </div>
        <div className="flex gap-2">
          {view.canAutoComplete && active && (
            <Button size="sm" variant="success" onClick={() => send({ type: 'vervollstaendigen' })}>
              Fertig spielen
            </Button>
          )}
          {active && (
            <Button
              size="sm"
              variant={confirmGiveUp ? 'danger' : 'ghost'}
              onClick={() => {
                if (confirmGiveUp) send({ type: 'aufgeben' });
                setConfirmGiveUp(!confirmGiveUp);
              }}
              onBlur={() => setConfirmGiveUp(false)}
            >
              {confirmGiveUp ? 'Wirklich aufgeben?' : 'Aufgeben'}
            </Button>
          )}
        </div>
      </div>

      <div
        className="rounded-tile p-2 sm:p-3"
        style={{
          background:
            'radial-gradient(ellipse at 50% 20%, rgba(34,197,94,0.28), rgba(6,40,24,0.95) 70%), #052e16',
        }}
      >
        {/* Obere Reihe: Stapel, Talon, Lücke, vier Ablagen */}
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          <button
            type="button"
            aria-label={
              view.stockCount > 0 ? `Stapel, ${view.stockCount} Karten – ziehen` : 'Talon umdrehen'
            }
            className="relative"
            disabled={!active || (view.stockCount === 0 && view.wasteCount === 0)}
            onClick={() => {
              setSelection(null);
              send({ type: 'ziehen' });
            }}
          >
            {view.stockCount > 0 ? (
              <CardBack />
            ) : (
              <EmptySlot label={view.wasteCount > 0 ? '↻' : ''} />
            )}
            {view.stockCount > 0 && (
              <span className="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 text-3xs text-white">
                {view.stockCount}
              </span>
            )}
          </button>

          <div className="relative col-span-2">
            {view.wasteTop.length === 0 ? (
              <div className="w-1/2">
                <EmptySlot label="" />
              </div>
            ) : (
              <div className="relative w-1/2">
                {view.wasteTop.map((card, i) => {
                  const isTop = i === view.wasteTop.length - 1;
                  // Beim Drei-Ziehen fächern wir die letzten Karten auf, sonst liegt nur eine sichtbar.
                  const offset = view.draw === 3 ? i * 34 : 0;
                  return (
                    <button
                      key={card}
                      type="button"
                      disabled={!isTop || !active}
                      onClick={() => pick('w', 1)}
                      onDoubleClick={() => isTop && toFoundation({ pile: 'w', count: 1 })}
                      className={cn(
                        'block w-full transition-transform duration-150',
                        i > 0 && 'absolute left-0 top-0',
                      )}
                      style={{
                        transform: `translate(${offset}%, ${isTop && selection?.pile === 'w' ? -4 : 0}px)`,
                      }}
                    >
                      <CardFace card={card} selected={isTop && selection?.pile === 'w'} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {FOUNDATIONS.map((f) => {
            const pile = view.foundations[Number(f.slice(1))] ?? [];
            const top = pile[pile.length - 1];
            return (
              <button
                key={f}
                type="button"
                className={cn('rounded-[6px] transition-shadow', ringFor(f))}
                onClick={() => {
                  if (selection) tapPile(f);
                  else if (top !== undefined) pick(f, 1);
                }}
                aria-label={`Ablage ${Number(f.slice(1)) + 1}`}
              >
                {top === undefined ? (
                  <EmptySlot label="A" />
                ) : (
                  <CardFace card={top} selected={selection?.pile === f} />
                )}
              </button>
            );
          })}
        </div>

        {/* Tableau */}
        <div className="mt-3 grid grid-cols-7 gap-1 sm:gap-2">
          {COLUMNS.map((t) => {
            const col = view.tableau[Number(t.slice(1))] ?? { down: 0, up: [] };
            const empty = col.down === 0 && col.up.length === 0;
            return (
              <div
                key={t}
                className={cn('min-h-[180px] rounded-[6px] pb-2 transition-shadow', ringFor(t))}
                onClick={() => tapPile(t)}
              >
                {empty && <EmptySlot label="K" />}
                {Array.from({ length: col.down }, (_, i) => (
                  <div key={`d${i}`} className={cn(i > 0 && 'mt-[-122%]')}>
                    <CardBack />
                  </div>
                ))}
                {col.up.map((card, i) => {
                  const count = col.up.length - i;
                  const selected = selection?.pile === t && count <= selection.count;
                  const first = col.down === 0 && i === 0;
                  return (
                    <button
                      key={card}
                      type="button"
                      className={cn(
                        'relative block w-full transition-transform duration-150',
                        !first && (i === 0 ? 'mt-[-122%]' : 'mt-[-100%]'),
                        selected && '-translate-y-1',
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        pick(t, count);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (count === 1) toFoundation({ pile: t, count: 1 });
                      }}
                    >
                      <CardFace card={card} selected={selected} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {view.over && (
        <p className="mt-2 text-center text-md text-ink">
          {view.won
            ? `Gelöst! ${view.score} Punkte (davon ${view.bonus} Bonus für wenige Züge).`
            : `Partie beendet – ${view.score} Punkte.`}
        </p>
      )}
    </div>
  );
}
