'use client';

import { useState } from 'react';
import { Button, cn } from '@/components/shared';
import { type TurnSeatInfo } from '../../types';
import { euro, gruppenFarbe } from './geometrie';
import { type Angebot, type MonopolyView, type MonopolyZug } from './types';

function teil(view: MonopolyView, felder: number[], geld: number, karten: number): string {
  const stuecke = felder.map((f) => view.felder[f]?.name ?? `Feld ${f}`);
  if (geld > 0) stuecke.push(euro(geld));
  if (karten > 0) stuecke.push(karten === 1 ? 'eine Freikarte' : `${karten} Freikarten`);
  return stuecke.length > 0 ? stuecke.join(', ') : 'nichts';
}

/** Angebot in zwei Zeilen – aus Sicht des Empfängers („Du bekommst …"). */
export function AngebotText({
  angebot,
  view,
  seats,
  aus,
}: {
  angebot: Angebot;
  view: MonopolyView;
  seats: TurnSeatInfo[];
  aus: 'empfaenger' | 'neutral';
}) {
  const von = seats[angebot.von]?.name ?? 'Anbieter';
  const an = seats[angebot.an]?.name ?? 'Empfänger';
  const bekommt = teil(view, angebot.gebeFelder, angebot.gebeGeld, angebot.gebeKarten);
  const gibt = teil(view, angebot.nehmeFelder, angebot.nehmeGeld, angebot.nehmeKarten);
  return (
    <div className="w-full max-w-[16rem] rounded-md bg-black/30 px-2 py-1 text-2xs leading-snug text-ink sm:text-xs">
      <p>
        <span className="text-success">
          {aus === 'empfaenger' ? 'Du bekommst' : `${an} bekommt`}:
        </span>{' '}
        {bekommt}
      </p>
      <p>
        <span className="text-danger">{aus === 'empfaenger' ? 'Du gibst' : `${von} bekommt`}:</span>{' '}
        {gibt}
      </p>
    </div>
  );
}

/** Grundstücke eines Sitzes, die sich handeln lassen (keine Häuser in der Gruppe). */
function handelbar(view: MonopolyView, seat: number): number[] {
  return view.felder.flatMap((f, i) => {
    if (view.besitzer[i] !== seat) return [];
    const gruppe = view.felder.flatMap((g, k) =>
      g.gruppe === f.gruppe && f.gruppe >= 0 && f.gruppe < 8 ? [k] : [],
    );
    return gruppe.some((k) => (view.haeuser[k] ?? 0) > 0) ? [] : [i];
  });
}

