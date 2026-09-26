'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { CARD_SOLID, CardBack, CardFace, cardAria } from './Card';
import {
  COLOR_NAMES,
  UNO_COLORS,
  type UnoCard,
  type UnoColor,
  type UnoMove,
  type UnoView,
} from './types';

const KEYFRAMES = `
@keyframes uno-drop {
  0% { transform: translateY(-40px) rotate(-18deg) scale(1.15); opacity: 0; }
  60% { transform: translateY(4px) rotate(3deg) scale(0.98); opacity: 1; }
  100% { transform: translateY(0) rotate(var(--uno-tilt, 0deg)) scale(1); }
}
@keyframes uno-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes uno-spin { to { transform: rotate(360deg); } }
@keyframes uno-spin-rev { to { transform: rotate(-360deg); } }
@media (prefers-reduced-motion: reduce) {
  .uno-anim { animation: none !important; }
}
`;

/** Sitze in Spielreihenfolge ab dem eigenen, der eigene zuletzt (unten). */
function ringOrder(players: number, me: number | null): number[] {
  if (me === null) return Array.from({ length: players }, (_, i) => i);
  return Array.from({ length: players - 1 }, (_, k) => (me + 1 + k) % players);
}

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<UnoView, UnoMove>) {
  const [wish, setWish] = useState<UnoCard | null>(null);
  const [unoArmed, setUnoArmed] = useState(false);
  const prev = useRef<UnoView | null>(null);

  const myTurn = canAct && !finished && mySeat === view.am;
  const playable = useMemo(() => new Set(myTurn ? view.spielbar : []), [myTurn, view.spielbar]);

  // Geräusche aus dem Wechsel der Sicht ableiten – so klingen auch Züge der anderen.
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before) return;
    if (view.sieger && !before.sieger) {
      sfx(mySeat !== null && view.sieger.includes(mySeat) ? 'win' : 'lose');
      return;
    }
    if (view.runde !== before.runde) {
      sfx('shuffle');
      return;
    }
    const drawnBefore = before.handCounts.reduce((a, b) => a + b, 0);
    const drawnNow = view.handCounts.reduce((a, b) => a + b, 0);
    if (view.top.id !== before.top.id) sfx(view.top.art === 'zahl' ? 'card' : 'hit');
    else if (drawnNow > drawnBefore)
      sfx(view.unoOffen === null && before.unoOffen !== null ? 'capture' : 'card');
    if (view.am === mySeat && before.am !== mySeat && canAct) sfx('turn');
  }, [view, sfx, mySeat, canAct]);

  // Der UNO-Knopf und die Farbwahl gelten nur für den nächsten Zug.
  const [seenMove, setSeenMove] = useState(view.zuege);
  if (seenMove !== view.zuege) {
    setSeenMove(view.zuege);
    setUnoArmed(false);
    setWish(null);
  }

  const play = (card: UnoCard) => {
    if (!playable.has(card.id)) {
      if (myTurn) sfx('error');
      return;
    }
    if (card.farbe === 'schwarz') {
      setWish(card);
      sfx('click');
      return;
    }
    onMove({ type: 'legen', karte: card.id, farbe: null, uno: unoArmed });
  };

  const chooseColor = (farbe: UnoColor) => {
    if (!wish) return;
    onMove({ type: 'legen', karte: wish.id, farbe, uno: unoArmed });
    setWish(null);
  };

  const seatName = (i: number) => seats[i]?.name ?? `Sitz ${i + 1}`;
  const seatCol = (i: number) => seats[i]?.color ?? '#64748b';
  const ring = ringOrder(view.players, mySeat);
  const handLen = view.hand.length;
  const needUno = myTurn && handLen === 2;

  let status: string;
  if (finished || view.sieger) {
    status = view.sieger?.length
      ? `${view.sieger.map(seatName).join(', ')} gewinnt!`
      : 'Partie beendet.';
  } else if (myTurn) {
    if (view.phase === 'gezogen') status = 'Die gezogene Karte passt – legen oder behalten?';
    else if (view.strafe > 0) status = `+${view.strafe} liegt an: weiterreichen oder ziehen.`;
    else if (playable.size === 0) status = 'Nichts passt – zieh eine Karte.';
    else status = 'Du bist dran.';
  } else {
    status = `${seatName(view.am)} ist dran.`;
  }

  const wishColor = view.top.farbe === 'schwarz' ? view.farbe : null;
  const glow = view.farbe ? CARD_SOLID[view.farbe] : '#a1a1aa';

  // Fächer: je mehr Karten, desto enger und flacher.
  const spread = Math.min(8, 48 / Math.max(handLen, 1));
  const overlap = handLen > 12 ? -44 : handLen > 7 ? -34 : -22;

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-3 select-none">
      <style>{KEYFRAMES}</style>

      {view.options.punktspiel ? (
        <div className="flex flex-wrap items-center gap-2 rounded-tile border border-line bg-surface-deep px-3 py-2 text-sm">
          <span className="font-semibold text-ink">Runde {view.runde}</span>
          <span className="text-ink-faint">Ziel 500</span>
          {view.punkte.map((p, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: seatCol(i) }} />
              <span className="max-w-[6rem] truncate text-ink-muted">{seatName(i)}</span>
              <span className="font-semibold text-ink tabular-nums">{p}</span>
            </span>
          ))}
          {view.letzteRunde ? (
            <span className="w-full text-xs text-ink-faint">
              Letzte Runde: {seatName(view.letzteRunde.sieger)} +{view.letzteRunde.punkte}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Tisch */}
      <div
        className="relative h-[300px] w-full overflow-hidden rounded-tile border border-line sm:h-[340px]"
        style={{
          background: `radial-gradient(ellipse at 50% 60%, ${glow}33 0%, rgba(20,16,32,0.9) 55%, rgba(10,8,18,1) 100%)`,
          transition: 'background 500ms ease',
        }}
      >
        {/* Richtungspfeile */}
        <svg
          viewBox="-100 -100 200 200"
          className="uno-anim pointer-events-none absolute left-1/2 top-[58%] h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 opacity-30"
          aria-label={
            view.richtung === 1 ? 'Richtung: im Uhrzeigersinn' : 'Richtung: gegen den Uhrzeigersinn'
          }
        >
          <g
            className="uno-anim"
            style={{
              transformOrigin: 'center',
              animation: `${view.richtung === 1 ? 'uno-spin' : 'uno-spin-rev'} 14s linear infinite`,
            }}
          >
            {[0, 120, 240].map((a) => (
              <g key={a} transform={`rotate(${a})`}>
                <path
                  d="M 80 -20 A 82 82 0 0 1 20 78"
                  fill="none"
                  stroke={glow}
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <path
                  d={view.richtung === 1 ? 'M 8 70 L 20 78 L 10 90' : 'M 72 -32 L 80 -20 L 92 -30'}
                  fill="none"
                  stroke={glow}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ))}
          </g>
        </svg>

        {/* Gegner im Halbkreis */}
        {ring.map((seat, k) => {
          const n = ring.length;
          const theta =
            mySeat === null
              ? Math.PI - ((k + 0.5) / n) * Math.PI
              : Math.PI - ((k + 1) / (n + 1)) * Math.PI;
          const x = 50 + 42 * Math.cos(theta);
          const y = 44 - 34 * Math.sin(theta);
          const active = view.am === seat && !view.sieger;
          const count = view.handCounts[seat] ?? 0;
          const vulnerable = view.unoOffen === seat;
          return (
            <div
              key={seat}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="relative h-10 w-14">
                {Array.from({ length: Math.min(count, 5) }, (_, i) => (
                  <CardBack
                    key={i}
                    className="absolute top-0 h-10 w-7 drop-shadow"
                    // Kleiner Fächer, damit man die Handgröße grob erkennt.
                    style={{ left: `${6 + i * 5}px`, transform: `rotate(${(i - 2) * 7}deg)` }}
                  />
                ))}
                <span className="absolute -right-1 -top-1 min-w-[1.4rem] rounded-full bg-surface px-1 text-center text-xs font-bold text-ink shadow">
                  {count}
                </span>
                {view.gerufen[seat] ? (
                  <span className="uno-anim absolute -left-3 -top-3 rounded-full bg-danger px-1.5 py-0.5 text-2xs font-black text-white shadow [animation:uno-pulse_1s_ease-in-out_infinite]">
                    UNO!
                  </span>
                ) : null}
              </div>
              <div
                className={cn(
                  'max-w-[5.5rem] truncate rounded-full border px-2 py-0.5 text-xs font-semibold transition-all',
                  active ? 'bg-surface text-ink shadow-lg' : 'bg-surface-deep text-ink-muted',
                )}
                style={{
                  borderColor: seatCol(seat),
                  boxShadow: active ? `0 0 12px ${seatCol(seat)}` : undefined,
                }}
              >
                {seatName(seat)}
              </div>
              {vulnerable ? (
                <span className="text-2xs font-bold text-warning">ohne Ruf!</span>
              ) : null}
            </div>
          );
        })}

        {/* Mitte: Stapel und Ablage */}
        <div className="absolute left-1/2 top-[60%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-5">
          <button
            type="button"
            aria-label={`Nachziehstapel, ${view.stapelAnzahl} Karten`}
            disabled={!myTurn || view.phase !== 'legen'}
            onClick={() => onMove({ type: 'ziehen' })}
            className={cn(
              'relative h-[96px] w-[64px] rounded-[10px] transition-transform sm:h-[114px] sm:w-[76px]',
              myTurn && view.phase === 'legen'
                ? 'cursor-pointer hover:-translate-y-1'
                : 'cursor-default',
              myTurn && view.phase === 'legen' && playable.size === 0 && 'ring-4 ring-brand/70',
            )}
          >
            <CardBack className="absolute left-1 top-1 h-full w-full opacity-60" />
            <CardBack className="absolute h-full w-full drop-shadow-lg" />
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-2xs text-ink-faint">
              {view.stapelAnzahl}
            </span>
          </button>
          <div className="relative h-[110px] w-[74px] sm:h-[132px] sm:w-[88px]">
            <div
              key={view.top.id}
              className="uno-anim absolute inset-0"
              style={{
                animation: 'uno-drop 380ms cubic-bezier(.2,.8,.3,1.2) both',
                ['--uno-tilt' as string]: `${(view.top.id % 7) - 3}deg`,
              }}
            >
              <CardFace
                card={view.top}
                wishColor={wishColor}
                className="h-full w-full drop-shadow-xl"
              />
            </div>
            {view.strafe > 0 ? (
              <span className="absolute -right-3 -top-3 rounded-full bg-danger px-2 py-0.5 text-sm font-black text-white shadow-lg">
                +{view.strafe}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col items-center gap-1">
            <span
              className="h-6 w-6 rounded-full border-2 border-white/80 shadow-lg transition-colors"
              style={{
                background: view.farbe
                  ? CARD_SOLID[view.farbe]
                  : 'conic-gradient(#e11d48, #eab308, #16a34a, #2563eb, #e11d48)',
              }}
            />
            <span className="text-2xs text-ink-muted">
              {view.farbe ? COLOR_NAMES[view.farbe] : 'frei'}
            </span>
          </div>
        </div>
      </div>

      {/* Status und Knöpfe */}
      <div className="flex flex-wrap items-center gap-2">
        <p
          className={cn(
            'mr-auto text-md font-semibold',
            myTurn ? 'text-brand-bright' : 'text-ink-muted',
          )}
        >
          {status}
        </p>
        {view.darfErwischen && !finished ? (
          <Button
            variant="danger"
            size="sm"
            onClick={() => onMove({ type: 'erwischt' })}
            disabled={!canAct}
          >
            Erwischt! ({seatName(view.unoOffen ?? 0)})
          </Button>
        ) : null}
        {myTurn && view.phase === 'gezogen' ? (
          <Button size="sm" onClick={() => onMove({ type: 'behalten' })}>
            Behalten
          </Button>
        ) : null}
        {myTurn && view.phase === 'legen' ? (
          <Button size="sm" onClick={() => onMove({ type: 'ziehen' })}>
            {view.strafe > 0 ? `${view.strafe} ziehen` : 'Ziehen'}
          </Button>
        ) : null}
        {mySeat !== null && !finished ? (
          <button
            type="button"
            disabled={!needUno}
            onClick={() => {
              setUnoArmed((a) => !a);
              sfx('powerup');
            }}
            className={cn(
              'min-h-[40px] rounded-full px-4 text-md font-black tracking-wide transition-all',
              unoArmed
                ? 'bg-danger text-white shadow-[0_0_16px_rgba(225,29,72,0.8)]'
                : needUno
                  ? 'uno-anim bg-danger/80 text-white [animation:uno-pulse_1.1s_ease-in-out_infinite]'
                  : 'bg-fill text-ink-faint',
            )}
            aria-pressed={unoArmed}
            title="Vor dem Legen der vorletzten Karte drücken"
          >
            {unoArmed ? 'UNO gerufen' : 'UNO!'}
          </button>
        ) : null}
      </div>

      {/* Eigene Hand */}
      {mySeat !== null ? (
        <div className="overflow-x-auto pb-2 pt-6">
          <div className="flex min-w-max justify-center px-6">
            {view.hand.map((card, i) => {
              const can = playable.has(card.id);
              const angle = (i - (handLen - 1) / 2) * spread;
              const lift = Math.abs(angle) * 0.9;
              const drawn = view.gezogen === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => play(card)}
                  disabled={!myTurn}
                  aria-label={`${can ? 'Legen: ' : ''}${cardAria(card)}`}
                  className={cn(
                    'group relative h-[96px] w-[64px] shrink-0 transition-all duration-200 sm:h-[114px] sm:w-[76px]',
                    myTurn && !can && 'brightness-[0.55] saturate-50',
                    can && 'hover:z-20 focus-visible:z-20',
                  )}
                  style={{
                    marginLeft: i === 0 ? 0 : overlap,
                    transform: `translateY(${lift - (can ? 14 : 0)}px) rotate(${angle}deg)`,
                    zIndex: i,
                  }}
                >
                  <CardFace
                    card={card}
                    className={cn(
                      'h-full w-full rounded-[10px] transition-transform duration-200',
                      can &&
                        'drop-shadow-[0_0_10px_rgba(255,255,255,0.55)] group-hover:-translate-y-3',
                      drawn && 'ring-4 ring-brand',
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Farbwahl */}
      {wish ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center rounded-tile bg-canvas/70 backdrop-blur-sm"
          role="dialog"
          aria-label="Farbe wählen"
        >
          <div className="flex flex-col items-center gap-3 rounded-tile border border-line-strong bg-surface p-4 shadow-2xl">
            <p className="text-lg font-semibold text-ink">Welche Farbe wünschst du dir?</p>
            <div className="grid grid-cols-2 gap-3">
              {UNO_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => chooseColor(c)}
                  className="h-20 w-24 rounded-tile text-md font-bold text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
                  style={{ background: CARD_SOLID[c] }}
                >
                  {COLOR_NAMES[c]}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setWish(null)}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
