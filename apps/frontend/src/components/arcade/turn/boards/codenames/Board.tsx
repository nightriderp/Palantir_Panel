'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import {
  type CnAnzahl,
  type CnFarbe,
  type CnMove,
  type CnTeam,
  type CnView,
  hinweisFehler,
} from './shared';

const TEAM_NAME: Record<CnTeam, string> = { rot: 'Rot', blau: 'Blau' };

/** Farben der aufgedeckten Karten – Rot/Blau bewusst kräftig, damit das Raster auf einen Blick lesbar ist. */
const OFFEN: Record<CnFarbe, string> = {
  rot: 'bg-gradient-to-br from-red-500 to-red-700 text-white border-red-300/40',
  blau: 'bg-gradient-to-br from-blue-500 to-blue-700 text-white border-blue-300/40',
  passant: 'bg-gradient-to-br from-stone-400 to-stone-500 text-stone-900 border-stone-200/40',
  attentaeter: 'bg-gradient-to-br from-zinc-800 to-black text-zinc-200 border-zinc-500',
};

/** Die Chef-Sicht markiert verdeckte Karten mit einem Rand in der Schlüsselfarbe. */
const SCHLUESSEL: Record<CnFarbe, string> = {
  rot: 'ring-2 ring-inset ring-red-500 bg-red-100',
  blau: 'ring-2 ring-inset ring-blue-500 bg-blue-100',
  passant: 'ring-1 ring-inset ring-stone-400 bg-stone-200',
  attentaeter: 'ring-[3px] ring-inset ring-zinc-900 bg-zinc-400',
};

const TEAM_TEXT: Record<CnTeam, string> = { rot: 'text-red-400', blau: 'text-blue-400' };
const TEAM_BG: Record<CnTeam, string> = { rot: 'bg-red-500', blau: 'bg-blue-500' };

