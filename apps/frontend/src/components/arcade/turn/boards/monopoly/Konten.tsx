'use client';

import { Button, Icon, cn } from '@/components/shared';
import { type TurnSeatInfo } from '../../types';
import { euro, gruppenFarbe } from './geometrie';
import { type MonopolyView, type MonopolyZug } from './types';

function abloese(preis: number): number {
  const h = Math.floor(preis / 2);
  return h + Math.ceil(h / 10);
}

function Beschreibung({ view, feld }: { view: MonopolyView; feld: number }) {
  const f = view.felder[feld];
  if (!f) return null;
  switch (f.typ) {
    case 'los':
      return <>Wer über Los zieht oder darauf landet, kassiert 200 €.</>;
    case 'ereignis':
      return <>Zieh eine Ereigniskarte – vom Ausflug bis zum Bußgeld ist alles drin.</>;
    case 'gemeinschaft':
      return <>Zieh eine Gemeinschaftskarte – meist gibt es etwas, manchmal kostet es.</>;
    case 'steuer':
      return (
        <>
          Zahle {euro(f.steuer)} an die Bank
          {view.optionen.freiParkenTopf ? ' (landet im Frei-Parken-Topf)' : ''}.
        </>
      );
    case 'gefaengnis':
      return (
        <>
          Nur zu Besuch – oder eingesperrt: 50 € zahlen, eine Freikarte nutzen oder einen Pasch
          würfeln (drei Versuche, danach wird die Kaution fällig).
        </>
      );
    case 'parken':
      return view.optionen.freiParkenTopf ? (
        <>Wer hier landet, räumt den Topf ab: gerade {euro(view.topf)}.</>
      ) : (
        <>Eine Verschnaufpause – hier passiert nichts.</>
      );
    case 'gehGefaengnis':
      return <>Direkt ins Gefängnis, ohne über Los und ohne 200 €.</>;
    default:
      return null;
  }
}

