'use client';

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/components/shared/utils/cn';
import { type TurnBoardProps, type TurnSeatInfo } from '../../types';
import { seatColor } from '../../seatColors';
import { type BoardMode, HexBoard } from './HexBoard';
import { DevIcon, ResIcon } from './icons';
import { COSTS, type CatanMove, type CatanView, DEV_HINTS, DEV_NAMES, RES_NAMES } from './types';

type BuildMode = 'none' | 'road' | 'settlement' | 'city';
type Panel = 'none' | 'trade' | 'invention' | 'monopoly';

const RES = [0, 1, 2, 3, 4] as const;
const zeros = (): number[] => [0, 0, 0, 0, 0];
const total = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);

function seatLabel(seats: TurnSeatInfo[], seat: number): string {
  return seats[seat]?.name ?? `Spieler ${seat + 1}`;
}

// ---------------------------------------------------------------------------
// Kleine Bausteine
// ---------------------------------------------------------------------------

function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'secondary',
  className,
}: {
  children: ReactNode;
  onClick(): void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger' | 'success';
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'min-h-[40px] rounded-tile border px-3 py-2 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'primary' &&
          'border-transparent bg-brand-gradient bg-origin-border text-white shadow-glow hover:brightness-110',
        tone === 'secondary' && 'border-line-strong bg-fill text-ink hover:border-ink-disabled',
        tone === 'danger' && 'border-danger-line bg-danger-soft text-danger hover:brightness-110',
        tone === 'success' &&
          'border-success-line bg-success-soft text-success hover:brightness-110',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Die({ value }: { value: number }) {
  const spots: Record<number, [number, number][]> = {
    1: [[12, 12]],
    2: [
      [7, 7],
      [17, 17],
    ],
    3: [
      [7, 7],
      [12, 12],
      [17, 17],
    ],
    4: [
      [7, 7],
      [17, 7],
      [7, 17],
      [17, 17],
    ],
    5: [
      [7, 7],
      [17, 7],
      [12, 12],
      [7, 17],
      [17, 17],
    ],
    6: [
      [7, 6],
      [17, 6],
      [7, 12],
      [17, 12],
      [7, 18],
      [17, 18],
    ],
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="34"
      height="34"
      className="drop-shadow animate-[spin_0.45s_ease-out_1]"
      aria-label={`Würfel ${value}`}
    >
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="5"
        fill="#fffbeb"
        stroke="#92400e"
        strokeWidth="1.2"
      />
      {(spots[value] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.1" fill={value === 1 ? '#dc2626' : '#1f2937'} />
      ))}
    </svg>
  );
}

function CostIcons({ cost }: { cost: readonly number[] }) {
  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {cost.flatMap((n, res) =>
        Array.from({ length: n }, (_, k) => <ResIcon key={`${res}-${k}`} res={res} size={18} />),
      )}
    </span>
  );
}

/** Zähler mit Plus/Minus – groß genug für Daumen. */
function Stepper({
  res,
  value,
  max,
  onChange,
  disabled,
}: {
  res: number;
  value: number;
  max: number;
  onChange(v: number): void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-tile border border-line bg-surface-deep p-1.5">
      <ResIcon res={res} size={26} />
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`${RES_NAMES[res]} weniger`}
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
          className="h-8 w-8 rounded-lg bg-fill text-lg font-bold text-ink disabled:opacity-30"
        >
          −
        </button>
        <span className="w-5 text-center text-md font-bold tabular-nums text-ink">{value}</span>
        <button
          type="button"
          aria-label={`${RES_NAMES[res]} mehr`}
          disabled={disabled || value >= max}
          onClick={() => onChange(value + 1)}
          className="h-8 w-8 rounded-lg bg-fill text-lg font-bold text-ink disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  accent,
}: {
  title: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-tile border bg-surface-deep/70 p-3',
        accent ? 'border-brand-line ring-1 ring-brand-line' : 'border-line',
      )}
    >
      <h3 className="mb-2 text-2xs font-bold uppercase tracking-wider text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Brett
