'use client';

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, cn } from '@/components/shared';
import { type TurnBoardProps, type TurnSeatInfo } from '../../types';
import { seatColor } from '../../seatColors';
import { CENTERS, MAP_H, MAP_W, POLYGON_POINTS, seaLinks } from './karte';
import { type Card, type Phase, type RisikoMove, type RisikoView, isValidSet } from './types';

/**
 * Risiko-Brett: eigene SVG-Weltkarte mit Zoom und Verschieben, darunter die
 * Aktionsleiste der aktuellen Phase, Würfel, Handkarten und die Übersicht der
 * Spieler.
 *
 * Bedienung ist bewusst „erst tippen, dann bestätigen": Ein Land antippen
 * wählt es aus, die Schaltflächen darunter führen den Zug aus. So passiert auf
 * dem Handy nichts aus Versehen beim Verschieben der Karte.
 */

type Props = TurnBoardProps<RisikoView, RisikoMove>;

const MIN_W = 280;
const PHASE_STEPS: { key: Phase; label: string }[] = [
  { key: 'reinforce', label: 'Verstärken' },
  { key: 'attack', label: 'Angreifen' },
  { key: 'fortify', label: 'Befestigen' },
];
const CARD_LABELS = ['Infanterie', 'Kavallerie', 'Artillerie', 'Joker'];

interface ViewBox {
  x: number;
  y: number;
  w: number;
}

function clampBox(box: ViewBox): ViewBox {
  const w = Math.min(MAP_W, Math.max(MIN_W, box.w));
  const h = (w * MAP_H) / MAP_W;
  return {
    w,
    x: Math.min(MAP_W - w, Math.max(0, box.x)),
    y: Math.min(MAP_H - h, Math.max(0, box.y)),
  };
}

/** Eigene Länder, die über eigene Länder mit `from` verbunden sind. */
function connected(view: RisikoView, from: number): Set<number> {
  const seat = view.owner[from];
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const t = queue.pop() as number;
    for (const n of view.map.adjacency[t] ?? []) {
      if (!seen.has(n) && view.owner[n] === seat) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

function seatName(seats: TurnSeatInfo[], seat: number): string {
  return seats[seat]?.name ?? `Spieler ${seat + 1}`;
}

// ---------------------------------------------------------------------------
// Kleine Bausteine
// ---------------------------------------------------------------------------

const PIPS: Record<number, [number, number][]> = {
  1: [[14, 14]],
  2: [
    [8, 8],
    [20, 20],
  ],
  3: [
    [8, 8],
    [14, 14],
    [20, 20],
  ],
  4: [
    [8, 8],
    [20, 8],
    [8, 20],
    [20, 20],
  ],
  5: [
    [8, 8],
    [20, 8],
    [14, 14],
    [8, 20],
    [20, 20],
  ],
  6: [
    [8, 8],
    [20, 8],
    [8, 14],
    [20, 14],
    [8, 20],
    [20, 20],
  ],
};

function Die({
  value,
  attacker,
  rolling,
  delay,
}: {
  value: number;
  attacker: boolean;
  rolling: boolean;
  delay: number;
}) {
  return (
    <svg
      viewBox="0 0 28 28"
      className={cn('h-9 w-9 drop-shadow', rolling && 'risiko-roll')}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={`Würfel ${value}`}
    >
      <rect
        x="1"
        y="1"
        width="26"
        height="26"
        rx="6"
        fill={attacker ? '#dc2626' : '#f8fafc'}
        stroke={attacker ? '#7f1d1d' : '#94a3b8'}
        strokeWidth="1.5"
      />
      {(PIPS[value] ?? []).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.6" fill={attacker ? '#fff7ed' : '#0f172a'} />
      ))}
    </svg>
  );
}

function CardIcon({ kind }: { kind: number }) {
  // Einfache eigene Sinnbilder statt der Figuren des Brettspiels.
  if (kind === 0) {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <circle cx="12" cy="6" r="3.5" fill="currentColor" />
        <path d="M6 22 L8 11 H16 L18 22 Z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 1) {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <path
          d="M6 20 V11 A6 6 0 0 1 18 11 V20 H15 V11 A3 3 0 0 0 9 11 V20 Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (kind === 2) {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <rect
          x="4"
          y="9"
          width="15"
          height="5"
          rx="2"
          transform="rotate(-18 12 12)"
          fill="currentColor"
        />
        <circle cx="9" cy="17" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <path
        d="M12 2 L14.8 8.6 L22 9.2 L16.5 13.9 L18.2 21 L12 17.2 L5.8 21 L7.5 13.9 L2 9.2 L9.2 8.6 Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange(v: number): void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5" aria-label={label}>
      <button
        type="button"
        className="h-9 w-9 rounded-md border border-line-strong bg-fill text-lg text-ink disabled:opacity-40"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`${label} verringern`}
      >
        −
      </button>
      <span className="min-w-[2.5rem] text-center text-xl font-bold tabular-nums text-ink">
        {value}
      </span>
      <button
        type="button"
        className="h-9 w-9 rounded-md border border-line-strong bg-fill text-lg text-ink disabled:opacity-40"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`${label} erhöhen`}
      >
        +
      </button>
      {max > min ? (
        <button
          type="button"
          className="ml-1 rounded-md border border-line-strong bg-fill px-2.5 py-2 text-sm text-ink-muted"
          onClick={() => onChange(value === max ? min : max)}
        >
          {value === max ? 'Min.' : 'Max.'}
        </button>
      ) : null}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-tile border border-line-strong bg-surface-deep p-3">{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Brett
