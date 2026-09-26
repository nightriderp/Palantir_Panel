'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '@/components/shared';
import { type TurnBoardProps, type TurnSeatInfo } from '../../types';
import { Illustration } from './Illustration';
import {
  ANTWORTEN,
  FRAGEN_FUER_MEISTER,
  MAX_OFFENE_FRAGEN,
  STUFE_NAME,
  URTEILE,
  type BsAufloesung,
  type BsKarte,
  type BsMove,
  type BsView,
} from './shared';

function name(seats: TurnSeatInfo[], i: number): string {
  return seats[i]?.name ?? `Sitz ${i + 1}`;
}

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<BsView, BsMove>) {
  const aktiv = canAct && !finished;
  const meisterName = name(seats, view.meister);

  // Geräusche aus dem Wechsel der Sicht – so hören alle am Tisch dasselbe.
  const vorher = useRef<{
    fragen: number;
    beantwortet: number;
    runde: number;
    phase: string;
  } | null>(null);
  useEffect(() => {
    const jetzt = {
      fragen: view.fragen.length,
      beantwortet: view.fragenGesamt,
      runde: view.runde,
      phase: view.phase,
    };
    const alt = vorher.current;
    vorher.current = jetzt;
    if (!alt) return;
    if (jetzt.phase === 'ende' && alt.phase !== 'ende') sfx('win');
    else if (jetzt.runde > alt.runde) sfx(view.letzte?.geloestVon !== null ? 'score' : 'lose');
    else if (jetzt.phase === 'raten' && alt.phase === 'waehlen') sfx('card');
    else if (jetzt.beantwortet > alt.beantwortet) sfx('click');
    else if (jetzt.fragen > alt.fragen) sfx('tick');
  }, [view, sfx]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-2 sm:p-4">
      <style>{`
        @keyframes bs-flicker { 0%,100% { opacity: 1; } 45% { opacity: .82; } 50% { opacity: .95; } 70% { opacity: .78; } }
        @keyframes bs-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      <Punkte view={view} seats={seats} />

      {view.phase === 'waehlen' && (
        <>
          {view.letzte && <Aufloesung a={view.letzte} seats={seats} />}
          {view.binMeister && aktiv && view.auswahl ? (
            <Auswahl auswahl={view.auswahl} onMove={onMove} />
          ) : (
            <p className="rounded-tile border border-line bg-surface-deep px-4 py-6 text-center text-ink-muted">
              {meisterName} ist Rätselmeister und sucht eine rabenschwarze Geschichte aus …
            </p>
          )}
        </>
      )}

      {view.phase === 'raten' && view.karte && (
        <>
          {/* Neue Karte liegt immer mit der Vorderseite oben – der Schlüssel setzt das Umdrehen zurück. */}
          <Raetselkarte key={view.karte.id} karte={view.karte} loesung={view.loesung} />
          <p className="text-center text-xs text-ink-muted">
            {view.fragenGesamt} {view.fragenGesamt === 1 ? 'Frage' : 'Fragen'} beantwortet
            {view.fragenGesamt < FRAGEN_FUER_MEISTER
              ? ` · ab ${FRAGEN_FUER_MEISTER} punktet auch ${view.binMeister ? 'du als Meister' : meisterName}`
              : ` · ${view.binMeister ? 'du bekommst' : `${meisterName} bekommt`} jetzt auch einen Punkt`}
          </p>
          {view.binMeister ? (
            <MeisterPult view={view} seats={seats} aktiv={aktiv} onMove={onMove} />
          ) : (
            mySeat !== null && (
              <RaterPult view={view} mySeat={mySeat} aktiv={aktiv} onMove={onMove} />
            )
          )}
          <Fragenliste view={view} seats={seats} aktiv={aktiv} onMove={onMove} />
          <Versuche view={view} seats={seats} aktiv={aktiv} onMove={onMove} />
        </>
      )}

      {view.phase === 'ende' && view.letzte && <Aufloesung a={view.letzte} seats={seats} />}
    </div>
  );
}

function Punkte({ view, seats }: { view: BsView; seats: TurnSeatInfo[] }) {
  const best = Math.max(...view.punkte);
  return (
    <div className="rounded-tile border border-line bg-surface-deep p-2">
      <div className="mb-1.5 flex items-center justify-between px-1 text-xs text-ink-muted">
        <span className="uppercase tracking-wide">Punkte</span>
        <span>
          {view.phase === 'ende'
            ? 'Alle Runden gespielt'
            : `Runde ${view.runde + 1} von ${view.runden}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {view.punkte.map((p, i) => (
          <span
            key={i}
            className={cn(
              'flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors',
              i === view.meister && view.phase !== 'ende'
                ? 'border-violet-400/60 bg-violet-500/15 text-ink'
                : 'border-line-strong bg-fill text-ink-muted',
              view.phase === 'ende' &&
                p === best &&
                best > 0 &&
                'border-amber-400 bg-amber-400/15 text-amber-100',
            )}
            title={i === view.meister ? 'Rätselmeister' : undefined}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: seats[i]?.color ?? '#64748b' }}
            />
            <span className="max-w-[7rem] truncate">{name(seats, i)}</span>
            {i === view.meister && view.phase !== 'ende' && (
              <span aria-label="Rätselmeister">🕯️</span>
            )}
            <span className="font-bold tabular-nums text-ink">{p}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Raetselkarte({ karte, loesung }: { karte: BsKarte; loesung: string | null }) {
  const [umgedreht, setUmgedreht] = useState(false);
  const zeigtLoesung = umgedreht && loesung !== null;
  return (
    <div
      className="flex flex-col items-center gap-2"
      style={{ animation: 'bs-rise 400ms ease-out' }}
    >
      <div className="w-full max-w-md" style={{ perspective: '1200px' }}>
        <div
          className="relative grid transition-transform duration-700"
          style={{
            transformStyle: 'preserve-3d',
            transform: zeigtLoesung ? 'rotateY(180deg)' : 'none',
          }}
        >
          <Seite>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-serif text-xl font-bold text-zinc-100">{karte.titel}</h3>
              <Stufe stufe={karte.stufe} />
            </div>
            <Illustration stufe={karte.stufe} />
            <p className="font-serif text-lg italic leading-snug text-zinc-200">„{karte.text}“</p>
          </Seite>
          {loesung !== null && (
            <Seite hinten>
              <div className="flex items-center justify-between">
                <h3 className="font-serif text-lg font-bold text-rose-200">Was wirklich geschah</h3>
                <Stufe stufe={karte.stufe} />
              </div>
              <p className="font-serif text-base leading-relaxed text-zinc-200">{loesung}</p>
              <p className="text-xs text-zinc-500">Nur du siehst diese Seite.</p>
            </Seite>
          )}
        </div>
      </div>
      {loesung !== null && (
        <button
          type="button"
          onClick={() => setUmgedreht((u) => !u)}
          className="min-h-10 rounded-full border border-violet-400/50 bg-violet-500/10 px-4 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-500/20"
        >
          {zeigtLoesung ? 'Rätsel zeigen' : 'Lösung ansehen'}
        </button>
      )}
    </div>
  );
}

function Seite({ children, hinten }: { children: ReactNode; hinten?: boolean }) {
  return (
    <div
      className="col-start-1 row-start-1 flex min-h-[18rem] flex-col gap-3 rounded-2xl border border-zinc-700 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-5 shadow-2xl shadow-black/60"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: hinten ? 'rotateY(180deg)' : undefined,
        boxShadow: 'inset 0 0 60px rgba(0,0,0,.8), 0 20px 40px rgba(0,0,0,.5)',
      }}
    >
      {children}
    </div>
  );
}

function Stufe({ stufe }: { stufe: 1 | 2 | 3 }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn('h-1.5 w-1.5 rounded-full', n <= stufe ? 'bg-rose-400' : 'bg-zinc-700')}
        />
      ))}
      <span className="ml-0.5">{STUFE_NAME[stufe]}</span>
    </span>
  );
}

