'use client';

import { type ReactNode, useState } from 'react';
import { Button } from '@/components/shared';
import { type TurnSeatInfo } from '../../types';
import { euro } from './geometrie';
import { AngebotText } from './Handel';
import { type MonopolyView, type MonopolyZug } from './types';

const AUGEN: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [26, 26],
    [50, 50],
    [74, 74],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [26, 26],
    [74, 26],
    [50, 50],
    [26, 74],
    [74, 74],
  ],
  6: [
    [28, 24],
    [72, 24],
    [28, 50],
    [72, 50],
    [28, 76],
    [72, 76],
  ],
};

function Wuerfel({ wert, rollt }: { wert: number; rollt: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="h-9 w-9 drop-shadow-lg sm:h-12 sm:w-12"
      style={rollt ? { animation: 'mono-roll 520ms cubic-bezier(.2,.9,.3,1.2)' } : undefined}
    >
      <rect
        x={4}
        y={4}
        width={92}
        height={92}
        rx={18}
        fill="#f8fafc"
        stroke="#cbd5e1"
        strokeWidth={4}
      />
      {(AUGEN[wert] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={9} fill="#0f172a" />
      ))}
    </svg>
  );
}

interface MitteProps {
  view: MonopolyView;
  seats: TurnSeatInfo[];
  mySeat: number | null;
  canAct: boolean;
  finished: boolean;
  onMove(move: MonopolyZug): void;
  onHandel(): void;
  onWaehle(feld: number): void;
}

function Gebot({ view, onMove }: { view: MonopolyView; onMove(m: MonopolyZug): void }) {
  const [betrag, setBetrag] = useState(view.mindestGebot);
  const ok = betrag >= view.mindestGebot;
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="h-9 w-9 rounded-md border border-line-strong bg-fill text-lg font-bold text-ink"
          onClick={() => setBetrag((b) => Math.max(view.mindestGebot, b - 10))}
          aria-label="10 € weniger"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={view.mindestGebot}
          step={10}
          value={betrag}
          onChange={(e) => setBetrag(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="h-9 w-20 rounded-md border border-line-strong bg-surface-deep text-center font-mono text-sm text-ink"
          aria-label="Gebot in Euro"
        />
        <button
          type="button"
          className="h-9 w-9 rounded-md border border-line-strong bg-fill text-lg font-bold text-ink"
          onClick={() => setBetrag((b) => b + 10)}
          aria-label="10 € mehr"
        >
          +
        </button>
        <button
          type="button"
          className="h-9 rounded-md border border-line-strong bg-fill px-2 text-xs font-semibold text-ink"
          onClick={() => setBetrag((b) => b + 50)}
        >
          +50
        </button>
      </div>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="primary"
          disabled={!ok}
          onClick={() => onMove({ type: 'bieten', betrag })}
        >
          Bieten
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onMove({ type: 'passen' })}>
          Aussteigen
        </Button>
      </div>
    </div>
  );
}

