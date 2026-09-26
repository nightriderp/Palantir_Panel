'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { seatColor } from '../../seatColors';

/** Spiegel von `BackgammonView`/`BackgammonMove` aus `@palantir/arcade` (Typen einzelner Spiele sind nicht exportiert). */
interface BgStep {
  from: number;
  to: number;
}

type BackgammonMove = { type: 'wuerfeln' } | { type: 'ziehen'; steps: BgStep[] };

interface BackgammonView {
  points: number[];
  bar: [number, number];
  off: [number, number];
  turn: number;
  phase: 'wuerfeln' | 'ziehen';
  dice: number[];
  pips: [number, number];
  lastSteps: BgStep[];
  lastSeat: number | null;
  choices: BgStep[][];
  finished: boolean;
}

interface Pos {
  points: number[];
  bar: number[];
  off: number[];
}

// ---------------------------------------------------------------------------
// Geometrie: 12 Spalten, Bar in der Mitte, Ablage rechts.
// ---------------------------------------------------------------------------

const COL = 20;
const BAR = 16;
const LEFT = 6;
const W = LEFT + 12 * COL + BAR + 32;
const H = 224;
const TRAY_X = LEFT + 12 * COL + BAR + 4;
const R = 8.6;

const barPoint = (seat: number): number => (seat === 0 ? 25 : 0);
const offPoint = (seat: number): number => (seat === 0 ? 0 : 25);

/** Anzeigenummer: Jeder sieht sein Heimfeld unten rechts. */
function display(p: number, me: number): number {
  return me === 0 ? p : 25 - p;
}

function columnOf(d: number): { x: number; top: boolean } {
  const top = d >= 13;
  const col = top ? d - 13 : 12 - d;
  const x = LEFT + col * COL + (col >= 6 ? BAR : 0) + COL / 2;
  return { x, top };
}

function owned(pos: Pos, seat: number, p: number): number {
  const v = pos.points[p] ?? 0;
  return seat === 0 ? Math.max(0, v) : Math.max(0, -v);
}

function applyLocal(pos: Pos, seat: number, step: BgStep): Pos {
  const next: Pos = { points: [...pos.points], bar: [...pos.bar], off: [...pos.off] };
  const s = seat === 0 ? 1 : -1;
  if (step.from === barPoint(seat)) next.bar[seat] = (next.bar[seat] ?? 0) - 1;
  else next.points[step.from] = (next.points[step.from] ?? 0) - s;
  if (step.to === offPoint(seat)) {
    next.off[seat] = (next.off[seat] ?? 0) + 1;
    return next;
  }
  if (owned(next, 1 - seat, step.to) === 1) {
    next.points[step.to] = 0;
    next.bar[1 - seat] = (next.bar[1 - seat] ?? 0) + 1;
  }
  next.points[step.to] = (next.points[step.to] ?? 0) + s;
  return next;
}

const key = (s: BgStep): string => `${s.from}-${s.to}`;

/** Rest einer Zugfolge nach Abzug der gewählten Schritte; `null`, wenn sie nicht passt. */
function remainder(choice: readonly BgStep[], picked: readonly BgStep[]): BgStep[] | null {
  const rest = [...choice];
  for (const p of picked) {
    const i = rest.findIndex((s) => key(s) === key(p));
    if (i < 0) return null;
    rest.splice(i, 1);
  }
  return rest;
}

/** Welche Würfel die gewählten Schritte verbraucht haben (Auswürfeln: kleinster passender). */
function usedDice(dice: readonly number[], picked: readonly BgStep[]): boolean[] {
  const used = dice.map(() => false);
  for (const s of picked) {
    const dist = Math.abs(s.from - s.to);
    let i = dice.findIndex((d, j) => !used[j] && d === dist);
    if (i < 0) {
      let best = -1;
      dice.forEach((d, j) => {
        if (!used[j] && d > dist && (best < 0 || d < dice[best]!)) best = j;
      });
      i = best;
    }
    if (i >= 0) used[i] = true;
  }
  return used;
}