function anzahlText(a: CnAnzahl): string {
  return a === 'unbegrenzt' ? '∞' : String(a);
}

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<CnView, CnMove>) {
  const ich = mySeat === null ? null : (view.sitze[mySeat] ?? null);
  const koop = view.modus === 'koop';
  const binChefAmZug = canAct && view.phase === 'hinweis' && ich?.rolle === 'chef';
  const binAgentAmZug = canAct && view.phase === 'raten' && ich?.rolle === 'agent';

  // Geräusche aus dem Wechsel der Sicht ableiten – so klingt es auch für Züge anderer Sitze.
  const vorher = useRef<{ letzte: number | null; offen: number; phase: string } | null>(null);
  useEffect(() => {
    const offen = view.karten.filter((k) => k.aufgedeckt).length;
    const alt = vorher.current;
    vorher.current = { letzte: view.letzte, offen, phase: view.phase };
    if (!alt) return;
    if (view.phase === 'ende' && alt.phase !== 'ende') {
      const gewonnen = koop ? view.sieger !== null : ich !== null && view.sieger === ich.team;
      sfx(gewonnen ? 'win' : 'lose');
      return;
    }
    if (offen > alt.offen && view.letzte !== null) {
      const farbe = view.karten[view.letzte]?.farbe;
      sfx(farbe === 'attentaeter' ? 'explode' : farbe === 'passant' ? 'hit' : 'card');
    } else if (view.phase === 'raten' && alt.phase === 'hinweis') {
      sfx('turn');
    }
  }, [view, koop, ich, sfx]);

  const tippen = (feld: number) => {
    if (!binAgentAmZug || finished) return;
    if (view.karten[feld]?.aufgedeckt) return;
    onMove({ typ: 'tipp', feld });
  };

  const statusText = (() => {
    if (view.phase === 'ende') return view.grund;
    const team = koop ? 'Euer Chef' : `Chef von Team ${TEAM_NAME[view.amZug]}`;
    if (view.phase === 'hinweis') {
      if (binChefAmZug) return 'Du bist dran: Gib einen Hinweis aus einem Wort und einer Zahl.';
      return `${team} überlegt sich einen Hinweis …`;
    }
    if (binAgentAmZug) return 'Tippe auf den Begriff, der zum Hinweis passt – oder passe.';
    return koop
      ? 'Die Agenten beraten …'
      : `Die Agenten von Team ${TEAM_NAME[view.amZug]} beraten …`;
  })();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-2 sm:p-4" lang="de">
      <style>{`
        @keyframes cn-flip { 0% { transform: rotateY(90deg) scale(.9); } 60% { transform: rotateY(-8deg) scale(1.04); } 100% { transform: rotateY(0) scale(1); } }
        @keyframes cn-pop { 0% { transform: scale(.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>

      <Kopf view={view} />

      <div
        className={cn(
          'rounded-tile border px-3 py-2 text-sm transition-colors',
          view.phase === 'ende'
            ? 'border-line-strong bg-surface-deep text-ink'
            : koop
              ? 'border-red-500/40 bg-red-500/10 text-ink'
              : view.amZug === 'rot'
                ? 'border-red-500/40 bg-red-500/10 text-ink'
                : 'border-blue-500/40 bg-blue-500/10 text-ink',
        )}
        aria-live="polite"
      >
        {statusText}
      </div>

      {view.hinweis && view.phase === 'raten' && (
        <div
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-tile border border-line-strong bg-surface-deep px-4 py-3"
          style={{ animation: 'cn-pop 260ms ease-out' }}
        >
          <span className="text-xs uppercase tracking-wide text-ink-muted">Hinweis</span>
          <span
            className={cn(
              'text-2xl font-bold tracking-wide',
              koop ? 'text-red-300' : TEAM_TEXT[view.hinweis.team],
            )}
          >
            {view.hinweis.wort.toUpperCase()}
          </span>
          <span className="rounded-full bg-fill-strong px-3 py-0.5 text-lg font-semibold text-ink">
            {anzahlText(view.hinweis.anzahl)}
          </span>
          <span className="w-full text-center text-xs text-ink-muted sm:w-auto">
            {view.tippsUebrig === null
              ? 'Tipps: beliebig viele'
              : `noch ${view.tippsUebrig} ${view.tippsUebrig === 1 ? 'Tipp' : 'Tipps'}`}
          </span>
        </div>
      )}

      <div className="grid grid-cols-5 gap-1 sm:gap-2" style={{ perspective: '800px' }}>
        {view.karten.map((karte, i) => {
          const klickbar = binAgentAmZug && !karte.aufgedeckt && !finished;
          const letzte = view.letzte === i;
          return (
            <button
              key={i}
              type="button"
              disabled={!klickbar}
              onClick={() => tippen(i)}
              aria-label={`${karte.wort}${karte.aufgedeckt ? ` (aufgedeckt: ${farbName(karte.farbe)})` : ''}`}
              className={cn(
                'relative flex min-h-[3.25rem] items-center justify-center rounded-md border px-0.5 py-2 text-center font-semibold uppercase leading-tight shadow-sm transition-all duration-300 sm:min-h-[4.5rem] sm:rounded-tile sm:px-1',
                'text-[9px] min-[400px]:text-[10px] sm:text-xs md:text-sm',
                karte.aufgedeckt && karte.farbe
                  ? OFFEN[karte.farbe]
                  : karte.farbe && view.schluesselSichtbar
                    ? cn(SCHLUESSEL[karte.farbe], 'border-transparent text-stone-900')
                    : 'border-stone-300/60 bg-gradient-to-b from-stone-100 to-stone-300 text-stone-900',
                klickbar &&
                  'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-brand active:scale-95',
                !klickbar && !karte.aufgedeckt && 'cursor-default',
                karte.aufgedeckt && 'opacity-95',
                letzte && 'z-10 outline outline-2 outline-offset-2 outline-white',
              )}
              style={{
                hyphens: 'auto',
                wordBreak: 'break-word',
                animation: letzte && karte.aufgedeckt ? 'cn-flip 520ms ease-out' : undefined,
              }}
            >
              <span className={cn(karte.aufgedeckt && 'opacity-80')}>{karte.wort}</span>
              {karte.aufgedeckt && karte.farbe === 'attentaeter' && <Totenkopf />}
              {karte.aufgedeckt && karte.von !== null && (
                <span
                  className={cn(
                    'absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2',
                    karte.von === -1 ? 'bg-zinc-900' : 'bg-white/80',
                  )}
                  title={
                    karte.von === -1
                      ? 'von der Uhr aufgedeckt'
                      : `getippt von ${seats[karte.von]?.name ?? ''}`
                  }
                />
              )}
            </button>
          );
        })}
      </div>

      {binChefAmZug && !finished && <HinweisFormular view={view} onMove={onMove} sfx={sfx} />}

      {binAgentAmZug && !finished && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => onMove({ typ: 'passen' })}
            className="min-h-11 rounded-tile border border-line-strong bg-fill px-6 text-sm font-semibold text-ink transition-colors hover:bg-fill-strong"
          >
            {view.tippsInZug === 0 ? 'Passen (ohne Tipp)' : 'Zug beenden'}
          </button>
        </div>
      )}

      <Aufstellung view={view} seats={seats} />

      {view.hinweise.length > 0 && (
        <div className="rounded-tile border border-line bg-surface-deep p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Bisherige Hinweise</p>
          <div className="flex flex-wrap gap-1.5">
            {view.hinweise.map((h, i) => (
              <span
                key={i}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                  koop || h.team === 'rot'
                    ? 'border-red-500/40 text-red-300'
                    : 'border-blue-500/40 text-blue-300',
                )}
              >
                {h.wort} · {anzahlText(h.anzahl)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function farbName(f: CnFarbe | null): string {
  if (f === 'rot') return 'Rot';
  if (f === 'blau') return 'Blau';
  if (f === 'passant') return 'Passant';
  if (f === 'attentaeter') return 'Attentäter';
  return '';
}

function Totenkopf() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="absolute inset-x-0 bottom-0.5 mx-auto h-3 w-3 opacity-70 sm:h-4 sm:w-4"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M12 2c-4.4 0-8 3.2-8 7.5 0 2.4 1.1 4.4 3 5.8V18c0 .6.4 1 1 1h1v2h2v-2h2v2h2v-2h1c.6 0 1-.4 1-1v-2.7c1.9-1.4 3-3.4 3-5.8C20 5.2 16.4 2 12 2Zm-3 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
      />
    </svg>
  );
}

function Kopf({ view }: { view: CnView }) {
  if (view.modus === 'koop') {
    const gefunden = view.gesamt.rot - view.rest.rot;
    return (
      <div className="grid grid-cols-2 gap-2">
        <Zaehler farbe="rot" titel="Gefunden" wert={`${gefunden} / ${view.gesamt.rot}`} aktiv />
        <div className="flex flex-col items-center justify-center rounded-tile border border-line-strong bg-surface-deep px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-ink-muted">Runde</span>
          <span className="text-2xl font-bold tabular-nums text-ink">
            {Math.min(view.runde + 1, view.rundenLimit)} / {view.rundenLimit}
          </span>
          <div className="mt-1 flex gap-0.5" aria-hidden>
            {Array.from({ length: view.rundenLimit }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 w-3 rounded-full transition-colors',
                  i < view.runde ? 'bg-zinc-500' : 'bg-amber-400',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['rot', 'blau'] as const).map((team) => (
        <Zaehler
          key={team}
          farbe={team}
          titel={`Team ${TEAM_NAME[team]}${view.startTeam === team ? ' · beginnt' : ''}`}
          wert={`noch ${view.rest[team]}`}
          aktiv={view.phase !== 'ende' && view.amZug === team}
          sieger={view.sieger === team}
        />
      ))}
    </div>
  );
}

function Zaehler({
  farbe,
  titel,
  wert,
  aktiv,
  sieger,
}: {
  farbe: CnTeam;
  titel: string;
  wert: string;
  aktiv?: boolean;
  sieger?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-tile border px-3 py-2 transition-all duration-300',
        aktiv ? 'border-transparent shadow-lg' : 'border-line bg-surface-deep opacity-80',
        aktiv &&
          (farbe === 'rot'
            ? 'bg-red-600/25 ring-2 ring-red-500'
            : 'bg-blue-600/25 ring-2 ring-blue-500'),
      )}
    >
      <span
        className={cn(
          'h-8 w-8 shrink-0 rounded-full shadow-inner',
          TEAM_BG[farbe],
          aktiv && 'animate-pulse-dot',
        )}
      />
      <div className="min-w-0">
        <p className="truncate text-xs text-ink-muted">{titel}</p>
        <p className={cn('text-xl font-bold tabular-nums', TEAM_TEXT[farbe])}>
          {wert}
          {sieger && <span className="ml-1 text-base">🏆</span>}
        </p>
      </div>
    </div>
  );
}

function Aufstellung({ view, seats }: { view: CnView; seats: TurnBoardProps['seats'] }) {
  const teams: CnTeam[] = view.modus === 'koop' ? ['rot'] : ['rot', 'blau'];
  return (
    <div className={cn('grid gap-2', teams.length === 2 && 'grid-cols-2')}>
      {teams.map((team) => (
        <div key={team} className="rounded-tile border border-line bg-surface-deep p-2">
          <p
            className={cn(
              'mb-1 text-xs font-semibold uppercase tracking-wide',
              view.modus === 'koop' ? 'text-ink-muted' : TEAM_TEXT[team],
            )}
          >
            {view.modus === 'koop' ? 'Euer Team' : `Team ${TEAM_NAME[team]}`}
          </p>
          <ul className="space-y-1">
            {view.sitze.map((s, i) =>
              view.modus === 'koop' || s.team === team ? (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: seats[i]?.color ?? '#64748b' }}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      seats[i]?.isMe ? 'font-semibold text-ink' : 'text-ink-muted',
                    )}
                  >
                    {seats[i]?.name ?? `Sitz ${i + 1}`}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                      s.rolle === 'chef'
                        ? 'bg-amber-400/20 text-amber-300'
                        : 'bg-fill-strong text-ink-muted',
                    )}
                  >
                    {s.rolle === 'chef' ? 'Chef' : 'Agent'}
                  </span>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

const ANZAHLEN: CnAnzahl[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 'unbegrenzt'];

function HinweisFormular({
  view,
  onMove,
  sfx,
}: {
  view: CnView;
  onMove: (move: CnMove) => void;
  sfx: TurnBoardProps['sfx'];
}) {
  const [wort, setWort] = useState('');
  const [anzahl, setAnzahl] = useState<CnAnzahl>(1);
  const sichtbar = view.karten.filter((k) => !k.aufgedeckt).map((k) => k.wort);
  const getrimmt = wort.trim();
  const fehler = getrimmt === '' ? null : hinweisFehler(getrimmt, sichtbar);
  // Wie viele eigene Begriffe noch offen sind, hilft beim Zählen.
  const eigene = view.modus === 'koop' ? view.rest.rot : view.rest[view.amZug];

  const senden = (e: FormEvent) => {
    e.preventDefault();
    if (getrimmt === '' || fehler) {
      sfx('error');
      return;
    }
    onMove({ typ: 'hinweis', wort: getrimmt, anzahl });
    setWort('');
  };

  return (
    <form onSubmit={senden} className="rounded-tile border border-amber-400/40 bg-amber-400/5 p-3">
      <p className="mb-2 text-xs text-ink-muted">
        Ein Wort, das auf mehrere deiner Begriffe passt ({eigene} noch offen). Die Zahl sagt, wie
        viele gemeint sind – deine Agenten dürfen einmal mehr tippen.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={wort}
          onChange={(e) => setWort(e.target.value)}
          maxLength={30}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Hinweiswort"
          aria-label="Hinweiswort"
          className={cn(
            'min-h-11 flex-1 rounded-tile border bg-surface-deep px-3 text-base font-semibold uppercase tracking-wide text-ink outline-none transition-colors placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-faint focus:border-brand',
            fehler ? 'border-red-500' : 'border-line-strong',
          )}
        />
        <button
          type="submit"
          disabled={getrimmt === '' || fehler !== null}
          className="min-h-11 rounded-tile bg-amber-500 px-5 text-sm font-bold text-zinc-950 transition-opacity hover:bg-amber-400 disabled:opacity-40"
        >
          Hinweis geben
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Anzahl">
        {ANZAHLEN.map((a) => (
          <button
            key={String(a)}
            type="button"
            role="radio"
            aria-checked={anzahl === a}
            onClick={() => setAnzahl(a)}
            className={cn(
              'min-h-10 min-w-10 rounded-full border px-2 text-sm font-semibold tabular-nums transition-colors',
              anzahl === a
                ? 'border-amber-400 bg-amber-400 text-zinc-950'
                : 'border-line-strong bg-fill text-ink hover:bg-fill-strong',
            )}
            title={a === 'unbegrenzt' ? 'unbegrenzt' : undefined}
          >
            {anzahlText(a)}
          </button>
        ))}
      </div>
      {fehler && <p className="mt-2 text-xs text-red-400">{fehler}</p>}
    </form>
  );
}
