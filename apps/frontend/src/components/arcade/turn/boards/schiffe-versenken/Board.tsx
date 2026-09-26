'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';

/** Spiegel von `SchiffeView`/`SchiffeMove` aus `@palantir/arcade` (Typen einzelner Spiele sind nicht exportiert). */
interface Ship {
  x: number;
  y: number;
  len: number;
  horizontal: boolean;
}

type ShotMark = 0 | 1 | 2 | 3;

type SchiffeMove =
  { type: 'flotte'; ships: Ship[] } | { type: 'zufall' } | { type: 'schuss'; x: number; y: number };

interface SchiffeView {
  phase: 'aufbau' | 'schiessen' | 'ende';
  fleetKind: 'standard' | 'klassisch';
  fleetLengths: number[];
  nochmal: boolean;
  myFleet: Ship[] | null;
  myGrid: ShotMark[];
  enemyGrid: ShotMark[];
  enemySunk: Ship[];
  mySunk: Ship[];
  ready: boolean[];
  turn: number;
  lastShot: { seat: number; x: number; y: number; mark: ShotMark } | null;
  revealed: (Ship[] | null)[] | null;
  perspective: number;
}

const SIZE = 10;
const COLS = 'ABCDEFGHIJ';
const M = 8; // Rand für die Beschriftung
const C = 10;

function cells(ship: Ship): number[] {
  return Array.from({ length: ship.len }, (_, i) =>
    ship.horizontal ? ship.y * SIZE + ship.x + i : (ship.y + i) * SIZE + ship.x,
  );
}

function fits(ship: Ship): boolean {
  return ship.horizontal ? ship.x + ship.len <= SIZE : ship.y + ship.len <= SIZE;
}

/** Passt `ship` neben die anderen? Klassische Flotte: auch nicht über Eck berühren. */
function placeable(ship: Ship, others: readonly Ship[], noTouch: boolean): boolean {
  if (!fits(ship)) return false;
  const taken = new Set<number>();
  for (const o of others) {
    for (const c of cells(o)) {
      if (!noTouch) {
        taken.add(c);
        continue;
      }
      const cx = c % SIZE;
      const cy = Math.floor(c / SIZE);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE) taken.add(ny * SIZE + nx);
        }
      }
    }
  }
  return cells(ship).every((c) => !taken.has(c));
}

/** Zufällige Vorschau-Flotte. Nur Oberfläche – die Regeln prüfen die Flotte beim Abschicken erneut. */
function randomLayout(lengths: readonly number[], noTouch: boolean): (Ship | null)[] {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const placed: Ship[] = [];
    let ok = true;
    for (const len of lengths) {
      let done = false;
      for (let t = 0; t < 400 && !done; t += 1) {
        const horizontal = Math.random() < 0.5;
        const ship = {
          x: Math.floor(Math.random() * (horizontal ? SIZE - len + 1 : SIZE)),
          y: Math.floor(Math.random() * (horizontal ? SIZE : SIZE - len + 1)),
          len,
          horizontal,
        };
        if (placeable(ship, placed, noTouch)) {
          placed.push(ship);
          done = true;
        }
      }
      if (!done) {
        ok = false;
        break;
      }
    }
    if (ok) return placed;
  }
  return lengths.map(() => null);
}

// ---------------------------------------------------------------------------
// Zeichnen
// ---------------------------------------------------------------------------

function ShipShape({
  ship,
  fill,
  stroke,
  opacity = 1,
  dashed,
}: {
  ship: Ship;
  fill: string;
  stroke: string;
  opacity?: number;
  dashed?: boolean;
}) {
  const w = ship.horizontal ? ship.len * C : C;
  const h = ship.horizontal ? C : ship.len * C;
  return (
    <g opacity={opacity} pointerEvents="none">
      <rect
        x={M + ship.x * C + 1.2}
        y={M + ship.y * C + 1.2}
        width={w - 2.4}
        height={h - 2.4}
        rx="4"
        fill={fill}
        stroke={stroke}
        strokeWidth="0.7"
        strokeDasharray={dashed ? '1.5 1' : undefined}
      />
      {Array.from({ length: ship.len }, (_, i) => (
        <circle
          key={i}
          cx={M + (ship.horizontal ? ship.x + i : ship.x) * C + C / 2}
          cy={M + (ship.horizontal ? ship.y : ship.y + i) * C + C / 2}
          r="1.3"
          fill="rgba(255,255,255,0.35)"
        />
      ))}
    </g>
  );
}