// ---------------------------------------------------------------------------

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

function Die({
  value,
  x,
  y,
  used,
  tint,
}: {
  value: number;
  x: number;
  y: number;
  used: boolean;
  tint: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={used ? 0.35 : 1}>
      <g className="bg-die-roll">
        <rect
          x="-8"
          y="-8"
          width="16"
          height="16"
          rx="3.5"
          fill="#fbf7ee"
          stroke={tint}
          strokeWidth="1.2"
        />
        {(PIPS[value] ?? []).map(([dx, dy], i) => (
          <circle key={i} cx={dx * 4.2} cy={dy * 4.2} r="1.5" fill="#1f2937" />
        ))}
      </g>
    </g>
  );
}

function Checker({
  x,
  y,
  color,
  ring,
  faded,
}: {
  x: number;
  y: number;
  color: string;
  ring?: string;
  faded?: boolean;
}) {
  return (
    <g
      className="bg-checker"
      style={{ transform: `translate(${x}px, ${y}px)` }}
      opacity={faded ? 0.45 : 1}
    >
      <circle cx="0" cy="0.9" r={R} fill="#000" opacity="0.35" />
      <circle cx="0" cy="0" r={R} fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth="0.5" />
      <circle
        cx="0"
        cy="0"
        r={R * 0.62}
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="0.7"
      />
      <circle cx="-2.5" cy="-2.8" r={R * 0.45} fill="#fff" opacity="0.18" />
      {ring && <circle cx="0" cy="0" r={R + 1.6} fill="none" stroke={ring} strokeWidth="1.3" />}
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
}: TurnBoardProps<BackgammonView, BackgammonMove>) {
  const me = mySeat ?? 0;
  const colors = [seats[0]?.color ?? seatColor(0), seats[1]?.color ?? seatColor(1)];
  const myTurn = canAct && !finished && !view.finished && mySeat === view.turn;
  const [picked, setPicked] = useState<BgStep[]>([]);
  const [source, setSource] = useState<number | null>(null);

  // Neuer Stand vom Wirt ⇒ halbe Eingabe verwerfen.
  const stamp = `${view.points.join(',')}|${view.dice.join('')}|${view.turn}|${view.phase}`;
  const [seen, setSeen] = useState(stamp);
  if (seen !== stamp) {
    setSeen(stamp);
    setPicked([]);
    setSource(null);
  }

  // Geräusche bei jedem neuen Wurf bzw. fremden Zug. Die Würfel selbst rollen
  // über ihren Schlüssel: Ein neuer Wurf hängt sie neu ein, die Animation läuft an.
  const diceRef = useRef(view.dice.join(''));
  const stepsRef = useRef(view.lastSteps);
  useEffect(() => {
    const d = view.dice.join('');
    if (d === diceRef.current) return;
    diceRef.current = d;
    if (d) sfx('dice');
  }, [view.dice, sfx]);
  useEffect(() => {
    if (stepsRef.current === view.lastSteps) return;
    stepsRef.current = view.lastSteps;
    if (view.finished) sfx(view.lastSeat === mySeat ? 'win' : 'lose');
    else if (view.lastSeat !== mySeat && view.lastSteps.length > 0) sfx('move');
  }, [view.lastSteps, view.lastSeat, view.finished, mySeat, sfx]);

  const base: Pos = { points: view.points, bar: view.bar, off: view.off };
  let pos = base;
  for (const s of picked) pos = applyLocal(pos, view.turn, s);

  const live = myTurn && view.phase === 'ziehen';
  const rests = live
    ? view.choices.map((c) => remainder(c, picked)).filter((r): r is BgStep[] => r !== null)
    : [];
  const complete = live && rests.some((r) => r.length === 0) && picked.length > 0;
  const onBar = (pos.bar[view.turn] ?? 0) > 0;
  const hasChecker = (p: number): boolean =>
    p === barPoint(view.turn) ? (pos.bar[view.turn] ?? 0) > 0 : owned(pos, view.turn, p) > 0;

  const sources = new Set<number>();
  for (const r of rests) {
    for (const s of r)
      if (hasChecker(s.from) && (!onBar || s.from === barPoint(view.turn))) sources.add(s.from);
  }

  // Ziele des gewählten Steins: auch mehrere Würfel hintereinander mit demselben Stein.
  const targets = new Map<number, BgStep[]>();
  if (source !== null) {
    for (const r of rests) {
      const pool = [...r];
      let cur = source;
      const chain: BgStep[] = [];
      for (;;) {
        const i = pool.findIndex((s) => s.from === cur);
        if (i < 0) break;
        const step = pool.splice(i, 1)[0]!;
        chain.push(step);
        cur = step.to;
        if (!targets.has(cur)) targets.set(cur, [...chain]);
        if (cur === offPoint(view.turn)) break;
      }
    }
  }

  function tapPoint(p: number) {
    if (!live) return;
    if (source !== null && targets.has(p)) {
      const steps = targets.get(p)!;
      const hit = steps.some(
        (s) => s.to !== offPoint(view.turn) && owned(pos, 1 - view.turn, s.to) === 1,
      );
      sfx(hit ? 'capture' : 'move');
      setPicked([...picked, ...steps]);
      setSource(null);
      return;
    }
    if (sources.has(p)) {
      sfx('click');
      setSource(source === p ? null : p);
      return;
    }
    setSource(null);
  }

  function submit() {
    const choice = view.choices.find(
      (c) => remainder(c, picked)?.length === 0 && c.length === picked.length,
    );
    if (!choice) return;
    onMove({ type: 'ziehen', steps: choice });
  }

  const used = usedDice(view.dice, picked);
  const lastTo = new Set(view.lastSteps.map((s) => s.to));
  const lastFrom = new Set(view.lastSteps.map((s) => s.from));

  // --- Zeichnen ------------------------------------------------------------
  const triangles = [];
  const checkers = [];
  for (let p = 1; p <= 24; p += 1) {
    const d = display(p, me);
    const { x, top } = columnOf(d);
    const baseY = top ? 6 : H - 6;
    const tipY = top ? 96 : H - 96;
    const dark = d % 2 === 0;
    const isTarget = targets.has(p);
    triangles.push(
      <g key={`tri${p}`}>
        <polygon
          points={`${x - COL / 2 + 1},${baseY} ${x + COL / 2 - 1},${baseY} ${x},${tipY}`}
          fill={dark ? '#7c2d12' : '#e7c9a0'}
          opacity={dark ? 0.95 : 0.9}
        />
        {isTarget && (
          <polygon
            className="bg-pulse"
            points={`${x - COL / 2 + 1},${baseY} ${x + COL / 2 - 1},${baseY} ${x},${tipY}`}
            fill={colors[view.turn]}
            opacity="0.55"
          />
        )}
        {(lastFrom.has(p) || lastTo.has(p)) && (
          <line
            x1={x - 6}
            x2={x + 6}
            y1={top ? 3 : H - 3}
            y2={top ? 3 : H - 3}
            stroke="#fde68a"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity={lastTo.has(p) ? 1 : 0.45}
          />
        )}
      </g>,
    );
    const n0 = owned(pos, 0, p);
    const n1 = owned(pos, 1, p);
    const n = n0 || n1;
    const owner = n0 > 0 ? 0 : 1;
    const shown = Math.min(n, 5);
    for (let i = 0; i < shown; i += 1) {
      const y = top ? 6 + R + i * (R * 2 - 0.6) : H - 6 - R - i * (R * 2 - 0.6);
      const isTop = i === shown - 1;
      checkers.push(
        <Checker
          key={`c${p}-${i}`}
          x={x}
          y={y}
          color={colors[owner]!}
          ring={
            isTop && source === p
              ? '#ffffff'
              : isTop && sources.has(p) && source === null
                ? 'rgba(255,255,255,0.55)'
                : undefined
          }
        />,
      );
    }
    if (n > 5) {
      const y = top ? 6 + R + 4 * (R * 2 - 0.6) : H - 6 - R - 4 * (R * 2 - 0.6);
      checkers.push(
        <text
          key={`n${p}`}
          x={x}
          y={y + 3}
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          fill="#fff"
          pointerEvents="none"
        >
          {n}
        </text>,
      );
    }
  }

  // Bar: eigene Steine unten, fremde oben.
  const barX = LEFT + 6 * COL + BAR / 2;
  for (const seat of [0, 1]) {
    const n = pos.bar[seat] ?? 0;
    const mineSide = seat === me;
    for (let i = 0; i < Math.min(n, 4); i += 1) {
      const y = mineSide ? H / 2 + 22 + i * 12 : H / 2 - 22 - i * 12;
      const bp = barPoint(seat);
      checkers.push(
        <Checker
          key={`bar${seat}-${i}`}
          x={barX}
          y={y}
          color={colors[seat]!}
          ring={
            i === 0 && seat === view.turn && sources.has(bp)
              ? source === bp
                ? '#fff'
                : 'rgba(255,255,255,0.55)'
              : undefined
          }
        />,
      );
    }
    if (n > 4) {
      checkers.push(
        <text
          key={`barn${seat}`}
          x={barX}
          y={mineSide ? H / 2 + 70 : H / 2 - 64}
          textAnchor="middle"
          fontSize="8"
          fill="#fff"
        >
          {n}
        </text>,
      );
    }
  }

  const offTarget = targets.has(offPoint(view.turn));
  const trays = [0, 1].map((seat) => {
    const mineSide = seat === me;
    const y0 = mineSide ? H / 2 + 8 : 6;
    const h = H / 2 - 14;
    const n = pos.off[seat] ?? 0;
    return (
      <g key={`tray${seat}`}>
        <rect
          x={TRAY_X}
          y={y0}
          width="24"
          height={h}
          rx="3"
          fill="#1c1208"
          stroke="#a16207"
          strokeOpacity="0.5"
        />
        {offTarget && seat === view.turn && (
          <rect
            className="bg-pulse"
            x={TRAY_X}
            y={y0}
            width="24"
            height={h}
            rx="3"
            fill={colors[seat]}
            opacity="0.45"
          />
        )}
        {Array.from({ length: n }, (_, i) => (
          <rect
            key={i}
            x={TRAY_X + 3}
            y={mineSide ? y0 + h - 4 - i * 6 : y0 + 1 + i * 6}
            width="18"
            height="4.6"
            rx="1.5"
            fill={colors[seat]}
            stroke="rgba(0,0,0,0.4)"
            strokeWidth="0.4"
          />
        ))}
      </g>
    );
  });

  // Trefferflächen über die volle Zungenhöhe – auf dem Handy wichtiger als jede Zierde.
  const hits = [];
  for (let p = 1; p <= 24; p += 1) {
    const { x, top } = columnOf(display(p, me));
    hits.push(
      <rect
        key={`hit${p}`}
        x={x - COL / 2}
        y={top ? 0 : H / 2 + 4}
        width={COL}
        height={H / 2 - 4}
        fill="transparent"
        onClick={() => tapPoint(p)}
        className={cn(live && 'cursor-pointer')}
      />,
    );
  }
  hits.push(
    <rect
      key="hitbar"
      x={barX - BAR / 2}
      y={0}
      width={BAR}
      height={H}
      fill="transparent"
      onClick={() => tapPoint(barPoint(view.turn))}
    />,
    <rect
      key="hitoff"
      x={TRAY_X - 2}
      y={0}
      width="30"
      height={H}
      fill="transparent"
      onClick={() => tapPoint(offPoint(view.turn))}
    />,
  );

  const diceX = view.turn === me ? LEFT + 9 * COL + BAR : LEFT + 3 * COL;
  const hint = !myTurn
    ? view.finished || finished
      ? 'Partie beendet.'
      : 'Der Gegner ist am Zug …'
    : view.phase === 'wuerfeln'
      ? 'Du bist dran – würfle!'
      : complete
        ? 'Zug vollständig – bestätigen oder zurücknehmen.'
        : source === null
          ? onBar
            ? 'Erst den Stein von der Bar einsetzen.'
            : 'Wähle einen Stein.'
          : 'Tippe ein leuchtendes Ziel an.';

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <style>{`
        @keyframes bg-roll { 0% { transform: rotate(0) scale(.6) } 60% { transform: rotate(300deg) scale(1.15) } 100% { transform: rotate(360deg) scale(1) } }
        @keyframes bg-pulse { 0%,100% { opacity: .25 } 50% { opacity: .6 } }
        .bg-die-roll { animation: bg-roll .45s ease-out; transform-box: fill-box; transform-origin: center; }
        .bg-pulse { animation: bg-pulse 1.1s ease-in-out infinite; }
        .bg-checker { transition: transform .25s ease-out; }
      `}</style>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {[me, 1 - me].map((seat) => (
          <div
            key={seat}
            className="flex items-center gap-2 rounded-tile border border-line bg-surface-deep px-3 py-2"
          >
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colors[seat] }} />
            <span className="min-w-0 flex-1 truncate text-ink">
              {seats[seat]?.name ?? (seat === 0 ? 'Rot' : 'Blau')}
            </span>
            <span className="text-xs text-ink-muted" title="Augen bis zum Ziel">
              {view.pips[seat]} Augen · {view.off[seat]}/15
            </span>
          </div>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-manipulation select-none"
        role="img"
        aria-label="Backgammon-Brett"
      >
        <defs>
          <linearGradient id="bg-felt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f5130" />
            <stop offset="50%" stopColor="#173f25" />
            <stop offset="100%" stopColor="#1f5130" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} rx="6" fill="#3b2412" />
        <rect x={LEFT} y="4" width={6 * COL} height={H - 8} rx="2" fill="url(#bg-felt)" />
        <rect
          x={LEFT + 6 * COL + BAR}
          y="4"
          width={6 * COL}
          height={H - 8}
          rx="2"
          fill="url(#bg-felt)"
        />
        <rect x={LEFT + 6 * COL} y="0" width={BAR} height={H} fill="#2a180a" />
        {triangles}
        {checkers}
        {trays}
        {view.dice.length > 0 &&
          view.dice.map((v, i) => (
            <Die
              key={`${view.turn}-${view.dice.join('')}-${i}`}
              value={v}
              x={diceX + (i - (view.dice.length - 1) / 2) * 20}
              y={H / 2}
              used={used[i] ?? false}
              tint={colors[view.turn]!}
            />
          ))}
        {hits}
      </svg>
      <p className="text-center text-sm text-ink-muted" aria-live="polite">
        {hint}
      </p>
      {myTurn && (
        <div className="flex flex-wrap justify-center gap-2">
          {view.phase === 'wuerfeln' ? (
            <button
              type="button"
              onClick={() => onMove({ type: 'wuerfeln' })}
              className="min-h-[44px] rounded-tile bg-brand-gradient px-6 text-base font-semibold text-white shadow-glow"
            >
              Würfeln
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={picked.length === 0}
                onClick={() => {
                  setPicked([]);
                  setSource(null);
                }}
                className="min-h-[44px] rounded-tile border border-line-strong bg-fill px-4 text-base text-ink disabled:opacity-40"
              >
                Zurücknehmen
              </button>
              <button
                type="button"
                disabled={!complete}
                onClick={submit}
                className="min-h-[44px] rounded-tile bg-brand-gradient px-6 text-base font-semibold text-white shadow-glow disabled:opacity-40"
              >
                Zug ausführen
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