function Auswahl({ auswahl, onMove }: { auswahl: BsKarte[]; onMove: (m: BsMove) => void }) {
  const [filter, setFilter] = useState<0 | 1 | 2 | 3>(0);
  const liste = auswahl.filter((k) => filter === 0 || k.stufe === filter);
  return (
    <div className="rounded-tile border border-violet-400/30 bg-violet-500/5 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Du bist Rätselmeister – wähle ein Rätsel.</p>
        <button
          type="button"
          onClick={() => onMove({ typ: 'waehle', raetsel: null })}
          className="min-h-11 rounded-tile bg-violet-500 px-4 text-sm font-bold text-white transition-colors hover:bg-violet-400"
        >
          🎲 Zufall
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {([0, 1, 2, 3] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={cn(
              'min-h-9 rounded-full border px-3 text-xs font-semibold',
              filter === s
                ? 'border-violet-400 bg-violet-500/20 text-violet-100'
                : 'border-line-strong bg-fill text-ink-muted',
            )}
          >
            {s === 0 ? 'Alle' : STUFE_NAME[s]}
          </button>
        ))}
      </div>
      <ul className="grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {liste.map((k) => (
          <li key={k.id}>
            <button
              type="button"
              onClick={() => onMove({ typ: 'waehle', raetsel: k.id })}
              className="flex h-full w-full flex-col gap-1 rounded-tile border border-zinc-700 bg-zinc-950/70 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-violet-400/60"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-serif font-bold text-zinc-100">{k.titel}</span>
                <Stufe stufe={k.stufe} />
              </span>
              <span className="font-serif text-sm italic text-zinc-400">{k.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MeisterPult({
  view,
  seats,
  aktiv,
  onMove,
}: {
  view: BsView;
  seats: TurnSeatInfo[];
  aktiv: boolean;
  onMove: (m: BsMove) => void;
}) {
  const [sicher, setSicher] = useState(false);
  const rater = view.punkte.map((_, i) => i).filter((i) => i !== view.meister);
  return (
    <div className="space-y-3 rounded-tile border border-violet-400/30 bg-violet-500/5 p-3">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Mündlich gestellte Frage beantworten
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {ANTWORTEN.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={!aktiv}
              onClick={() => onMove({ typ: 'muendlich', antwort: a.id })}
              className={cn(
                'flex min-h-12 items-center justify-between gap-2 rounded-tile border px-3 font-semibold transition-transform active:scale-95 disabled:opacity-50',
                a.klasse,
              )}
            >
              <span>{a.text}</span>
              <span className="rounded-full bg-black/30 px-2 text-sm tabular-nums">
                {view.muendlich[a.id]}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Wer hat es gelöst?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {rater.map((i) => (
            <button
              key={i}
              type="button"
              disabled={!aktiv}
              onClick={() => onMove({ typ: 'geloest', sitz: i })}
              className="flex min-h-11 items-center gap-2 rounded-tile border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: seats[i]?.color ?? '#64748b' }}
              />
              {name(seats, i)} hat gelöst
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        {sicher ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-ink-muted">
              Wirklich auflösen? Du bekommst den Punkt.
            </span>
            <button
              type="button"
              onClick={() => setSicher(false)}
              className="min-h-10 rounded-tile border border-line-strong bg-fill px-3 text-sm text-ink"
            >
              Weiter raten
            </button>
            <button
              type="button"
              disabled={!aktiv}
              onClick={() => {
                setSicher(false);
                onMove({ typ: 'aufloesen' });
              }}
              className="min-h-10 rounded-tile bg-rose-600 px-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Auflösen
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!aktiv}
            onClick={() => setSicher(true)}
            className="min-h-10 rounded-tile border border-rose-500/40 bg-rose-500/10 px-3 text-sm font-semibold text-rose-200 disabled:opacity-50"
          >
            Niemand kommt drauf – auflösen
          </button>
        )}
      </div>
    </div>
  );
}

function RaterPult({
  view,
  mySeat,
  aktiv,
  onMove,
}: {
  view: BsView;
  mySeat: number;
  aktiv: boolean;
  onMove: (m: BsMove) => void;
}) {
  const [frage, setFrage] = useState('');
  const [loesung, setLoesung] = useState('');
  const offen = view.fragen.filter((f) => f.seat === mySeat && f.antwort === null).length;
  const versuchOffen = view.versuche.some((v) => v.seat === mySeat && v.urteil === null);
  const darfFragen = aktiv && offen < MAX_OFFENE_FRAGEN;
  const darfLoesen = aktiv && !versuchOffen;

  const fragen = (e: FormEvent) => {
    e.preventDefault();
    const t = frage.trim();
    if (!t || !darfFragen) return;
    onMove({ typ: 'frage', text: t });
    setFrage('');
  };
  const loesen = (e: FormEvent) => {
    e.preventDefault();
    const t = loesung.trim();
    if (!t || !darfLoesen) return;
    onMove({ typ: 'loesung', text: t });
    setLoesung('');
  };

  return (
    <div className="space-y-2 rounded-tile border border-line-strong bg-surface-deep p-3">
      <form onSubmit={fragen} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={frage}
          onChange={(e) => setFrage(e.target.value)}
          maxLength={200}
          placeholder="Ja/Nein-Frage stellen, z. B. „War es ein Unfall?“"
          aria-label="Frage"
          className="min-h-11 flex-1 rounded-tile border border-line-strong bg-canvas px-3 text-base text-ink outline-none placeholder:text-ink-faint focus:border-violet-400"
        />
        <button
          type="submit"
          disabled={!darfFragen || frage.trim() === ''}
          className="min-h-11 rounded-tile bg-violet-500 px-4 text-sm font-bold text-white transition-opacity disabled:opacity-40"
        >
          Fragen
        </button>
      </form>
      {offen >= MAX_OFFENE_FRAGEN && (
        <p className="text-xs text-ink-muted">
          Drei Fragen warten auf Antwort – gleich geht es weiter.
        </p>
      )}
      <form onSubmit={loesen} className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={loesung}
          onChange={(e) => setLoesung(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Ich weiß es! Die Lösung ist …"
          aria-label="Lösungsversuch"
          className="min-h-11 flex-1 resize-y rounded-tile border border-line-strong bg-canvas px-3 py-2 text-base text-ink outline-none placeholder:text-ink-faint focus:border-emerald-400"
        />
        <button
          type="submit"
          disabled={!darfLoesen || loesung.trim() === ''}
          className="min-h-11 rounded-tile bg-emerald-600 px-4 text-sm font-bold text-white transition-opacity disabled:opacity-40"
        >
          Lösung wagen
        </button>
      </form>
      {versuchOffen && <p className="text-xs text-ink-muted">Dein Versuch wird gerade geprüft …</p>}
    </div>
  );
}

function Fragenliste({
  view,
  seats,
  aktiv,
  onMove,
}: {
  view: BsView;
  seats: TurnSeatInfo[];
  aktiv: boolean;
  onMove: (m: BsMove) => void;
}) {
  if (view.fragen.length === 0) {
    return (
      <p className="rounded-tile border border-dashed border-line-strong px-4 py-3 text-center text-sm text-ink-faint">
        Noch keine Fragen.{' '}
        {view.binMeister ? 'Am selben Gerät fragen die anderen einfach laut.' : 'Frag drauflos!'}
      </p>
    );
  }
  // Neueste oben – offene Fragen sollen der Meisterin sofort ins Auge fallen.
  const liste = [...view.fragen].reverse();
  return (
    <ul className="space-y-1.5">
      {liste.map((f) => {
        const a = ANTWORTEN.find((x) => x.id === f.antwort);
        return (
          <li
            key={f.id}
            className={cn(
              'rounded-tile border px-3 py-2 transition-colors',
              f.antwort === null
                ? 'border-violet-400/40 bg-violet-500/5'
                : 'border-line bg-surface-deep',
            )}
            style={{ animation: 'bs-rise 250ms ease-out' }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm text-ink">
                <span className="mr-1.5 font-semibold" style={{ color: seats[f.seat]?.color }}>
                  {name(seats, f.seat)}:
                </span>
                {f.text}
              </p>
              {a ? (
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold',
                    a.klasse,
                  )}
                >
                  {a.text}
                </span>
              ) : (
                !view.binMeister && (
                  <span className="shrink-0 text-xs italic text-ink-faint">wartet …</span>
                )
              )}
            </div>
            {f.antwort === null && view.binMeister && (
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {ANTWORTEN.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    disabled={!aktiv}
                    onClick={() => onMove({ typ: 'antwort', frage: f.id, antwort: x.id })}
                    className={cn(
                      'min-h-10 rounded-tile border text-sm font-semibold transition-transform active:scale-95 disabled:opacity-50',
                      x.klasse,
                    )}
                  >
                    {x.text}
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Versuche({
  view,
  seats,
  aktiv,
  onMove,
}: {
  view: BsView;
  seats: TurnSeatInfo[];
  aktiv: boolean;
  onMove: (m: BsMove) => void;
}) {
  if (view.versuche.length === 0) return null;
  return (
    <div className="rounded-tile border border-emerald-500/30 bg-emerald-500/5 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300/80">
        Lösungsversuche
      </p>
      <ul className="space-y-2">
        {[...view.versuche].reverse().map((v) => {
          const u = URTEILE.find((x) => x.id === v.urteil);
          return (
            <li key={v.id} className="rounded-tile border border-line bg-surface-deep px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm text-ink">
                  <span className="mr-1.5 font-semibold" style={{ color: seats[v.seat]?.color }}>
                    {name(seats, v.seat)}:
                  </span>
                  {v.text}
                </p>
                {u && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold',
                      u.klasse,
                    )}
                  >
                    {u.text}
                  </span>
                )}
              </div>
              {v.urteil === null && view.binMeister && (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {URTEILE.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      disabled={!aktiv}
                      onClick={() => onMove({ typ: 'bewerte', versuch: v.id, urteil: x.id })}
                      className={cn(
                        'min-h-10 rounded-tile border text-sm font-semibold disabled:opacity-50',
                        x.klasse,
                      )}
                    >
                      {x.text}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Aufloesung({ a, seats }: { a: BsAufloesung; seats: TurnSeatInfo[] }) {
  const ergebnis =
    a.geloestVon === null
      ? `Niemand ist draufgekommen – ${name(seats, a.meister)} bekommt den Punkt.`
      : `${name(seats, a.geloestVon)} hat es nach ${a.fragen} ${a.fragen === 1 ? 'Frage' : 'Fragen'} gelöst${
          a.meisterPunkt ? ` – ${name(seats, a.meister)} punktet ebenfalls` : ''
        }.`;
  return (
    <div
      className="rounded-2xl border border-zinc-700 bg-gradient-to-br from-zinc-900 to-black p-4 shadow-xl"
      style={{ animation: 'bs-rise 400ms ease-out' }}
    >
      <p className="text-xs uppercase tracking-wide text-zinc-500">
        Auflösung · Runde {a.runde + 1}
      </p>
      <h3 className="mt-1 font-serif text-lg font-bold text-zinc-100">{a.titel}</h3>
      <p className="mt-1 font-serif text-sm italic text-zinc-400">„{a.text}“</p>
      <p className="mt-3 font-serif leading-relaxed text-zinc-200">{a.loesung}</p>
      <p className="mt-3 text-sm font-semibold text-amber-200">{ergebnis}</p>
    </div>
  );
}