function Grid({
  label,
  marks,
  ships,
  lastShot,
  onCell,
  interactive,
  accent,
  children,
}: {
  label: string;
  marks: readonly ShotMark[];
  ships: ReactNode;
  lastShot: { x: number; y: number; mark: ShotMark; key: string } | null;
  onCell?: (x: number, y: number) => void;
  interactive: boolean;
  accent: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <svg
        viewBox={`0 0 ${M + SIZE * C + 1} ${M + SIZE * C + 1}`}
        className={cn(
          'w-full touch-manipulation select-none rounded-tile',
          interactive && 'ring-2 ring-offset-0',
        )}
        style={interactive ? ({ '--tw-ring-color': accent } as CSSProperties) : undefined}
      >
        <defs>
          <linearGradient id={`sea-${label}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0c4a6e" />
            <stop offset="100%" stopColor="#082f49" />
          </linearGradient>
        </defs>
        <rect x={M} y={M} width={SIZE * C} height={SIZE * C} fill={`url(#sea-${label})`} />
        {Array.from({ length: SIZE }, (_, i) => (
          <g key={i}>
            <text x={M + i * C + C / 2} y={M - 2} textAnchor="middle" fontSize="4.2" fill="#94a3b8">
              {COLS[i]}
            </text>
            <text
              x={M - 1.8}
              y={M + i * C + C / 2 + 1.5}
              textAnchor="end"
              fontSize="4.2"
              fill="#94a3b8"
            >
              {i + 1}
            </text>
          </g>
        ))}
        {Array.from({ length: SIZE + 1 }, (_, i) => (
          <g key={`l${i}`} stroke="#38bdf8" strokeOpacity="0.18" strokeWidth="0.3">
            <line x1={M + i * C} y1={M} x2={M + i * C} y2={M + SIZE * C} />
            <line x1={M} y1={M + i * C} x2={M + SIZE * C} y2={M + i * C} />
          </g>
        ))}
        {ships}
        {marks.map((m, c) => {
          if (m === 0) return null;
          const cx = M + (c % SIZE) * C + C / 2;
          const cy = M + Math.floor(c / SIZE) * C + C / 2;
          if (m === 1)
            return <circle key={c} cx={cx} cy={cy} r="1.4" fill="#bae6fd" opacity="0.8" />;
          return (
            <g key={c}>
              <rect
                x={cx - C / 2 + 0.6}
                y={cy - C / 2 + 0.6}
                width={C - 1.2}
                height={C - 1.2}
                rx="2"
                fill={m === 3 ? '#7f1d1d' : '#b91c1c'}
                opacity="0.75"
              />
              <path
                d={`M${cx - 2.6} ${cy - 2.6} L${cx + 2.6} ${cy + 2.6} M${cx + 2.6} ${cy - 2.6} L${cx - 2.6} ${cy + 2.6}`}
                stroke="#fde68a"
                strokeWidth="1.1"
                strokeLinecap="round"
              />
            </g>
          );
        })}
        {lastShot && (
          <g
            key={lastShot.key}
            transform={`translate(${M + lastShot.x * C + C / 2} ${M + lastShot.y * C + C / 2})`}
            pointerEvents="none"
          >
            {lastShot.mark === 1 ? (
              <>
                <circle
                  className="sv-splash"
                  r="3"
                  fill="none"
                  stroke="#e0f2fe"
                  strokeWidth="0.8"
                />
                <circle
                  className="sv-splash sv-late"
                  r="3"
                  fill="none"
                  stroke="#e0f2fe"
                  strokeWidth="0.6"
                />
              </>
            ) : (
              <>
                <circle className="sv-boom" r="4" fill="#fb923c" />
                <circle className="sv-boom sv-late" r="3" fill="#fde047" />
              </>
            )}
            <rect
              x={-C / 2}
              y={-C / 2}
              width={C}
              height={C}
              fill="none"
              stroke="#fde68a"
              strokeWidth="0.6"
              rx="1.5"
            />
          </g>
        )}
        {children}
        {onCell &&
          Array.from({ length: SIZE * SIZE }, (_, c) => (
            <rect
              key={`h${c}`}
              x={M + (c % SIZE) * C}
              y={M + Math.floor(c / SIZE) * C}
              width={C}
              height={C}
              fill="transparent"
              className={cn(interactive && 'cursor-pointer')}
              onClick={() => onCell(c % SIZE, Math.floor(c / SIZE))}
            />
          ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<SchiffeView, SchiffeMove>) {
  const noTouch = view.fleetKind === 'klassisch';
  const lengths = [...view.fleetLengths].sort((a, b) => b - a);
  const me = view.perspective;
  const enemy = 1 - me;
  const myColor = seats[me]?.color ?? '#ef4444';
  const enemyColor = seats[enemy]?.color ?? '#3b82f6';

  // --- Aufbau ---------------------------------------------------------------
  const [layout, setLayout] = useState<(Ship | null)[]>(() => lengths.map(() => null));
  const [active, setActive] = useState(0);
  const [horizontal, setHorizontal] = useState(true);
  const setupMode = view.phase === 'aufbau' && view.myFleet === null && mySeat !== null;

  // Am selben Gerät wechselt der Sitz unter demselben Brett: Die halb gesetzte
  // Flotte des einen darf der andere nicht zu sehen bekommen.
  const [seenSeat, setSeenSeat] = useState(mySeat);
  if (seenSeat !== mySeat) {
    setSeenSeat(mySeat);
    setLayout(lengths.map(() => null));
    setActive(0);
  }
  const canSetup = setupMode && canAct && !finished;

  function placeAt(x: number, y: number) {
    if (!canSetup) return;
    // Tippen auf ein gesetztes Schiff hebt es wieder auf.
    const cell = y * SIZE + x;
    const hitIndex = layout.findIndex((s) => s !== null && cells(s).includes(cell));
    if (hitIndex >= 0 && hitIndex !== active) {
      sfx('click');
      setActive(hitIndex);
      setHorizontal(layout[hitIndex]!.horizontal);
      return;
    }
    const len = lengths[active];
    if (len === undefined) return;
    const ship: Ship = { x, y, len, horizontal };
    const others = layout.filter((s, i): s is Ship => s !== null && i !== active);
    if (!placeable(ship, others, noTouch)) {
      sfx('error');
      return;
    }
    sfx('place');
    const next = layout.map((s, i) => (i === active ? ship : s));
    setLayout(next);
    const free = next.findIndex((s) => s === null);
    if (free >= 0) setActive(free);
  }

  function rotate() {
    const nextH = !horizontal;
    setHorizontal(nextH);
    const current = layout[active];
    if (current) {
      const turned = { ...current, horizontal: nextH };
      const others = layout.filter((s, i): s is Ship => s !== null && i !== active);
      if (placeable(turned, others, noTouch))
        setLayout(layout.map((s, i) => (i === active ? turned : s)));
    }
    sfx('click');
  }

  const allPlaced = layout.every((s) => s !== null);

  // --- Schießen -------------------------------------------------------------
  const shooting = view.phase === 'schiessen';
  const myTurn = shooting && canAct && !finished && mySeat === view.turn;

  const shotRef = useRef(view.lastShot);
  useEffect(() => {
    if (shotRef.current === view.lastShot || !view.lastShot) return;
    shotRef.current = view.lastShot;
    if (view.phase === 'ende') {
      sfx(view.lastShot.seat === mySeat ? 'win' : 'lose');
      return;
    }
    sfx(view.lastShot.mark === 1 ? 'bounce' : view.lastShot.mark === 3 ? 'explode' : 'hit');
  }, [view.lastShot, view.phase, mySeat, sfx]);

  function shoot(x: number, y: number) {
    if (!myTurn) return;
    if (view.enemyGrid[y * SIZE + x] !== 0) return;
    sfx('shoot');
    onMove({ type: 'schuss', x, y });
  }

  const shotKey = view.lastShot
    ? `${view.lastShot.seat}-${view.lastShot.x}-${view.lastShot.y}`
    : '';
  const enemyLast =
    view.lastShot && view.lastShot.seat === me ? { ...view.lastShot, key: shotKey } : null;
  const myLast =
    view.lastShot && view.lastShot.seat !== me ? { ...view.lastShot, key: shotKey } : null;

  const remaining = [...lengths];
  for (const s of view.enemySunk) {
    const i = remaining.indexOf(s.len);
    if (i >= 0) remaining.splice(i, 1);
  }

  const styles = (
    <style>{`
      @keyframes sv-splash { from { transform: scale(.2); opacity: 1 } to { transform: scale(1.8); opacity: 0 } }
      @keyframes sv-boom { 0% { transform: scale(.2); opacity: 1 } 60% { transform: scale(1.5); opacity: .9 } 100% { transform: scale(2); opacity: 0 } }
      .sv-splash { animation: sv-splash .8s ease-out forwards; transform-box: fill-box; transform-origin: center; }
      .sv-boom { animation: sv-boom .7s ease-out forwards; transform-box: fill-box; transform-origin: center; }
      .sv-late { animation-delay: .18s; }
    `}</style>
  );

  if (setupMode) {
    return (
      <div className="mx-auto flex w-full max-w-[460px] flex-col gap-3">
        {styles}
        <p className="text-center text-sm text-ink-muted">
          {canSetup
            ? 'Wähle ein Schiff, tippe das Startfeld an und drehe es bei Bedarf.'
            : 'Warte, bis du deine Flotte setzen darfst …'}
          {noTouch && ' Schiffe dürfen sich nicht berühren.'}
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {lengths.map((len, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setActive(i);
                if (layout[i]) setHorizontal(layout[i]!.horizontal);
              }}
              className={cn(
                'flex min-h-[36px] items-center gap-0.5 rounded-lg border px-2 transition',
                i === active ? 'border-brand bg-brand-soft' : 'border-line bg-fill',
                layout[i] && i !== active && 'opacity-60',
              )}
              aria-label={`Schiff mit ${len} Feldern`}
            >
              {Array.from({ length: len }, (_, k) => (
                <span
                  key={k}
                  className="h-3 w-3 rounded-sm"
                  style={{ background: layout[i] ? myColor : '#64748b' }}
                />
              ))}
            </button>
          ))}
        </div>
        <div>
          <Grid
            label="Deine Flotte"
            marks={view.myGrid}
            lastShot={null}
            interactive={canSetup}
            accent={myColor}
            onCell={placeAt}
            ships={layout.map((s, i) =>
              s ? (
                <ShipShape
                  key={i}
                  ship={s}
                  fill={myColor}
                  stroke={i === active ? '#fff' : 'rgba(0,0,0,0.5)'}
                  opacity={i === active ? 1 : 0.85}
                />
              ) : null,
            )}
          />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={!canSetup}
            onClick={rotate}
            className="min-h-[44px] rounded-tile border border-line-strong bg-fill px-4 text-base text-ink disabled:opacity-40"
          >
            Drehen ({horizontal ? 'waagrecht' : 'senkrecht'})
          </button>
          <button
            type="button"
            disabled={!canSetup}
            onClick={() => {
              sfx('shuffle');
              setLayout(randomLayout(lengths, noTouch));
              setActive(0);
            }}
            className="min-h-[44px] rounded-tile border border-line-strong bg-fill px-4 text-base text-ink disabled:opacity-40"
          >
            Zufällig
          </button>
          <button
            type="button"
            disabled={!canSetup || !allPlaced}
            onClick={() =>
              onMove({ type: 'flotte', ships: layout.filter((s): s is Ship => s !== null) })
            }
            className="min-h-[44px] rounded-tile bg-brand-gradient px-6 text-base font-semibold text-white shadow-glow disabled:opacity-40"
          >
            Flotte bereit
          </button>
        </div>
      </div>
    );
  }

  // Schieß- und Endphase: gegnerisches Raster oben (dort wird getippt), eigenes darunter.
  const revealedEnemy = view.revealed?.[enemy] ?? null;
  const waitingSetup = view.phase === 'aufbau';
  const hint = waitingSetup
    ? 'Deine Flotte steht. Warte auf den Gegner …'
    : view.phase === 'ende' || finished
      ? 'Partie beendet.'
      : myTurn
        ? `Feuer frei! Tippe ein Feld im gegnerischen Raster an.${view.nochmal ? ' Nach einem Treffer darfst du noch einmal.' : ''}`
        : `${seats[view.turn]?.name ?? 'Der Gegner'} zielt …`;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3">
      {styles}
      <p className="text-center text-sm text-ink-muted" aria-live="polite">
        {hint}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Grid
          label={
            mySeat === null ? `Raster von ${seats[enemy]?.name ?? 'Blau'}` : 'Gegnerisches Raster'
          }
          marks={view.enemyGrid}
          lastShot={enemyLast}
          interactive={myTurn}
          accent={myColor}
          onCell={myTurn ? shoot : undefined}
          ships={
            <>
              {revealedEnemy?.map((s, i) => (
                <ShipShape
                  key={`r${i}`}
                  ship={s}
                  fill="rgba(148,163,184,0.25)"
                  stroke="#94a3b8"
                  dashed
                />
              ))}
              {view.enemySunk.map((s, i) => (
                <ShipShape key={`s${i}`} ship={s} fill="rgba(127,29,29,0.35)" stroke={enemyColor} />
              ))}
            </>
          }
        />
        <Grid
          label={mySeat === null ? `Raster von ${seats[me]?.name ?? 'Rot'}` : 'Deine Flotte'}
          marks={view.myGrid}
          lastShot={myLast}
          interactive={false}
          accent={myColor}
          ships={(view.myFleet ?? view.revealed?.[me] ?? view.mySunk).map((s, i) => (
            <ShipShape key={i} ship={s} fill={myColor} stroke="rgba(0,0,0,0.5)" opacity={0.85} />
          ))}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-muted">
        <span>Noch zu versenken:</span>
        {remaining.length === 0 && <span>nichts mehr</span>}
        {remaining.map((len, i) => (
          <span key={i} className="flex gap-0.5 rounded-md bg-fill px-1.5 py-1">
            {Array.from({ length: len }, (_, k) => (
              <span key={k} className="h-2.5 w-2.5 rounded-sm" style={{ background: enemyColor }} />
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