// ---------------------------------------------------------------------------

export function Board({ view, mySeat, seats, canAct, onMove, sfx, finished }: Props) {
  const me = view.me ?? mySeat;
  const myTurn = canAct && !finished && me !== null && view.current === me && view.phase !== 'over';
  const colorOf = (seat: number) => seats[seat]?.color ?? seatColor(seat);
  const name = (t: number) => view.map.names[t] ?? `Land ${t}`;
  const hand = view.hand ?? [];

  const [info, setInfo] = useState<number | null>(null);
  const [dice, setDice] = useState(3);
  const [stopAt, setStopAt] = useState(1);
  const [box, setBox] = useState<ViewBox>({ x: 0, y: 0, w: MAP_W });

  /*
   * Auswahl, Menge und markierte Karten tragen den Schlüssel der Phase, in der
   * sie entstanden sind. Wechselt Phase oder Spieler, verfallen sie beim
   * nächsten Zeichnen von selbst – ohne Effekt, der hinterher aufräumt und
   * dabei kurz den alten Pfeil stehen lässt.
   */
  const turnKey = `${view.phase}-${view.current}-${view.round}`;
  const [choice, setChoice] = useState<{ key: string; sel: number | null; target: number | null }>({
    key: '',
    sel: null,
    target: null,
  });
  let sel = choice.key === turnKey ? choice.sel : null;
  let target = choice.key === turnKey ? choice.target : null;
  if (view.phase === 'attack') {
    // Nach einem Angriff bleibt die Auswahl, solange sie noch Sinn ergibt.
    if (sel !== null && (view.owner[sel] !== me || (view.armies[sel] ?? 0) < 2)) {
      sel = null;
      target = null;
    }
    if (target !== null && view.owner[target] === me) target = null;
  }
  const select = (from: number | null, to: number | null = null) =>
    setChoice({ key: turnKey, sel: from, target: to });

  const selArmies = sel !== null ? (view.armies[sel] ?? 0) : 0;
  const amountKey = `${turnKey}-${sel}-${target}-${view.reinforcements}-${view.occupy?.to ?? ''}`;
  const [amountState, setAmountState] = useState<{ key: string; n: number } | null>(null);
  const defaultAmount =
    view.phase === 'reinforce'
      ? view.reinforcements
      : view.phase === 'occupy'
        ? (view.occupy?.max ?? 1)
        : view.phase === 'fortify'
          ? Math.max(1, selArmies - 1)
          : 1;
  const amount = amountState?.key === amountKey ? amountState.n : defaultAmount;
  const setAmount = (n: number) => setAmountState({ key: amountKey, n });

  const pickKey = `${turnKey}-${hand.length}`;
  const [pickState, setPickState] = useState<{ key: string; idx: number[] }>({ key: '', idx: [] });
  const picked = pickState.key === pickKey ? pickState.idx : [];
  const setPicked = (idx: number[]) => setPickState({ key: pickKey, idx });

  // Geräusche aus den Änderungen der Sicht – so klingen auch die Züge der anderen.
  const sfxRef = useRef(sfx);
  useEffect(() => {
    sfxRef.current = sfx;
  }, [sfx]);

  const seq = view.lastAttack?.seq ?? 0;
  const lastConquered = view.lastAttack?.conquered ?? false;
  const [settledSeq, setSettledSeq] = useState(seq);
  const rolling = seq !== settledSeq;
  useEffect(() => {
    if (seq === settledSeq) return;
    sfxRef.current('dice');
    const id = setTimeout(() => {
      setSettledSeq(seq);
      sfxRef.current(lastConquered ? 'capture' : 'hit');
    }, 650);
    return () => clearTimeout(id);
  }, [seq, settledSeq, lastConquered]);

  const placeKey = view.lastPlace
    ? `${view.current}:${view.lastPlace.t}:${view.reinforcements}:${view.setupPool.join(',')}`
    : '';
  const iWon = me !== null && (view.winners?.includes(me) ?? false);
  const myReinforce = view.phase === 'reinforce' && view.current === me;
  const phase = view.phase;
  const handLength = hand.length;
  const seen = useRef({ place: placeKey, hand: handLength, phase, myReinforce });
  useEffect(() => {
    const prev = seen.current;
    if (placeKey && placeKey !== prev.place) sfxRef.current('place');
    if (handLength > prev.hand) sfxRef.current('card');
    if (phase === 'over' && prev.phase !== 'over') sfxRef.current(iWon ? 'win' : 'lose');
    else if (myReinforce && !prev.myReinforce) sfxRef.current('turn');
    seen.current = { place: placeKey, hand: handLength, phase, myReinforce };
  }, [placeKey, handLength, phase, iWon, myReinforce]);

  const links = useMemo(() => seaLinks(view.map.adjacency), [view.map.adjacency]);

  // Hervorhebungen je Phase.
  const highlights = (() => {
    const out = new Set<number>();
    if (!myTurn) return out;
    const owned = (t: number) => view.owner[t] === me;
    view.owner.forEach((_, t) => {
      if (view.phase === 'setup' || view.phase === 'reinforce') {
        if (owned(t)) out.add(t);
      } else if (view.phase === 'attack') {
        if (sel === null) {
          if (
            owned(t) &&
            (view.armies[t] ?? 0) >= 2 &&
            (view.map.adjacency[t] ?? []).some((n) => !owned(n))
          )
            out.add(t);
        } else if (!owned(t) && (view.map.adjacency[sel] ?? []).includes(t)) {
          out.add(t);
        }
      }
    });
    if (view.phase === 'fortify') {
      if (sel === null) {
        view.owner.forEach((o, t) => {
          if (o === me && (view.armies[t] ?? 0) >= 2) out.add(t);
        });
      } else {
        for (const t of connected(view, sel)) if (t !== sel) out.add(t);
      }
    }
    return out;
  })();

  function act(move: RisikoMove) {
    if (!myTurn) return;
    onMove(move);
  }

  function tap(t: number) {
    setInfo(t);
    if (!myTurn) return;
    const owned = view.owner[t] === me;
    const armies = view.armies[t] ?? 0;
    switch (view.phase) {
      case 'setup':
        if (owned) act({ type: 'place', t, n: 1 });
        else sfx('error');
        return;
      case 'reinforce':
        if (!owned) return sfx('error');
        select(t);
        sfx('click');
        return;
      case 'attack': {
        if (owned) {
          if (armies < 2) return sfx('error');
          select(t);
          sfx('click');
          return;
        }
        let from = sel;
        if (from === null || !(view.map.adjacency[from] ?? []).includes(t)) {
          // Feind zuerst getippt: stärkstes eigenes Nachbarland übernimmt den Angriff.
          const candidates = (view.map.adjacency[t] ?? []).filter(
            (n) => view.owner[n] === me && (view.armies[n] ?? 0) >= 2,
          );
          if (candidates.length === 0) return sfx('error');
          from = candidates.reduce((a, b) =>
            (view.armies[b] ?? 0) > (view.armies[a] ?? 0) ? b : a,
          );
        }
        select(from, t);
        setDice(Math.min(3, (view.armies[from] ?? 1) - 1));
        setStopAt(1);
        sfx('click');
        return;
      }
      case 'fortify': {
        if (!owned) return sfx('error');
        if (sel !== null && sel !== t && connected(view, sel).has(t)) {
          select(sel, t);
          sfx('click');
          return;
        }
        if (armies < 2) return sfx('error');
        select(t);
        sfx('click');
        return;
      }
      default:
        return;
    }
  }

  // --- Zoom und Verschieben -------------------------------------------------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ moved: boolean; pinch: number | null; downX: number; downY: number }>({
    moved: false,
    pinch: null,
    downX: 0,
    downY: 0,
  });
  const zoomed = box.w < MAP_W - 1;

  // Gezeichnete Breite messen: Abzeichen und Namen sollen auf dem Handy lesbar bleiben.
  const [widthPx, setWidthPx] = useState(800);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setWidthPx(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function zoomBy(
    factor: number,
    cx = box.x + box.w / 2,
    cy = box.y + (box.w * MAP_H) / MAP_W / 2,
  ) {
    setBox((b) => {
      const w = Math.min(MAP_W, Math.max(MIN_W, b.w * factor));
      const k = w / b.w;
      return clampBox({ w, x: cx - (cx - b.x) * k, y: cy - (cy - b.y) * k });
    });
  }

  function toMap(clientX: number, clientY: number): [number, number] {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return [0, 0];
    return [
      box.x + ((clientX - rect.left) / rect.width) * box.w,
      box.y + ((clientY - rect.top) / rect.height) * ((box.w * MAP_H) / MAP_W),
    ];
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.current = { moved: false, pinch: null, downX: e.clientX, downY: e.clientY };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) drag.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && drag.current.pinch) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const [cx, cy] = toMap((a.x + b.x) / 2, (a.y + b.y) / 2);
      const factor = drag.current.pinch / dist;
      drag.current.pinch = dist;
      drag.current.moved = true;
      zoomBy(factor, cx, cy);
      return;
    }
    // Erst ab ein paar Pixeln gilt es als Verschieben – sonst verschluckt ein zittriger Finger das Antippen.
    if (!drag.current.moved) {
      if (Math.hypot(e.clientX - drag.current.downX, e.clientY - drag.current.downY) < 8) return;
      if (!zoomed) return;
      drag.current.moved = true;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    const scale = box.w / rect.width;
    setBox((b) => clampBox({ w: b.w, x: b.x - dx * scale, y: b.y - dy * scale }));
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) drag.current.pinch = null;
  }

  // --- Zeichnen ---------------------------------------------------------------
  const boxH = (box.w * MAP_H) / MAP_W;
  const unitPx = widthPx / box.w;
  // Mindestens ~8 px Radius auf dem Bildschirm, sonst ist die Zahl auf 360 px Breite nicht lesbar.
  const badgeScale = Math.max(1, 8 / 12.5 / unitPx);
  const showNames = unitPx >= 0.75;
  const nameFont = Math.max(9, 8 / unitPx);
  const last = view.lastAttack;
  const lastFortify = view.lastFortify;
  const alaska = CENTERS[0] ?? [0, 0];
  const kamtschatka = CENTERS[30] ?? [0, 0];

  const map = (
    <div className="relative overflow-hidden rounded-tile border border-line-strong bg-surface-deep">
      <svg
        ref={svgRef}
        viewBox={`${box.x} ${box.y} ${box.w} ${boxH}`}
        className="block h-auto w-full select-none"
        style={{ touchAction: zoomed ? 'none' : 'pan-y', aspectRatio: `${MAP_W} / ${MAP_H}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label="Weltkarte"
      >
        <defs>
          <radialGradient id="risiko-sea" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor="#12355a" />
            <stop offset="100%" stopColor="#061425" />
          </radialGradient>
          <pattern id="risiko-waves" width="40" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M0 10 Q10 4 20 10 T40 10"
              fill="none"
              stroke="#1d4a73"
              strokeWidth="0.8"
              opacity="0.5"
            />
          </pattern>
          <filter id="risiko-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id="risiko-arrow-atk"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 Z" fill="#fca5a5" />
          </marker>
          <marker
            id="risiko-arrow-fort"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 Z" fill="#67e8f9" />
          </marker>
        </defs>
        <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#risiko-sea)" />
        <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#risiko-waves)" />

        {/* Seewege */}
        <g
          stroke="#7dd3fc"
          strokeOpacity="0.45"
          strokeWidth="1.6"
          strokeDasharray="5 5"
          fill="none"
        >
          {links.map((l) =>
            l.wrap ? (
              <g key={`${l.a}-${l.b}`}>
                <line x1={alaska[0]} y1={alaska[1]} x2={0} y2={alaska[1] - 10} />
                <line x1={kamtschatka[0]} y1={kamtschatka[1]} x2={MAP_W} y2={kamtschatka[1] - 10} />
              </g>
            ) : (
              <line
                key={`${l.a}-${l.b}`}
                x1={CENTERS[l.a]?.[0]}
                y1={CENTERS[l.a]?.[1]}
                x2={CENTERS[l.b]?.[0]}
                y2={CENTERS[l.b]?.[1]}
              />
            ),
          )}
        </g>

        {/* Länder */}
        {POLYGON_POINTS.map((points, t) => {
          const owner = view.owner[t] ?? 0;
          const isSel = sel === t;
          const isTarget = target === t;
          const hl = highlights.has(t);
          const wasHit = last && (last.from === t || last.to === t);
          return (
            <polygon
              key={t}
              points={points}
              fill={colorOf(owner)}
              fillOpacity={
                isSel || isTarget ? 0.95 : hl ? 0.82 : myTurn && highlights.size > 0 ? 0.45 : 0.7
              }
              stroke={
                isSel
                  ? '#ffffff'
                  : isTarget
                    ? '#fde047'
                    : hl
                      ? '#fef9c3'
                      : wasHit
                        ? '#fca5a5'
                        : '#0b1220'
              }
              strokeWidth={isSel || isTarget ? 3.5 : hl ? 2.2 : 1.4}
              strokeLinejoin="round"
              className={cn(
                'cursor-pointer transition-[fill,fill-opacity,stroke] duration-300',
                hl && !isSel && 'risiko-pulse',
              )}
              onClick={() => {
                if (drag.current.moved) return;
                tap(t);
              }}
            >
              <title>{`${name(t)} – ${seatName(seats, owner)}, ${view.armies[t] ?? 0} Armeen`}</title>
            </polygon>
          );
        })}

        {/* Letzter Angriff und letzte Verlegung als Pfeil */}
        {last && CENTERS[last.from] && CENTERS[last.to] ? (
          <line
            x1={CENTERS[last.from]?.[0]}
            y1={CENTERS[last.from]?.[1]}
            x2={CENTERS[last.to]?.[0]}
            y2={CENTERS[last.to]?.[1]}
            stroke="#fca5a5"
            strokeWidth="3"
            strokeLinecap="round"
            markerEnd="url(#risiko-arrow-atk)"
            opacity="0.85"
            pointerEvents="none"
          />
        ) : null}
        {lastFortify ? (
          <line
            x1={CENTERS[lastFortify.from]?.[0]}
            y1={CENTERS[lastFortify.from]?.[1]}
            x2={CENTERS[lastFortify.to]?.[0]}
            y2={CENTERS[lastFortify.to]?.[1]}
            stroke="#67e8f9"
            strokeWidth="3"
            strokeDasharray="6 4"
            strokeLinecap="round"
            markerEnd="url(#risiko-arrow-fort)"
            opacity="0.85"
            pointerEvents="none"
          />
        ) : null}
        {sel !== null && target !== null ? (
          <line
            x1={CENTERS[sel]?.[0]}
            y1={CENTERS[sel]?.[1]}
            x2={CENTERS[target]?.[0]}
            y2={CENTERS[target]?.[1]}
            stroke="#fde047"
            strokeWidth="4"
            strokeLinecap="round"
            markerEnd="url(#risiko-arrow-fort)"
            filter="url(#risiko-glow)"
            pointerEvents="none"
          />
        ) : null}

        {/* Armee-Abzeichen */}
        {CENTERS.map(([cx, cy], t) => {
          const owner = view.owner[t] ?? 0;
          const armies = view.armies[t] ?? 0;
          const r = (armies >= 100 ? 15 : 12.5) * badgeScale;
          return (
            <g key={t} pointerEvents="none">
              <g
                key={`${t}-${owner}-${armies}`}
                className="risiko-pop"
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="#0b1220"
                  stroke={colorOf(owner)}
                  strokeWidth={3 * badgeScale}
                />
                <text
                  x={cx}
                  y={cy + 4.5 * badgeScale}
                  textAnchor="middle"
                  fontSize={(armies >= 100 ? 11 : 13) * badgeScale}
                  fontWeight="800"
                  fill="#ffffff"
                >
                  {armies}
                </text>
              </g>
              {showNames ? (
                <text
                  x={cx}
                  y={cy + r + nameFont}
                  textAnchor="middle"
                  fontSize={nameFont}
                  fontWeight="600"
                  fill="#e2e8f0"
                  stroke="#0b1220"
                  strokeWidth="2.5"
                  paintOrder="stroke"
                >
                  {name(t)}
                </text>
              ) : null}
            </g>
          );
        })}
        {view.lastPlace && view.phase !== 'setup' && CENTERS[view.lastPlace.t] ? (
          <text
            key={`place-${view.lastPlace.t}-${view.armies[view.lastPlace.t]}`}
            x={CENTERS[view.lastPlace.t]?.[0]}
            y={(CENTERS[view.lastPlace.t]?.[1] ?? 0) - 16}
            textAnchor="middle"
            fontSize="12"
            fontWeight="800"
            fill="#bbf7d0"
            stroke="#052e16"
            strokeWidth="2.5"
            paintOrder="stroke"
            className="risiko-float"
            pointerEvents="none"
          >
            +{view.lastPlace.n}
          </text>
        ) : null}
      </svg>

      <div className="absolute right-2 top-2 flex flex-col gap-1.5">
        {[
          { label: '+', title: 'Hineinzoomen', run: () => zoomBy(1 / 1.4) },
          { label: '−', title: 'Herauszoomen', run: () => zoomBy(1.4) },
          { label: '⤢', title: 'Ganze Karte', run: () => setBox({ x: 0, y: 0, w: MAP_W }) },
        ].map((b) => (
          <button
            key={b.title}
            type="button"
            title={b.title}
            aria-label={b.title}
            onClick={b.run}
            className="h-9 w-9 rounded-md border border-line-strong bg-surface-deep/90 text-lg font-bold text-ink shadow"
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );

  // --- Aktionsleiste ------------------------------------------------------------
  const mustTrade = view.phase === 'reinforce' && hand.length >= 5;
  const currentName = seatName(seats, view.current);

  let actions: ReactNode = null;
  if (myTurn) {
    switch (view.phase) {
      case 'setup':
        actions = (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base text-ink">
              Tippe auf ein eigenes Land, um eine Armee zu setzen – noch{' '}
              <strong>{view.setupPool[me ?? 0] ?? 0}</strong>.
            </p>
            <Button size="sm" onClick={() => act({ type: 'autoSetup' })}>
              Rest automatisch verteilen
            </Button>
          </div>
        );
        break;
      case 'reinforce':
        actions = mustTrade ? (
          <p className="text-base text-warning">
            Du hast fünf oder mehr Karten und musst erst einen Satz tauschen (unten).
          </p>
        ) : sel !== null && view.owner[sel] === me ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base text-ink">
              Nach <strong>{name(sel)}</strong>:
            </span>
            <Stepper
              label="Armeen"
              value={Math.min(amount, view.reinforcements)}
              min={1}
              max={view.reinforcements}
              onChange={setAmount}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                act({
                  type: 'place',
                  t: sel,
                  n: Math.max(1, Math.min(amount, view.reinforcements)),
                });
              }}
            >
              Setzen
            </Button>
          </div>
        ) : (
          <p className="text-base text-ink">
            Tippe auf ein eigenes Land, um dort Armeen zu setzen – noch{' '}
            <strong>{view.reinforcements}</strong>.
          </p>
        );
        break;
      case 'attack': {
        const maxDice = Math.max(1, Math.min(3, selArmies - 1));
        actions = (
          <div className="flex flex-col gap-3">
            {sel !== null && target !== null ? (
              <>
                <p className="text-base text-ink">
                  <strong>{name(sel)}</strong> ({selArmies}) greift <strong>{name(target)}</strong>{' '}
                  ({view.armies[target] ?? 0}) an.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink-muted">Würfel:</span>
                  <div className="flex gap-1" role="group" aria-label="Anzahl Würfel">
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={n > maxDice}
                        onClick={() => setDice(n)}
                        className={cn(
                          'h-9 min-w-[2.5rem] rounded-md border px-2 text-sm font-semibold disabled:opacity-30',
                          Math.min(dice, maxDice) === n
                            ? 'border-transparent bg-brand text-white'
                            : 'border-line-strong bg-fill text-ink',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() =>
                      act({ type: 'attack', from: sel, to: target, dice: Math.min(dice, maxDice) })
                    }
                  >
                    Würfeln
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink-muted">Blitz bis Rest:</span>
                  <Stepper
                    label="Schwelle"
                    value={Math.min(stopAt, Math.max(1, selArmies - 1))}
                    min={1}
                    max={Math.max(1, selArmies - 1)}
                    onChange={setStopAt}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={selArmies <= stopAt}
                    onClick={() =>
                      act({ type: 'attack', from: sel, to: target, blitz: true, stopAt })
                    }
                  >
                    Blitzangriff
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-base text-ink">
                {sel === null
                  ? 'Tippe ein eigenes Land mit mindestens zwei Armeen – oder direkt ein feindliches Nachbarland.'
                  : `Von ${name(sel)} aus: Tippe ein feindliches Nachbarland.`}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => act({ type: 'endAttack' })}>
                Weiter zum Befestigen
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act({ type: 'endTurn' })}>
                Zug beenden
              </Button>
            </div>
          </div>
        );
        break;
      }
      case 'occupy': {
        const occ = view.occupy;
        if (occ) {
          const value = Math.min(occ.max, Math.max(occ.min, amount));
          actions = (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base text-ink">
                <strong>{name(occ.to)}</strong> erobert! Armeen nachziehen:
              </span>
              <Stepper
                label="Nachziehen"
                value={value}
                min={occ.min}
                max={occ.max}
                onChange={setAmount}
              />
              <Button variant="primary" size="sm" onClick={() => act({ type: 'occupy', n: value })}>
                Nachziehen
              </Button>
            </div>
          );
        }
        break;
      }
      case 'fortify':
        actions = (
          <div className="flex flex-col gap-3">
            {sel !== null && target !== null ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-base text-ink">
                  <strong>{name(sel)}</strong> → <strong>{name(target)}</strong>:
                </span>
                <Stepper
                  label="Armeen"
                  value={Math.min(Math.max(1, amount), Math.max(1, selArmies - 1))}
                  min={1}
                  max={Math.max(1, selArmies - 1)}
                  onChange={setAmount}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    act({
                      type: 'fortify',
                      from: sel,
                      to: target,
                      n: Math.min(Math.max(1, amount), Math.max(1, selArmies - 1)),
                    })
                  }
                >
                  Verlegen &amp; Zug beenden
                </Button>
              </div>
            ) : (
              <p className="text-base text-ink">
                {sel === null
                  ? 'Befestigen: Tippe ein eigenes Land mit mindestens zwei Armeen.'
                  : `Von ${name(sel)} aus: Tippe ein verbundenes eigenes Land.`}
              </p>
            )}
            <div>
              <Button size="sm" variant="ghost" onClick={() => act({ type: 'endTurn' })}>
                Zug ohne Befestigen beenden
              </Button>
            </div>
          </div>
        );
        break;
      default:
        break;
    }
  }

  const phaseText: Record<Phase, string> = {
    setup: 'Aufbau',
    reinforce: 'Verstärken',
    attack: 'Angreifen',
    occupy: 'Nachziehen',
    fortify: 'Befestigen',
    over: 'Partie vorbei',
  };

  // --- Karten -------------------------------------------------------------------
  const pickedCards = picked.map((i) => hand[i]).filter((c): c is Card => c !== undefined);
  const canTrade =
    myTurn && view.phase === 'reinforce' && pickedCards.length === 3 && isValidSet(pickedCards);

  function suggestSet() {
    for (let a = 0; a < hand.length; a += 1)
      for (let b = a + 1; b < hand.length; b += 1)
        for (let c = b + 1; c < hand.length; c += 1) {
          const set = [hand[a], hand[b], hand[c]].filter((x): x is Card => x !== undefined);
          if (isValidSet(set)) {
            setPicked([a, b, c]);
            return;
          }
        }
    sfx('error');
  }

  const infoT = info ?? sel;

  return (
    <div className="flex flex-col gap-3">
      <style>{`
        @keyframes risiko-roll { 0% { transform: rotate(0) translateY(0) } 30% { transform: rotate(200deg) translateY(-8px) } 60% { transform: rotate(320deg) translateY(2px) } 100% { transform: rotate(360deg) translateY(0) } }
        .risiko-roll { animation: risiko-roll 0.6s ease-out both; }
        @keyframes risiko-pop { 0% { transform: scale(1.45) } 100% { transform: scale(1) } }
        .risiko-pop { animation: risiko-pop 0.35s ease-out; }
        @keyframes risiko-pulse { 0%,100% { stroke-opacity: 1 } 50% { stroke-opacity: 0.35 } }
        .risiko-pulse { animation: risiko-pulse 1.3s ease-in-out infinite; }
        @keyframes risiko-float { 0% { opacity: 1; transform: translateY(0) } 100% { opacity: 0; transform: translateY(-14px) } }
        .risiko-float { animation: risiko-float 1.4s ease-out forwards; }
        @media (prefers-reduced-motion: reduce) { .risiko-roll, .risiko-pop, .risiko-pulse, .risiko-float { animation: none; } }
      `}</style>

      {/* Phasen-Leiste */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" aria-label="Phase">
          {view.phase === 'setup' ? (
            <span className="rounded-full bg-brand px-3 py-1 text-sm font-semibold text-white">
              Aufbau
            </span>
          ) : (
            PHASE_STEPS.map((step, i) => {
              const active =
                view.phase === step.key || (step.key === 'attack' && view.phase === 'occupy');
              return (
                <span key={step.key} className="flex items-center gap-1">
                  {i > 0 ? <span className="text-ink-faint">›</span> : null}
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-sm font-semibold transition-colors duration-300',
                      active ? 'bg-brand text-white' : 'bg-fill text-ink-muted',
                    )}
                  >
                    {step.label}
                  </span>
                </span>
              );
            })
          )}
        </div>
        <span className="text-sm text-ink-muted">
          Runde {view.round}
          {view.options.roundLimit > 0 ? ` von ${view.options.roundLimit}` : ''}
          {view.options.quick ? ' · Schnelles Spiel' : ''}
        </span>
      </div>

      <div className="flex items-center gap-2 text-base">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: colorOf(view.current) }}
        />
        {view.phase === 'over' ? (
          <span className="font-semibold text-ink">{view.summary}</span>
        ) : (
          <span className="text-ink">
            {myTurn ? <strong>Du bist am Zug</strong> : <strong>{currentName}</strong>}
            {' · '}
            {phaseText[view.phase]}
            {view.phase === 'reinforce' ? ` (${view.reinforcements} übrig)` : ''}
          </span>
        )}
      </div>

      {map}

      {infoT !== null ? (
        <p className="text-sm text-ink-muted">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full align-middle"
            style={{ background: colorOf(view.owner[infoT] ?? 0) }}
          />{' '}
          <strong className="text-ink">{name(infoT)}</strong> ·{' '}
          {view.map.continents[view.map.continentOf[infoT] ?? 0]?.name} ·{' '}
          {seatName(seats, view.owner[infoT] ?? 0)} · {view.armies[infoT] ?? 0} Armeen
        </p>
      ) : null}

      {actions ? <Panel>{actions}</Panel> : null}

      {/* Würfel des letzten Angriffs */}
      {last ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5">
              {last.atk.map((v, i) => (
                <Die
                  key={`a${last.seq}-${i}`}
                  value={v}
                  attacker
                  rolling={rolling}
                  delay={i * 60}
                />
              ))}
            </div>
            <span className="text-sm font-semibold text-ink-muted">gegen</span>
            <div className="flex gap-1.5">
              {last.def.map((v, i) => (
                <Die
                  key={`d${last.seq}-${i}`}
                  value={v}
                  attacker={false}
                  rolling={rolling}
                  delay={i * 60 + 90}
                />
              ))}
            </div>
            <p
              className={cn(
                'text-sm text-ink transition-opacity duration-300',
                rolling ? 'opacity-0' : 'opacity-100',
              )}
            >
              {name(last.from)} → {name(last.to)}
              {last.rolls > 1 ? ` · ${last.rolls} Würfe` : ''} · Angreifer −{last.lossA},
              Verteidiger −{last.lossD}
              {last.conquered ? ' · erobert!' : ''}
            </p>
          </div>
        </Panel>
      ) : null}

      {/* Handkarten */}
      {view.hand ? (
        <Panel>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">
              Deine Karten ({hand.length}) · nächster Tausch: +{view.nextTradeValue}
            </span>
            {myTurn && view.phase === 'reinforce' && hand.length >= 3 ? (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={suggestSet}>
                  Satz wählen
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!canTrade}
                  onClick={() => {
                    const [a, b, c] = picked;
                    if (a === undefined || b === undefined || c === undefined) return;
                    act({ type: 'trade', cards: [a, b, c] });
                    setPicked([]);
                  }}
                >
                  Tauschen (+{view.nextTradeValue})
                </Button>
              </div>
            ) : null}
          </div>
          {hand.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Noch keine Karten – erobere in deinem Zug ein Land.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hand.map((card, i) => {
                const on = picked.includes(i);
                const mine = card.t >= 0 && view.owner[card.t] === me;
                return (
                  <button
                    key={`${card.t}-${card.k}-${i}`}
                    type="button"
                    onClick={() => {
                      setPicked(
                        on
                          ? picked.filter((x) => x !== i)
                          : picked.length >= 3
                            ? picked
                            : [...picked, i],
                      );
                      sfx('click');
                    }}
                    className={cn(
                      'flex w-[4.5rem] flex-col items-center gap-1 rounded-md border px-1 py-2 text-center transition-transform duration-200',
                      card.k === 3 ? 'bg-brand-soft text-brand' : 'bg-fill text-ink',
                      on ? '-translate-y-1 border-brand ring-2 ring-brand' : 'border-line-strong',
                    )}
                    aria-pressed={on}
                  >
                    <CardIcon kind={card.k} />
                    <span className="text-2xs font-semibold">{CARD_LABELS[card.k]}</span>
                    <span
                      className={cn(
                        'text-3xs leading-tight',
                        mine ? 'text-success' : 'text-ink-faint',
                      )}
                    >
                      {card.t >= 0 ? name(card.t) : '★'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      ) : null}

      {/* Spieler-Übersicht */}
      <Panel>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="pb-1 font-medium">Spieler</th>
              <th className="pb-1 text-right font-medium">Länder</th>
              <th className="pb-1 text-right font-medium">Armeen</th>
              <th className="pb-1 text-right font-medium">Karten</th>
              <th className="pb-1 text-right font-medium" title="Verstärkung ohne Kartentausch">
                +/Zug
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: view.players }, (_, p) => {
              const lands = view.owner.filter((o) => o === p).length;
              const armies = view.owner.reduce(
                (sum, o, t) => sum + (o === p ? (view.armies[t] ?? 0) : 0),
                0,
              );
              const continents = view.map.continents.filter((c) =>
                c.members.every((t) => view.owner[t] === p),
              );
              return (
                <tr
                  key={p}
                  className={cn(
                    'border-t border-line',
                    view.eliminated[p] && 'text-ink-faint line-through',
                    p === view.current && view.phase !== 'over' && 'bg-fill',
                  )}
                >
                  <td className="py-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: colorOf(p) }}
                    />{' '}
                    <span className="font-semibold">{seatName(seats, p)}</span>
                    {continents.length > 0 ? (
                      <span className="ml-1 text-2xs text-ink-muted">
                        ({continents.map((c) => c.name).join(', ')})
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{lands}</td>
                  <td className="py-1.5 text-right tabular-nums">{armies}</td>
                  <td className="py-1.5 text-right tabular-nums">{view.handCounts[p] ?? 0}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {view.eliminated[p] ? '–' : (view.income[p] ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-2xs text-ink-faint">
          Nachziehstapel: {view.deckCount} Karten · Tausch Nr. {view.trades + 1} bringt +
          {view.nextTradeValue}
        </p>
      </Panel>
    </div>
  );
}