/** Besitzkarte eines Feldes mit Mietstaffel und den möglichen Verwaltungsaktionen. */
export function FeldKarte({
  view,
  seats,
  feld,
  aktiv,
  onMove,
  onClose,
}: {
  view: MonopolyView;
  seats: TurnSeatInfo[];
  feld: number;
  aktiv: boolean;
  onMove(m: MonopolyZug): void;
  onClose(): void;
}) {
  const f = view.felder[feld];
  if (!f) return null;
  const owner = view.besitzer[feld] ?? null;
  const h = view.haeuser[feld] ?? 0;
  const a = view.aktionen;
  const gruppeKomplett =
    owner !== null &&
    f.typ === 'strasse' &&
    view.felder.every((g, i) => g.gruppe !== f.gruppe || view.besitzer[i] === owner);
  const zeilen: [string, number, boolean][] =
    f.typ === 'strasse'
      ? [
          ['Miete', f.miete[0] ?? 0, h === 0 && !gruppeKomplett],
          ['mit ganzer Gruppe', (f.miete[0] ?? 0) * 2, h === 0 && gruppeKomplett],
          ['1 Haus', f.miete[1] ?? 0, h === 1],
          ['2 Häuser', f.miete[2] ?? 0, h === 2],
          ['3 Häuser', f.miete[3] ?? 0, h === 3],
          ['4 Häuser', f.miete[4] ?? 0, h === 4],
          ['Hotel', f.miete[5] ?? 0, h === 5],
        ]
      : [];
  const bahnhoefe =
    owner !== null
      ? view.felder.filter((g, i) => g.typ === 'bahnhof' && view.besitzer[i] === owner).length
      : 0;
  const werke =
    owner !== null
      ? view.felder.filter((g, i) => g.typ === 'werk' && view.besitzer[i] === owner).length
      : 0;

  return (
    <div
      className="overflow-hidden rounded-xl border border-line-strong bg-surface"
      style={{ transition: 'all 200ms' }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: f.typ === 'strasse' ? gruppenFarbe(f.gruppe) : '#334155' }}
      >
        <h3 className="text-md font-bold text-slate-950 drop-shadow-[0_1px_0_rgba(255,255,255,.35)]">
          {f.name}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-900"
          aria-label="Schließen"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="space-y-2 p-3 text-sm">
        {f.preis > 0 ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
            <span>Preis {euro(f.preis)}</span>
            {f.hauspreis > 0 ? <span>Haus {euro(f.hauspreis)}</span> : null}
            <span>Hypothek {euro(Math.floor(f.preis / 2))}</span>
          </p>
        ) : null}
        {zeilen.length > 0 ? (
          <table className="w-full">
            <tbody>
              {zeilen.map(([label, wert, jetzt]) => (
                <tr key={label} className={cn(jetzt ? 'font-semibold text-ink' : 'text-ink-muted')}>
                  <td className="py-0.5">
                    {jetzt ? '▸ ' : ''}
                    {label}
                  </td>
                  <td className="py-0.5 text-right font-mono">{euro(wert)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {f.typ === 'bahnhof' ? (
          <table className="w-full">
            <tbody>
              {[25, 50, 100, 200].map((m, k) => (
                <tr
                  key={m}
                  className={bahnhoefe === k + 1 ? 'font-semibold text-ink' : 'text-ink-muted'}
                >
                  <td className="py-0.5">
                    {k + 1} {k === 0 ? 'Bahnhof' : 'Bahnhöfe'}
                  </td>
                  <td className="py-0.5 text-right font-mono">{euro(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {f.typ === 'werk' ? (
          <p className="text-ink-muted">
            Miete:{' '}
            <span className={werke === 1 ? 'font-semibold text-ink' : undefined}>
              4× die Augenzahl
            </span>
            , mit beiden Werken{' '}
            <span className={werke === 2 ? 'font-semibold text-ink' : undefined}>10×</span>.
          </p>
        ) : null}
        <p className="text-ink-muted">
          <Beschreibung view={view} feld={feld} />
        </p>
        {f.preis > 0 ? (
          <p className="flex items-center gap-2 text-ink">
            {owner !== null ? (
              <>
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: seats[owner]?.color }}
                />
                {seats[owner]?.name ?? `Sitz ${owner + 1}`}
                {view.hypothek[feld] ? (
                  <span className="text-danger">· mit Hypothek belastet</span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-muted">Gehört noch der Bank.</span>
            )}
          </p>
        ) : null}
        {aktiv ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {a.bauen.includes(feld) ? (
              <Button size="sm" variant="success" onClick={() => onMove({ type: 'bauen', feld })}>
                {h === 4 ? 'Hotel' : 'Haus'} bauen ({euro(f.hauspreis)})
              </Button>
            ) : null}
            {a.verkaufen.includes(feld) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onMove({ type: 'verkaufen', feld })}
              >
                {h === 5 ? 'Hotel' : 'Haus'} verkaufen (+{euro(Math.floor(f.hauspreis / 2))})
              </Button>
            ) : null}
            {a.hypothek.includes(feld) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onMove({ type: 'hypothek', feld })}
              >
                Hypothek (+{euro(Math.floor(f.preis / 2))})
              </Button>
            ) : null}
            {a.abloesen.includes(feld) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onMove({ type: 'abloesen', feld })}
              >
                Ablösen (−{euro(abloese(f.preis))})
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Kontostände aller Sitze samt ihrer Grundstücke als kleine Farbchips. */
export function Konten({
  view,
  seats,
  mySeat,
  onWaehle,
}: {
  view: MonopolyView;
  seats: TurnSeatInfo[];
  mySeat: number | null;
  onWaehle(feld: number): void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2 lg:grid-cols-1">
      {view.spieler.map((p, seat) => {
        const felder = view.felder.flatMap((_, i) => (view.besitzer[i] === seat ? [i] : []));
        const dran = seat === view.am && view.phase !== 'ende';
        return (
          <li
            key={seat}
            className={cn(
              'rounded-lg border bg-surface px-2.5 py-2 transition-colors',
              dran ? 'border-brand shadow-glow' : 'border-line-strong',
              p.bankrott && 'opacity-50',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: seats[seat]?.color }}
              />
              <span
                className={cn(
                  'truncate text-sm font-semibold text-ink',
                  p.bankrott && 'line-through',
                )}
              >
                {seats[seat]?.name ?? `Sitz ${seat + 1}`}
                {seat === mySeat ? ' (du)' : ''}
              </span>
              {p.gefaengnis ? (
                <Icon name="lock" size={13} className="text-warning" aria-label="im Gefängnis" />
              ) : null}
              {p.freiKarten > 0 ? (
                <span
                  className="flex items-center gap-0.5 rounded bg-fill px-1 text-2xs text-ink-muted"
                  title="Gefängnisfrei-Karten"
                >
                  <Icon name="key" size={11} /> {p.freiKarten}
                </span>
              ) : null}
              <span className="ml-auto font-mono text-md font-semibold text-ink">
                {euro(p.geld)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex flex-wrap gap-0.5">
                {felder.map((f) => {
                  const feld = view.felder[f];
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => onWaehle(f)}
                      title={feld?.name}
                      aria-label={feld?.name}
                      className="h-4 w-3 rounded-sm border border-black/30"
                      style={{
                        background: feld?.typ === 'strasse' ? gruppenFarbe(feld.gruppe) : '#94a3b8',
                        opacity: view.hypothek[f] ? 0.35 : 1,
                      }}
                    />
                  );
                })}
              </div>
              <span className="ml-auto whitespace-nowrap text-2xs text-ink-muted">
                Vermögen {euro(p.vermoegen)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Eigene Grundstücke als antippbare Karten – dort sitzen Bauen und Hypothek. */
export function MeineGrundstuecke({
  view,
  mySeat,
  auswahl,
  onWaehle,
}: {
  view: MonopolyView;
  mySeat: number;
  auswahl: number | null;
  onWaehle(feld: number): void;
}) {
  const felder = view.felder.flatMap((_, i) => (view.besitzer[i] === mySeat ? [i] : []));
  if (felder.length === 0)
    return <p className="text-xs text-ink-muted">Du besitzt noch keine Grundstücke.</p>;
  const a = view.aktionen;
  return (
    <div className="grid grid-cols-3 gap-1.5 min-[480px]:grid-cols-4">
      {felder.map((f) => {
        const feld = view.felder[f];
        const h = view.haeuser[f] ?? 0;
        const moeglich =
          a.bauen.includes(f) ||
          a.hypothek.includes(f) ||
          a.verkaufen.includes(f) ||
          a.abloesen.includes(f);
        return (
          <button
            key={f}
            type="button"
            onClick={() => onWaehle(f)}
            className={cn(
              'min-h-[44px] overflow-hidden rounded-md border bg-surface text-left transition-all',
              auswahl === f
                ? 'border-ink ring-2 ring-ink/40'
                : moeglich
                  ? 'border-success-line'
                  : 'border-line-strong',
              view.hypothek[f] && 'opacity-60',
            )}
          >
            <span
              className="block h-1.5"
              style={{
                background: feld?.typ === 'strasse' ? gruppenFarbe(feld.gruppe) : '#94a3b8',
              }}
            />
            <span className="block truncate px-1.5 pt-0.5 text-2xs font-semibold text-ink">
              {feld?.name}
            </span>
            <span className="block px-1.5 pb-1 text-3xs text-ink-muted">
              {view.hypothek[f]
                ? 'Hypothek'
                : h === 5
                  ? 'Hotel'
                  : h > 0
                    ? `${h} ${h === 1 ? 'Haus' : 'Häuser'}`
                    : ' '}
            </span>
          </button>
        );
      })}
    </div>
  );
}