export function Mitte({
  view,
  seats,
  mySeat,
  canAct,
  finished,
  onMove,
  onHandel,
  onWaehle,
}: MitteProps) {
  const [bankrottFrage, setBankrottFrage] = useState(false);
  const [karteZu, setKarteZu] = useState<number | null>(null);
  const name = (seat: number | null): string =>
    seat === null ? 'die Bank' : (seats[seat]?.name ?? `Sitz ${seat + 1}`);
  const a = view.aktionen;
  const ich = mySeat !== null ? view.spieler[mySeat] : undefined;
  const aktiv = canAct && !finished;
  const karte = view.letzteKarte;
  const zeigeKarte = karte !== null && karte.zugNr === view.zugNr && karteZu !== view.letztes.nr;
  const rollt = view.letztes.arten.includes('wuerfel');
  const limit = view.optionen.rundenlimit;

  let inhalt: ReactNode = null;
  if (view.phase === 'ende') {
    inhalt = <p className="text-center text-sm font-semibold text-ink">Die Partie ist vorbei.</p>;
  } else if (!aktiv) {
    const wer =
      view.phase === 'versteigerung' && view.versteigerung
        ? `${name(view.versteigerung.dran)} überlegt ein Gebot …`
        : view.phase === 'zahlen' && view.schuld
          ? `${name(view.schuld.von)} muss Geld auftreiben …`
          : view.phase === 'handel' && view.angebot
            ? `${name(view.angebot.an)} prüft ein Handelsangebot …`
            : `${name(view.am)} ist am Zug …`;
    inhalt = <p className="text-center text-xs text-ink-muted sm:text-sm">{wer}</p>;
  } else if (view.phase === 'wuerfeln') {
    inhalt = (
      <div className="flex flex-col items-center gap-1.5">
        {ich?.gefaengnis ? (
          <p className="text-center text-xs text-warning">
            Im Gefängnis – Versuch {ich.versuche + 1} von 3
          </p>
        ) : null}
        <Button variant="primary" onClick={() => onMove({ type: 'wuerfeln' })}>
          Würfeln
        </Button>
        <div className="flex flex-wrap justify-center gap-1.5">
          {a.freikaufen ? (
            <Button size="sm" variant="secondary" onClick={() => onMove({ type: 'freikaufen' })}>
              50 € zahlen
            </Button>
          ) : null}
          {a.karteNutzen ? (
            <Button size="sm" variant="secondary" onClick={() => onMove({ type: 'karteNutzen' })}>
              Freikarte
            </Button>
          ) : null}
          {a.handel ? (
            <Button size="sm" variant="ghost" onClick={onHandel}>
              Handeln
            </Button>
          ) : null}
        </div>
      </div>
    );
  } else if (view.phase === 'kaufen' && view.kaufFeld !== null) {
    const f = view.felder[view.kaufFeld];
    inhalt = (
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          className="text-center text-sm font-semibold text-ink underline decoration-dotted"
          onClick={() => onWaehle(view.kaufFeld ?? 0)}
        >
          {f?.name} für {euro(f?.preis ?? 0)}?
        </button>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="success"
            disabled={!a.kaufen}
            onClick={() => onMove({ type: 'kaufen' })}
          >
            Kaufen
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onMove({ type: 'ablehnen' })}>
            {view.optionen.versteigerung ? 'Versteigern' : 'Ablehnen'}
          </Button>
        </div>
        {!a.kaufen ? (
          <p className="text-center text-2xs text-ink-muted">
            Zu wenig Geld – Hypothek aufnehmen oder ablehnen.
          </p>
        ) : null}
      </div>
    );
  } else if (view.phase === 'versteigerung' && view.versteigerung) {
    const v = view.versteigerung;
    inhalt = (
      <div className="flex w-full flex-col items-center gap-1">
        <p className="text-center text-xs text-ink sm:text-sm">
          Versteigerung: <strong>{view.felder[v.feld]?.name}</strong>
        </p>
        <p className="text-center text-2xs text-ink-muted sm:text-xs">
          {v.bieter === null
            ? 'Noch kein Gebot'
            : `Höchstgebot ${euro(v.gebot)} von ${name(v.bieter)}`}
        </p>
        <Gebot key={view.mindestGebot} view={view} onMove={onMove} />
      </div>
    );
  } else if (view.phase === 'zahlen' && view.schuld) {
    const s = view.schuld;
    inhalt = (
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-center text-xs text-danger sm:text-sm">
          {euro(s.betrag)} an {name(s.an)} ({s.grund})
        </p>
        <p className="text-center text-2xs text-ink-muted">
          Verkaufe Häuser oder nimm Hypotheken auf – unten bei deinen Grundstücken.
        </p>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="success"
            disabled={!a.bezahlen}
            onClick={() => onMove({ type: 'bezahlen' })}
          >
            Bezahlen
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (bankrottFrage) onMove({ type: 'aufgeben' });
              setBankrottFrage((x) => !x);
            }}
          >
            {bankrottFrage ? 'Wirklich pleite?' : 'Bankrott'}
          </Button>
        </div>
      </div>
    );
  } else if (view.phase === 'zugEnde') {
    inhalt = (
      <div className="flex flex-col items-center gap-1.5">
        {view.paschNochmal ? (
          <Button variant="primary" onClick={() => onMove({ type: 'wuerfeln' })}>
            Pasch! Nochmal würfeln
          </Button>
        ) : (
          <Button variant="primary" onClick={() => onMove({ type: 'zugEnde' })}>
            Zug beenden
          </Button>
        )}
        {a.handel ? (
          <Button size="sm" variant="ghost" onClick={onHandel}>
            Handeln
          </Button>
        ) : null}
      </div>
    );
  } else if (view.phase === 'handel' && view.angebot) {
    inhalt = (
      <div className="flex w-full flex-col items-center gap-1.5">
        <p className="text-center text-xs font-semibold text-ink">
          Angebot von {name(view.angebot.von)}
        </p>
        <AngebotText angebot={view.angebot} view={view} seats={seats} aus="empfaenger" />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="success"
            disabled={!a.handelAntwort}
            onClick={() => onMove({ type: 'handelAnnehmen' })}
          >
            Annehmen
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onMove({ type: 'handelAblehnen' })}>
            Ablehnen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 overflow-hidden p-1 sm:gap-3">
      <style>{`@keyframes mono-roll{0%{transform:rotate(-200deg) scale(.4);opacity:.2}70%{transform:rotate(12deg) scale(1.08)}100%{transform:rotate(0) scale(1);opacity:1}}
@keyframes mono-karte{0%{transform:translateY(12px) scale(.9);opacity:0}100%{transform:none;opacity:1}}`}</style>
      <p className="text-center text-2xs uppercase tracking-wide text-emerald-200/70 sm:text-xs">
        Runde {view.runde}
        {limit > 0 ? ` von ${limit}` : ''}
        {view.optionen.freiParkenTopf ? ` · Topf ${euro(view.topf)}` : ''}
      </p>
      {view.wuerfel ? (
        <div className="flex gap-2" key={rollt ? view.letztes.nr : 'ruhe'}>
          <Wuerfel wert={view.wuerfel[0]} rollt={rollt} />
          <Wuerfel wert={view.wuerfel[1]} rollt={rollt} />
        </div>
      ) : null}
      {zeigeKarte && karte ? (
        <button
          type="button"
          onClick={() => setKarteZu(view.letztes.nr)}
          className="w-full max-w-[15rem] rounded-lg border-2 px-2 py-1.5 text-left shadow-lg"
          style={{
            animation: 'mono-karte 350ms ease-out',
            borderColor: karte.stapel === 'ereignis' ? '#fb923c' : '#60a5fa',
            background: karte.stapel === 'ereignis' ? '#431407' : '#172554',
          }}
          aria-label="Karte schließen"
        >
          <span
            className="block text-2xs font-bold uppercase tracking-wide"
            style={{ color: karte.stapel === 'ereignis' ? '#fdba74' : '#93c5fd' }}
          >
            {karte.stapel === 'ereignis' ? 'Ereigniskarte' : 'Gemeinschaftskarte'}
          </span>
          <span className="block text-2xs leading-snug text-ink sm:text-xs">{karte.text}</span>
        </button>
      ) : null}
      {inhalt}
    </div>
  );
}
