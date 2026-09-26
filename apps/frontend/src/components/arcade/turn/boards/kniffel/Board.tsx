'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { Die } from './Die';
import { FIELDS, type KniffelMove, type KniffelView } from './types';

const NO_HOLD = [false, false, false, false, false];

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<KniffelView, KniffelMove>) {
  const myTurn = canAct && !finished && !view.fertig && mySeat === view.am;
  const [held, setHeld] = useState<boolean[]>(view.gehalten);
  const [spins, setSpins] = useState<number[]>([0, 0, 0, 0, 0]);
  const [seen, setSeen] = useState({ zuege: view.zuege, wuerfe: view.wuerfe });

  // Neuer Stand: Haltemuster übernehmen und rollende Würfel weiterdrehen lassen.
  if (seen.zuege !== view.zuege) {
    const rolled = view.wuerfe > 0 && (view.wuerfe > seen.wuerfe || view.wuerfe === 1);
    setSeen({ zuege: view.zuege, wuerfe: view.wuerfe });
    setHeld(view.wuerfe > 0 ? view.gehalten : NO_HOLD);
    if (rolled)
      setSpins((s) => s.map((n, i) => (view.gehalten[i] && view.wuerfe > 1 ? n : n + 1 + (i % 2))));
  }

  const prev = useRef<KniffelView | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before || before.zuege === view.zuege) return;
    if (view.fertig && !before.fertig) {
      const best = Math.max(...view.summen.map((t) => t.gesamt));
      const mine = mySeat !== null ? view.summen[mySeat]?.gesamt : undefined;
      sfx(view.players === 1 || mine === best ? 'win' : 'lose');
      return;
    }
    if (view.wuerfe > 0 && view.wuerfe !== before.wuerfe) sfx('dice');
    else if (view.letzter && view.letzter !== before.letzter)
      sfx(view.letzter.feld === 11 && view.letzter.punkte === 50 ? 'powerup' : 'score');
    if (view.am === mySeat && before.am !== mySeat && view.players > 1 && canAct) sfx('turn');
  }, [view, sfx, mySeat, canAct]);

  const canHold = myTurn && view.wuerfe > 0 && view.wuerfe < 3;
  const canRoll = myTurn && view.wuerfe < 3 && !(view.wuerfe > 0 && held.every(Boolean));
  const canScore = myTurn && view.wuerfe > 0;
  const openPreview = view.vorschau.filter((v): v is number => v !== null);
  const bestPreview = openPreview.length ? Math.max(...openPreview) : -1;

  const seatName = (i: number) => seats[i]?.name ?? `Sitz ${i + 1}`;
  const seatCol = (i: number) => seats[i]?.color ?? '#64748b';
  const oben = view.summen[view.am]?.oben ?? 0;

  const toggle = (i: number) => {
    if (!canHold) return;
    sfx('click');
    setHeld((h) => h.map((x, j) => (j === i ? !x : x)));
  };

  let status: string;
  if (view.fertig || finished) status = 'Partie beendet.';
  else if (myTurn) {
    status =
      view.wuerfe === 0
        ? 'Du bist dran – würfeln!'
        : view.wuerfe < 3
          ? 'Tipp Würfel zum Halten, dann nochmal würfeln – oder ein Feld wählen.'
          : 'Letzter Wurf – wähle ein Feld.';
  } else status = `${seatName(view.am)} ist dran.`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 select-none">
      <div
        className="flex flex-col items-center gap-3 rounded-tile border border-line px-3 py-4"
        style={{
          background:
            'radial-gradient(ellipse at 50% 30%, rgba(139,92,246,0.35) 0%, rgba(30,20,60,0.85) 55%, rgba(12,8,24,1) 100%)',
        }}
      >
        <div className="flex w-full items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: seatCol(view.am) }} />
            {seatName(view.am)}
          </span>
          <span className="text-ink-muted">
            Runde {Math.min(view.runde, 13)}/13 · Wurf {view.wuerfe}/3
          </span>
        </div>

        <div className="flex items-end justify-center gap-2.5 py-2 sm:gap-4">
          {view.wuerfel.map((value, i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              disabled={!canHold}
              aria-pressed={held[i]}
              aria-label={
                value
                  ? `Würfel ${i + 1}: ${value}${held[i] ? ', gehalten' : ''}`
                  : `Würfel ${i + 1}`
              }
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg p-1 transition-transform duration-200',
                held[i] && view.wuerfe > 0 ? '-translate-y-2' : '',
                canHold && 'cursor-pointer',
                value === 0 && 'opacity-40',
              )}
            >
              <span className="block sm:hidden">
                <Die
                  value={value}
                  spins={spins[i] ?? 0}
                  index={i}
                  held={!!held[i] && view.wuerfe > 0}
                  size={46}
                />
              </span>
              <span className="hidden sm:block">
                <Die
                  value={value}
                  spins={spins[i] ?? 0}
                  index={i}
                  held={!!held[i] && view.wuerfe > 0}
                  size={58}
                />
              </span>
              <span
                className={cn(
                  'h-4 text-2xs font-semibold',
                  held[i] && view.wuerfe > 0 ? 'text-violet-300' : 'text-transparent',
                )}
              >
                gehalten
              </span>
            </button>
          ))}
        </div>

        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          <Button
            variant="primary"
            onClick={() => onMove({ type: 'wuerfeln', halten: view.wuerfe === 0 ? NO_HOLD : held })}
            disabled={!canRoll}
            className="min-w-[10rem]"
          >
            {view.wuerfe === 0 ? 'Würfeln' : `Nochmal würfeln (${3 - view.wuerfe} übrig)`}
          </Button>
        </div>
        <p className={cn('text-center text-sm', myTurn ? 'text-ink' : 'text-ink-muted')}>
          {status}
        </p>
      </div>

      {/* Punktetabelle */}
      <div className="overflow-x-auto rounded-tile border border-line bg-surface-deep">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="sticky left-0 z-10 bg-surface-deep px-2 py-2 text-left font-semibold text-ink-muted">
                Feld
              </th>
              {view.blaetter.map((_, s) => (
                <th
                  key={s}
                  className={cn(
                    'min-w-[3.6rem] px-1.5 py-2 text-center font-semibold',
                    s === view.am && !view.fertig ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  <span className="flex items-center justify-center gap-1">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: seatCol(s) }}
                    />
                    <span className="max-w-[5.5rem] truncate">{seatName(s)}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((field, f) => (
              <FieldRow
                key={f}
                f={f}
                name={field.name}
                hint={field.hint}
                view={view}
                canScore={canScore}
                bestPreview={bestPreview}
                onPick={(feld) => onMove({ type: 'eintragen', feld })}
                divider={f === 6}
                upperNote={f === 5 ? oben : null}
              />
            ))}
            <SumRow label="Oben" values={view.summen.map((t) => t.oben)} top />
            <SumRow label="Bonus (ab 63)" values={view.summen.map((t) => t.bonus)} />
            <SumRow label="Unten" values={view.summen.map((t) => t.unten)} />
            {view.options.extraKniffel ? (
              <SumRow label="Extra-Kniffel" values={view.summen.map((t) => t.extra)} />
            ) : null}
            <SumRow label="Gesamt" values={view.summen.map((t) => t.gesamt)} strong />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldRow({
  f,
  name,
  hint,
  view,
  canScore,
  bestPreview,
  onPick,
  divider,
  upperNote,
}: {
  f: number;
  name: string;
  hint: string;
  view: KniffelView;
  canScore: boolean;
  bestPreview: number;
  onPick(feld: number): void;
  divider: boolean;
  upperNote: number | null;
}) {
  return (
    <tr className={cn('border-b border-line/60', divider && 'border-t-2 border-t-line-strong')}>
      <td className="sticky left-0 z-10 bg-surface-deep px-2 py-1.5">
        <div className="font-medium text-ink">{name}</div>
        <div className="text-2xs text-ink-faint">
          {hint}
          {upperNote !== null && upperNote < 63 ? ` · Bonus: noch ${63 - upperNote}` : ''}
        </div>
      </td>
      {view.blaetter.map((sheet, s) => {
        const value = sheet[f];
        const isLast = view.letzter?.sitz === s && view.letzter.feld === f;
        const preview = s === view.am && !view.fertig ? view.vorschau[f] : null;
        if (value !== null && value !== undefined) {
          return (
            <td
              key={s}
              className={cn(
                'px-1.5 py-1.5 text-center tabular-nums transition-colors duration-500',
                value === 0 ? 'text-ink-faint' : 'text-ink',
                isLast && 'bg-brand-soft font-bold text-brand-bright',
              )}
            >
              {value === 0 ? '–' : value}
            </td>
          );
        }
        if (preview !== null && preview !== undefined) {
          const best = preview === bestPreview && preview > 0;
          return (
            <td key={s} className="p-0.5 text-center">
              <button
                type="button"
                disabled={!canScore}
                onClick={() => onPick(f)}
                className={cn(
                  'min-h-[36px] w-full rounded-md border border-dashed px-1 tabular-nums transition-all',
                  canScore ? 'cursor-pointer hover:bg-brand-soft hover:text-ink' : 'cursor-default',
                  best
                    ? 'border-violet-400 bg-violet-500/15 font-bold text-violet-200'
                    : 'border-line-strong text-ink-muted',
                  preview === 0 && 'text-ink-faint',
                )}
                aria-label={`${name}: ${preview} Punkte eintragen`}
              >
                {preview}
              </button>
            </td>
          );
        }
        return <td key={s} className="px-1.5 py-1.5" />;
      })}
    </tr>
  );
}

function SumRow({
  label,
  values,
  strong,
  top,
}: {
  label: string;
  values: number[];
  strong?: boolean;
  top?: boolean;
}) {
  return (
    <tr className={cn(top && 'border-t-2 border-line-strong', strong && 'bg-fill')}>
      <td
        className={cn(
          'sticky left-0 z-10 px-2 py-1.5',
          strong ? 'bg-surface-deep font-bold text-ink' : 'bg-surface-deep text-ink-muted',
        )}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={cn(
            'px-1.5 py-1.5 text-center tabular-nums',
            strong ? 'text-md font-bold text-ink' : 'text-ink-muted',
          )}
        >
          {v}
        </td>
      ))}
    </tr>
  );
}