// ---------------------------------------------------------------------------

export function Board({
  view: rawView,
  seats,
  activeSeats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps) {
  const view = rawView as CatanView;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const colors = useMemo(
    () => Array.from({ length: view.players }, (_, i) => seats[i]?.color ?? seatColor(i)),
    [seats, view.players],
  );
  const legal = view.legal;
  const me = view.me;
  const mine = canAct && !finished && legal !== null && me !== null;

  const [build, setBuild] = useState<BuildMode>('none');
  const [panel, setPanel] = useState<Panel>('none');
  const [tradeTab, setTradeTab] = useState<'bank' | 'player'>('bank');
  const [bankGive, setBankGive] = useState(-1);
  const [bankGet, setBankGet] = useState(-1);
  const [offerGive, setOfferGive] = useState<number[]>(zeros);
  const [offerGet, setOfferGet] = useState<number[]>(zeros);
  const [discard, setDiscard] = useState<number[]>(zeros);
  const [robberHex, setRobberHex] = useState(-1);
  const [picks, setPicks] = useState<number[]>([]);

  // Bei jedem Phasen- oder Sitzwechsel verfallen halbe Eingaben.
  // Zurückgesetzt wird während des Renderns statt in einem Effekt – so gibt
  // es keinen Zwischenstand, in dem alte Auswahl auf neuer Phase liegt.
  const phaseKey = `${view.phase}-${view.current}-${view.round}-${view.setupVertex}`;
  const [seenKey, setSeenKey] = useState(phaseKey);
  if (seenKey !== phaseKey) {
    setSeenKey(phaseKey);
    setBuild('none');
    setRobberHex(-1);
    setDiscard(zeros());
    setPicks([]);
    if (view.phase !== 'main') setPanel('none');
  }

  // Geräusche für Ereignisse, die nicht vom eigenen Tippen kommen.
  const prev = useRef<{
    rollKey: string;
    current: number;
    built: number;
    finished: boolean;
  } | null>(null);
  const { round, current, rolled, lastBuilt, phase, winners } = view;
  const rollKey = `${round}-${current}-${rolled}`;
  useEffect(() => {
    const before = prev.current;
    prev.current = { rollKey, current, built: lastBuilt.length, finished };
    if (!before) return;
    if (rolled && rollKey !== before.rollKey) {
      sfx('dice');
      return;
    }
    if (finished && !before.finished) {
      sfx(me !== null && winners?.includes(me) ? 'win' : 'lose');
      return;
    }
    if (current !== before.current && current === me && phase === 'roll') sfx('turn');
    const last = lastBuilt[lastBuilt.length - 1];
    if (lastBuilt.length > before.built && last && last.seat !== me)
      sfx(last.kind === 'robber' ? 'capture' : 'place');
  }, [rollKey, current, rolled, lastBuilt, phase, winners, finished, me, sfx]);

  const send = (move: CatanMove, sound?: Parameters<typeof sfx>[0]): void => {
    if (!mine) return;
    if (sound) sfx(sound);
    onMove(move);
  };

  // Was auf dem Brett gerade antippbar ist.
  let mode: BoardMode = 'none';
  if (mine && legal) {
    if (view.phase === 'setup') mode = view.setupVertex === -1 ? 'settlement' : 'road';
    else if (view.phase === 'roadBuilding') mode = 'road';
    else if (view.phase === 'robber' && robberHex < 0) mode = 'robber';
    else if (view.phase === 'main') mode = build;
  }
  const targetVertices =
    mode === 'settlement'
      ? (legal?.settlements ?? [])
      : mode === 'city'
        ? (legal?.cities ?? [])
        : [];
  const targetEdges = mode === 'road' ? (legal?.roads ?? []) : [];
  const targetHexes =
    mode === 'robber' ? view.geo.hexes.map((_, h) => h).filter((h) => h !== view.robber) : [];

  const onVertex = (v: number): void => {
    if (mode === 'settlement') send({ t: 'settlement', v }, 'place');
    else if (mode === 'city') send({ t: 'city', v }, 'place');
    setBuild('none');
  };
  const onEdge = (e: number): void => {
    send({ t: 'road', e }, 'place');
    if (view.phase === 'main') setBuild('none');
  };
  const onHex = (h: number): void => {
    const victims = legal?.robberVictims[h] ?? [];
    if (victims.length <= 1) send({ t: 'robber', hex: h, victim: victims[0] ?? -1 }, 'capture');
    else setRobberHex(h);
  };

  const hand = view.hand ?? zeros();
  const devHand = view.devHand ?? zeros();
  const myDiscard = me !== null ? (view.seats[me]?.discard ?? 0) : 0;
  const trade = view.trade;

  // -------------------------------------------------------------------------
  // Statuszeile
  // -------------------------------------------------------------------------
  const currentName = seatLabel(seats, view.current);
  let status: string;
  if (view.phase === 'over') {
    const names = (view.winners ?? []).map((w) => seatLabel(seats, w)).join(' und ');
    status = `${names} ${view.winners && view.winners.length > 1 ? 'gewinnen' : 'gewinnt'}!`;
  } else if (view.phase === 'setup') {
    const second = (view.seats[view.current]?.settlementsLeft ?? 5) <= 4;
    if (mine) {
      status =
        view.setupVertex === -1
          ? `Setz deine ${second ? 'zweite' : 'erste'} Siedlung – hervorgehobene Plätze antippen.`
          : 'Setz eine Straße an deine neue Siedlung.';
    } else status = `${currentName} gründet …`;
  } else if (view.phase === 'roll') {
    status = mine
      ? 'Du bist dran: würfeln (oder vorher einen Ritter ausspielen).'
      : `${currentName} würfelt gleich.`;
  } else if (view.phase === 'discard') {
    status =
      myDiscard > 0
        ? `Die 7! Wirf ${myDiscard} Karten ab.`
        : 'Die 7! Warte, bis alle abgeworfen haben.';
  } else if (view.phase === 'robber') {
    status = mine
      ? robberHex >= 0
        ? 'Bei wem willst du ziehen?'
        : 'Tippe auf ein Feld, um den Räuber zu versetzen.'
      : `${currentName} versetzt den Räuber.`;
  } else if (view.phase === 'roadBuilding') {
    status = mine
      ? `Straßenbau: noch ${view.roadBuildLeft} kostenlose Straße(n).`
      : `${currentName} baut Straßen.`;
  } else if (view.phase === 'trade') {
    status = trade ? `${seatLabel(seats, trade.from)} bietet einen Handel an.` : 'Handel …';
  } else {
    status = mine
      ? build !== 'none'
        ? 'Tippe auf einen hervorgehobenen Platz – oder wähle erneut, um abzubrechen.'
        : 'Bauen, handeln, Karten spielen – dann den Zug beenden.'
      : `${currentName} ist am Zug.`;
  }

  const stealNote =
    view.mySteal &&
    (view.mySteal.role === 'thief'
      ? `Du hast ${RES_NAMES[view.mySteal.res]} von ${seatLabel(seats, view.mySteal.other)} gezogen.`
      : `${seatLabel(seats, view.mySteal.other)} hat dir ${RES_NAMES[view.mySteal.res]} gezogen.`);

  // -------------------------------------------------------------------------
  // Abschnitte
  // -------------------------------------------------------------------------
  const playable = legal?.playableDev ?? zeros();
  const canMain = mine && view.phase === 'main';

  const playDev = (card: number): void => {
    if (card === 3 || card === 4) {
      setPicks([]);
      setPanel(card === 3 ? 'invention' : 'monopoly');
      return;
    }
    send({ t: 'dev', card, a: 0, b: 0 }, 'card');
  };

  const toggleBuild = (next: BuildMode): void => {
    setPanel('none');
    setBuild((b) => (b === next ? 'none' : next));
    sfx('click');
  };

  const rates = legal?.bankRates ?? [4, 4, 4, 4, 4];

  return (
    <div className="flex w-full flex-col gap-3 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_340px] 2xl:items-start">
      {/* Brett mit Statuszeile */}
      <div className="flex flex-col gap-2">
        <div className="flex min-h-[48px] items-center gap-3 rounded-tile border border-line bg-surface-deep/80 px-3 py-2">
          {view.dice.length === 2 && (
            <div
              key={rollKey}
              className="flex shrink-0 gap-1"
              title={`Wurf: ${(view.dice[0] ?? 0) + (view.dice[1] ?? 0)}`}
            >
              <Die value={view.dice[0] ?? 1} />
              <Die value={view.dice[1] ?? 1} />
            </div>
          )}
          <p className={cn('text-md font-semibold', mine ? 'text-ink' : 'text-ink-muted')}>
            {status}
          </p>
        </div>
        <div className="overflow-hidden rounded-tile border border-line bg-[#0b3a55]">
          <HexBoard
            view={view}
            colors={colors}
            uid={uid}
            mode={mode}
            targetVertices={targetVertices}
            targetEdges={targetEdges}
            targetHexes={targetHexes}
            onVertex={onVertex}
            onEdge={onEdge}
            onHex={onHex}
          />
        </div>
        {stealNote && <p className="px-1 text-sm text-ink-muted">{stealNote}</p>}
      </div>

      <div className="flex flex-col gap-3">
        {/* Hauptaktionen */}
        {mine && (
          <div className="flex flex-wrap gap-2">
            {view.phase === 'roll' && (
              <ActionButton tone="primary" className="flex-1" onClick={() => send({ t: 'roll' })}>
                Würfeln
              </ActionButton>
            )}
            {view.phase === 'main' && (
              <>
                <ActionButton
                  className="flex-1"
                  onClick={() => {
                    setBuild('none');
                    setPanel((p) => (p === 'trade' ? 'none' : 'trade'));
                  }}
                >
                  Handeln
                </ActionButton>
                <ActionButton
                  tone="primary"
                  className="flex-1"
                  onClick={() => send({ t: 'end' }, 'turn')}
                >
                  Zug beenden
                </ActionButton>
              </>
            )}
            {view.phase === 'roadBuilding' && (
              <ActionButton className="flex-1" onClick={() => send({ t: 'done' })}>
                Straßenbau beenden
              </ActionButton>
            )}
          </div>
        )}

        {/* Räuber: Opfer wählen */}
        {mine && view.phase === 'robber' && robberHex >= 0 && (
          <Section title="Räuber – Karte ziehen bei" accent>
            <div className="flex flex-wrap gap-2">
              {(legal?.robberVictims[robberHex] ?? []).map((v) => (
                <ActionButton
                  key={v}
                  onClick={() => send({ t: 'robber', hex: robberHex, victim: v }, 'capture')}
                >
                  <span
                    className="mr-1.5 inline-block h-3 w-3 rounded-full"
                    style={{ background: colors[v] }}
                  />
                  {seatLabel(seats, v)} ({view.seats[v]?.cards ?? 0} Karten)
                </ActionButton>
              ))}
              <ActionButton tone="danger" onClick={() => setRobberHex(-1)}>
                Anderes Feld
              </ActionButton>
            </div>
          </Section>
        )}

        {/* Abwurf */}
        {mine && view.phase === 'discard' && myDiscard > 0 && (
          <Section title={`Abwerfen: ${total(discard)} von ${myDiscard}`} accent>
            <div className="grid grid-cols-5 gap-1.5">
              {RES.map((r) => (
                <Stepper
                  key={r}
                  res={r}
                  value={discard[r] ?? 0}
                  max={Math.min(hand[r] ?? 0, (discard[r] ?? 0) + myDiscard - total(discard))}
                  onChange={(n) => setDiscard((d) => d.map((x, i) => (i === r ? n : x)))}
                />
              ))}
            </div>
            <ActionButton
              tone="danger"
              className="mt-2 w-full"
              disabled={total(discard) !== myDiscard}
              onClick={() => send({ t: 'discard', cards: discard }, 'card')}
            >
              Abwerfen
            </ActionButton>
          </Section>
        )}

        {/* Laufendes Handelsangebot */}
        {trade && view.phase === 'trade' && (
          <TradeOffer
            view={view}
            seats={seats}
            colors={colors}
            me={me}
            canAct={canAct && !finished}
            activeSeats={activeSeats}
            hand={hand}
            onMove={(m) => send(m, m.t === 'accept' ? 'coin' : 'click')}
          />
        )}

        {/* Erfindung / Monopol */}
        {mine &&
          (view.phase === 'main' || view.phase === 'roll') &&
          (panel === 'invention' || panel === 'monopoly') && (
            <Section
              title={
                panel === 'invention'
                  ? 'Erfindung: zwei Rohstoffe wählen'
                  : 'Monopol: Rohstoff wählen'
              }
              accent
            >
              <div className="grid grid-cols-5 gap-1.5">
                {RES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={
                      panel === 'invention' &&
                      (view.bank[r] ?? 0) <= picks.filter((p) => p === r).length
                    }
                    onClick={() =>
                      panel === 'monopoly'
                        ? send({ t: 'dev', card: 4, a: r, b: 0 }, 'coin')
                        : setPicks((p) => (p.length >= 2 ? [r] : [...p, r]))
                    }
                    className="flex flex-col items-center gap-1 rounded-tile border border-line bg-fill p-2 text-xs text-ink-muted transition hover:border-brand-line disabled:opacity-30"
                  >
                    <ResIcon res={r} size={28} />
                    {RES_NAMES[r]}
                    {picks.filter((p) => p === r).length > 0 && (
                      <span className="font-bold text-brand">
                        ×{picks.filter((p) => p === r).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                {panel === 'invention' && (
                  <ActionButton
                    tone="primary"
                    className="flex-1"
                    disabled={picks.length !== 2}
                    onClick={() =>
                      send({ t: 'dev', card: 3, a: picks[0] ?? 0, b: picks[1] ?? 0 }, 'card')
                    }
                  >
                    Nehmen
                  </ActionButton>
                )}
                <ActionButton className="flex-1" onClick={() => setPanel('none')}>
                  Abbrechen
                </ActionButton>
              </div>
            </Section>
          )}

        {/* Handel vorbereiten */}
        {canMain && panel === 'trade' && (
          <Section title="Handel" accent>
            <div className="mb-2 flex gap-1 rounded-tile bg-fill p-1">
              {(['bank', 'player'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setTradeTab(tab)}
                  className={cn(
                    'min-h-[36px] flex-1 rounded-lg text-base font-semibold transition',
                    tradeTab === tab ? 'bg-brand-soft text-brand' : 'text-ink-muted',
                  )}
                >
                  {tab === 'bank' ? 'Bank & Häfen' : 'Mitspieler'}
                </button>
              ))}
            </div>
            {tradeTab === 'bank' ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-ink-muted">Gib ab (Kurs steht dabei):</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {RES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={(hand[r] ?? 0) < (rates[r] ?? 4)}
                      onClick={() => setBankGive(r)}
                      className={cn(
                        'flex flex-col items-center rounded-tile border p-1.5 text-xs font-bold transition disabled:opacity-30',
                        bankGive === r
                          ? 'border-brand bg-brand-soft text-brand'
                          : 'border-line bg-fill text-ink-muted',
                      )}
                    >
                      <ResIcon res={r} size={26} />
                      {rates[r]}:1
                    </button>
                  ))}
                </div>
                <p className="text-sm text-ink-muted">Nimm dafür:</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {RES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={(view.bank[r] ?? 0) <= 0 || r === bankGive}
                      onClick={() => setBankGet(r)}
                      className={cn(
                        'flex flex-col items-center rounded-tile border p-1.5 text-xs transition disabled:opacity-30',
                        bankGet === r
                          ? 'border-brand bg-brand-soft text-brand'
                          : 'border-line bg-fill text-ink-muted',
                      )}
                    >
                      <ResIcon res={r} size={26} />
                      {view.bank[r]}
                    </button>
                  ))}
                </div>
                <ActionButton
                  tone="primary"
                  disabled={
                    bankGive < 0 ||
                    bankGet < 0 ||
                    bankGive === bankGet ||
                    (hand[bankGive] ?? 0) < (rates[bankGive] ?? 4)
                  }
                  onClick={() => {
                    send({ t: 'bank', give: bankGive, get: bankGet }, 'coin');
                    setBankGive(-1);
                    setBankGet(-1);
                  }}
                >
                  Mit der Bank tauschen
                </ActionButton>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-ink-muted">Ich gebe:</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {RES.map((r) => (
                    <Stepper
                      key={r}
                      res={r}
                      value={offerGive[r] ?? 0}
                      max={hand[r] ?? 0}
                      onChange={(n) => {
                        setOfferGive((g) => g.map((x, i) => (i === r ? n : x)));
                        if (n > 0) setOfferGet((g) => g.map((x, i) => (i === r ? 0 : x)));
                      }}
                    />
                  ))}
                </div>
                <p className="text-sm text-ink-muted">Ich möchte:</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {RES.map((r) => (
                    <Stepper
                      key={r}
                      res={r}
                      value={offerGet[r] ?? 0}
                      max={19}
                      onChange={(n) => {
                        setOfferGet((g) => g.map((x, i) => (i === r ? n : x)));
                        if (n > 0) setOfferGive((g) => g.map((x, i) => (i === r ? 0 : x)));
                      }}
                    />
                  ))}
                </div>
                <ActionButton
                  tone="primary"
                  disabled={total(offerGive) === 0 || total(offerGet) === 0 || view.offersLeft <= 0}
                  onClick={() => {
                    send({ t: 'offer', give: offerGive, get: offerGet }, 'click');
                    setOfferGive(zeros());
                    setOfferGet(zeros());
                  }}
                >
                  Allen anbieten ({view.offersLeft} übrig)
                </ActionButton>
              </div>
            )}
          </Section>
        )}

        {/* Eigene Hand */}
        {me !== null && (
          <Section title="Deine Hand">
            <div className="grid grid-cols-5 gap-1.5">
              {RES.map((r) => (
                <div
                  key={r}
                  className={cn(
                    'flex flex-col items-center rounded-tile border border-line bg-fill py-1.5 transition',
                    (hand[r] ?? 0) === 0 && 'opacity-40',
                  )}
                  title={RES_NAMES[r]}
                >
                  <ResIcon res={r} size={30} />
                  <span className="text-lg font-bold tabular-nums text-ink">{hand[r] ?? 0}</span>
                  <span className="text-3xs text-ink-muted">{RES_NAMES[r]}</span>
                </div>
              ))}
            </div>
            {total(devHand) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {devHand.map((n, card) => {
                  if (n <= 0) return null;
                  const fresh = view.devNew?.[card] ?? 0;
                  const canPlay = mine && (playable[card] ?? 0) > 0;
                  return (
                    <button
                      key={card}
                      type="button"
                      disabled={!canPlay}
                      title={`${DEV_NAMES[card]}: ${DEV_HINTS[card]}${fresh > 0 ? ' (diesen Zug gekauft)' : ''}`}
                      onClick={() => playDev(card)}
                      className={cn(
                        'flex min-h-[40px] items-center gap-1.5 rounded-tile border px-2 py-1 text-sm transition',
                        canPlay
                          ? 'border-brand-line bg-brand-soft text-ink hover:brightness-110'
                          : 'border-line bg-fill text-ink-muted',
                      )}
                    >
                      <DevIcon card={card} size={22} />
                      <span className="font-semibold">{DEV_NAMES[card]}</span>
                      <span className="tabular-nums">×{n}</span>
                      {canPlay && (
                        <span className="text-2xs font-bold uppercase text-brand">spielen</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        )}

        {/* Baukosten */}
        {me !== null && (
          <Section title="Bauen">
            <div className="flex flex-col gap-1.5">
              {(
                [
                  ['road', 'Straße', COSTS.road, legal?.canBuy.road],
                  ['settlement', 'Siedlung', COSTS.settlement, legal?.canBuy.settlement],
                  ['city', 'Stadt', COSTS.city, legal?.canBuy.city],
                  ['dev', 'Entwicklung', COSTS.dev, legal?.canBuy.dev],
                ] as const
              ).map(([key, label, cost, can]) => {
                const hasSpot =
                  key === 'road'
                    ? (legal?.roads.length ?? 0) > 0
                    : key === 'settlement'
                      ? (legal?.settlements.length ?? 0) > 0
                      : key === 'city'
                        ? (legal?.cities.length ?? 0) > 0
                        : true;
                const enabled = canMain && Boolean(can) && hasSpot;
                const active = key !== 'dev' && build === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!enabled}
                    onClick={() => (key === 'dev' ? send({ t: 'buy' }, 'card') : toggleBuild(key))}
                    className={cn(
                      'flex min-h-[40px] items-center justify-between gap-2 rounded-tile border px-2.5 py-1.5 text-left transition',
                      active ? 'border-brand bg-brand-soft' : 'border-line bg-fill',
                      enabled ? 'hover:border-brand-line' : 'opacity-50',
                    )}
                  >
                    <span className="text-base font-semibold text-ink">
                      {label}
                      {key === 'dev' && (
                        <span className="ml-1 text-xs text-ink-muted">({view.deckCount})</span>
                      )}
                    </span>
                    <CostIcons cost={cost} />
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <Scoreboard view={view} seats={seats} colors={colors} activeSeats={activeSeats} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Handelsangebot und Punktetafel
// ---------------------------------------------------------------------------

function CardGlyph({ dev }: { dev?: boolean }) {
  return (
    <svg viewBox="0 0 12 14" width="10" height="12" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="10"
        height="12"
        rx="2"
        fill={dev ? '#7c3aed' : '#f59e0b'}
        stroke="#111827"
        strokeWidth="1"
      />
    </svg>
  );
}

function OfferLine({ cards }: { cards: readonly number[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      {cards.flatMap((n, r) =>
        Array.from({ length: n }, (_, k) => <ResIcon key={`${r}-${k}`} res={r} size={22} />),
      )}
    </span>
  );
}

function TradeOffer({
  view,
  seats,
  colors,
  me,
  canAct,
  activeSeats,
  hand,
  onMove,
}: {
  view: CatanView;
  seats: TurnSeatInfo[];
  colors: string[];
  me: number | null;
  canAct: boolean;
  activeSeats: number[];
  hand: number[];
  onMove(move: CatanMove): void;
}) {
  const trade = view.trade;
  if (!trade) return null;
  const iOffer = me === trade.from;
  const pending = me !== null && trade.answers[me] === 0 && activeSeats.includes(me);
  const allAnswered = trade.answers.every((a) => a !== 0);
  const takers = trade.answers.map((a, p) => (a === 1 ? p : -1)).filter((p) => p >= 0);
  const canGive = trade.get.every((n, r) => (hand[r] ?? 0) >= n);
  return (
    <Section title={`Angebot von ${seatLabel(seats, trade.from)}`} accent>
      <div className="flex flex-col gap-1.5 text-base text-ink">
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-sm text-ink-muted">gibt</span>
          <OfferLine cards={trade.give} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-sm text-ink-muted">möchte</span>
          <OfferLine cards={trade.get} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {trade.answers.map((a, p) =>
          p === trade.from ? null : (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-xs text-ink-muted"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[p] }} />
              {seatLabel(seats, p)}: {a === 0 ? 'überlegt …' : a === 1 ? 'dabei' : 'nein'}
            </span>
          ),
        )}
      </div>
      {pending && canAct && (
        <div className="mt-2 flex gap-2">
          <ActionButton
            tone="success"
            className="flex-1"
            disabled={!canGive}
            onClick={() => onMove({ t: 'respond', accept: true })}
          >
            {canGive ? 'Annehmen' : 'Karten fehlen'}
          </ActionButton>
          <ActionButton
            tone="danger"
            className="flex-1"
            onClick={() => onMove({ t: 'respond', accept: false })}
          >
            Ablehnen
          </ActionButton>
        </div>
      )}
      {iOffer && canAct && allAnswered && (
        <div className="mt-2 flex flex-wrap gap-2">
          {takers.map((p) => (
            <ActionButton key={p} tone="success" onClick={() => onMove({ t: 'accept', seat: p })}>
              Tauschen mit {seatLabel(seats, p)}
            </ActionButton>
          ))}
          <ActionButton tone="danger" onClick={() => onMove({ t: 'cancel' })}>
            Zurückziehen
          </ActionButton>
        </div>
      )}
      {iOffer && !allAnswered && (
        <p className="mt-2 text-sm text-ink-muted">Warte auf Antworten …</p>
      )}
    </Section>
  );
}

function Scoreboard({
  view,
  seats,
  colors,
  activeSeats,
}: {
  view: CatanView;
  seats: TurnSeatInfo[];
  colors: string[];
  activeSeats: number[];
}) {
  return (
    <Section
      title={`Siegpunkte – Ziel ${view.targetVp}${view.maxRounds > 0 ? ` · Runde ${view.round}/${view.maxRounds}` : view.round > 0 ? ` · Runde ${view.round}` : ''}`}
    >
      <ul className="flex flex-col gap-1.5">
        {view.seats.map((s, p) => {
          const active = activeSeats.includes(p) && view.phase !== 'over';
          const won = view.winners?.includes(p);
          return (
            <li
              key={p}
              className={cn(
                'flex items-center gap-2 rounded-tile border px-2 py-1.5 transition',
                active ? 'border-brand-line bg-brand-soft' : 'border-line bg-fill',
              )}
            >
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-black/30"
                style={{ background: colors[p] }}
              />
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
                {won && (
                  <span className="mr-1 inline-block align-[-4px]">
                    <DevIcon card={1} size={18} />
                  </span>
                )}
                {seatLabel(seats, p)}
              </span>
              <span className="flex items-center gap-2 text-xs tabular-nums text-ink-muted">
                <span title="Rohstoffkarten" className="inline-flex items-center gap-0.5">
                  <CardGlyph /> {s.cards}
                </span>
                <span title="Entwicklungskarten" className="inline-flex items-center gap-0.5">
                  <CardGlyph dev /> {s.devCards}
                </span>
                <span
                  title={`Gespielte Ritter${view.armyHolder === p ? ' – größte Rittermacht' : ''}`}
                  className={cn(
                    'inline-flex items-center gap-0.5',
                    view.armyHolder === p && 'font-bold text-brand',
                  )}
                >
                  <DevIcon card={0} size={14} /> {s.knights}
                </span>
                <span
                  title={`Längste Straße${view.longestHolder === p ? ' – Handelsstraße' : ''}`}
                  className={cn(
                    'inline-flex items-center gap-0.5',
                    view.longestHolder === p && 'font-bold text-brand',
                  )}
                >
                  <DevIcon card={2} size={14} /> {s.roadLength}
                </span>
              </span>
              <span className="w-8 text-right text-xl font-black tabular-nums text-ink">
                {s.vp}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
        <span>Bank:</span>
        {RES.map((r) => (
          <span key={r} className="inline-flex items-center gap-0.5 tabular-nums">
            <ResIcon res={r} size={16} />
            {view.bank[r]}
          </span>
        ))}
      </div>
    </Section>
  );
}