function FeldAuswahl({
  view,
  felder,
  gewaehlt,
  onToggle,
}: {
  view: MonopolyView;
  felder: number[];
  gewaehlt: number[];
  onToggle(f: number): void;
}) {
  if (felder.length === 0)
    return <p className="text-xs text-ink-muted">Keine handelbaren Grundstücke.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {felder.map((f) => {
        const feld = view.felder[f];
        const an = gewaehlt.includes(f);
        return (
          <button
            key={f}
            type="button"
            onClick={() => onToggle(f)}
            className={cn(
              'flex min-h-[36px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
              an
                ? 'border-brand bg-brand-soft text-ink'
                : 'border-line-strong bg-fill text-ink-muted',
            )}
          >
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{
                background: feld?.typ === 'strasse' ? gruppenFarbe(feld.gruppe) : '#94a3b8',
              }}
            />
            {feld?.name}
            {view.hypothek[f] ? <span className="text-danger">(H)</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Zahl({
  label,
  wert,
  max,
  schritt,
  onChange,
}: {
  label: string;
  wert: number;
  max: number;
  schritt: number;
  onChange(v: number): void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-ink-muted">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={schritt}
        value={wert}
        onChange={(e) =>
          onChange(Math.min(max, Math.max(0, Math.floor(Number(e.target.value) || 0))))
        }
        className="h-9 w-24 rounded-md border border-line-strong bg-surface-deep px-2 text-right font-mono text-sm text-ink"
      />
    </label>
  );
}

export function HandelDialog({
  view,
  seats,
  mySeat,
  onMove,
  onClose,
}: {
  view: MonopolyView;
  seats: TurnSeatInfo[];
  mySeat: number;
  onMove(m: MonopolyZug): void;
  onClose(): void;
}) {
  const partnerListe = view.spieler.flatMap((p, i) => (i !== mySeat && !p.bankrott ? [i] : []));
  const [an, setAn] = useState(partnerListe[0] ?? 0);
  const [gebe, setGebe] = useState<number[]>([]);
  const [nehme, setNehme] = useState<number[]>([]);
  const [gebeGeld, setGebeGeld] = useState(0);
  const [nehmeGeld, setNehmeGeld] = useState(0);
  const [gebeKarten, setGebeKarten] = useState(0);
  const [nehmeKarten, setNehmeKarten] = useState(0);
  const ich = view.spieler[mySeat];
  const er = view.spieler[an];
  const toggle = (liste: number[], setze: (l: number[]) => void, f: number) =>
    setze(liste.includes(f) ? liste.filter((x) => x !== f) : [...liste, f]);
  const leer =
    gebe.length + nehme.length === 0 && gebeGeld + nehmeGeld + gebeKarten + nehmeKarten === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Handel"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line-strong bg-surface p-4 shadow-2xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-xl font-semibold text-ink">Handel vorschlagen</h2>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {partnerListe.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setAn(p);
                setNehme([]);
                setNehmeGeld(0);
                setNehmeKarten(0);
              }}
              className={cn(
                'flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                p === an
                  ? 'border-brand bg-brand-soft text-ink'
                  : 'border-line-strong bg-fill text-ink-muted',
              )}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: seats[p]?.color }} />
              {seats[p]?.name ?? `Sitz ${p + 1}`}
            </button>
          ))}
        </div>

        <section className="mb-3 space-y-2 rounded-lg bg-fill p-3">
          <h3 className="text-sm font-semibold text-ink">Du gibst</h3>
          <FeldAuswahl
            view={view}
            felder={handelbar(view, mySeat)}
            gewaehlt={gebe}
            onToggle={(f) => toggle(gebe, setGebe, f)}
          />
          <Zahl
            label={`Geld (du hast ${euro(ich?.geld ?? 0)})`}
            wert={gebeGeld}
            max={ich?.geld ?? 0}
            schritt={10}
            onChange={setGebeGeld}
          />
          {(ich?.freiKarten ?? 0) > 0 ? (
            <Zahl
              label="Gefängnisfrei-Karten"
              wert={gebeKarten}
              max={ich?.freiKarten ?? 0}
              schritt={1}
              onChange={setGebeKarten}
            />
          ) : null}
        </section>

        <section className="mb-4 space-y-2 rounded-lg bg-fill p-3">
          <h3 className="text-sm font-semibold text-ink">Du bekommst</h3>
          <FeldAuswahl
            view={view}
            felder={handelbar(view, an)}
            gewaehlt={nehme}
            onToggle={(f) => toggle(nehme, setNehme, f)}
          />
          <Zahl
            label={`Geld (hat ${euro(er?.geld ?? 0)})`}
            wert={nehmeGeld}
            max={er?.geld ?? 0}
            schritt={10}
            onChange={setNehmeGeld}
          />
          {(er?.freiKarten ?? 0) > 0 ? (
            <Zahl
              label="Gefängnisfrei-Karten"
              wert={nehmeKarten}
              max={er?.freiKarten ?? 0}
              schritt={1}
              onChange={setNehmeKarten}
            />
          ) : null}
        </section>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={leer}
            onClick={() => {
              onMove({
                type: 'handel',
                an,
                gebeFelder: gebe,
                nehmeFelder: nehme,
                gebeGeld,
                nehmeGeld,
                gebeKarten,
                nehmeKarten,
              });
              onClose();
            }}
          >
            Angebot senden
          </Button>
        </div>
      </div>
    </div>
  );
}
