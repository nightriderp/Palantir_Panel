'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon, cn } from '@/components/shared';
import { type SfxName } from '@/lib/arcade/audio/types';
import { type TurnBoardProps } from '../../types';
import { Brett } from './Brett';
import { HandelDialog } from './Handel';
import { FeldKarte, Konten, MeineGrundstuecke } from './Konten';
import { Mitte } from './Mitte';
import { type EreignisArt, type MonopolyView, type MonopolyZug } from './types';

/** Welches Geräusch zu einem Zug passt – das wichtigste Ereignis gewinnt. */
function klangFuer(arten: EreignisArt[], gewonnen: boolean, binDran: boolean): SfxName | null {
  if (arten.includes('ende')) return gewonnen ? 'win' : 'lose';
  if (arten.includes('bankrott')) return 'explode';
  if (arten.includes('gefaengnis')) return 'hit';
  if (arten.includes('karte')) return 'card';
  if (arten.includes('kauf') || arten.includes('miete') || arten.includes('geld')) return 'coin';
  if (arten.includes('bau')) return 'place';
  if (arten.includes('handel')) return 'shuffle';
  if (arten.includes('gebot')) return 'tick';
  if (arten.includes('zug') && binDran) return 'turn';
  return null;
}

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<MonopolyView, MonopolyZug>) {
  const [auswahl, setAuswahl] = useState<number | null>(null);
  const [handelOffen, setHandelOffen] = useState(false);
  const [gross, setGross] = useState(false);
  const aktiv = canAct && !finished;
  const a = view.aktionen;

  const letzteNr = useRef(view.letztes.nr);
  useEffect(() => {
    if (view.letztes.nr === letzteNr.current) return;
    letzteNr.current = view.letztes.nr;
    const arten = view.letztes.arten;
    const gewonnen = mySeat === null || (view.sieger ?? []).includes(mySeat);
    const danach = klangFuer(arten, gewonnen, view.am === mySeat);
    if (arten.includes('wuerfel')) {
      sfx('dice');
      if (!danach) return;
      // Erst rollen die Würfel, dann klingt, was auf dem Zielfeld passiert.
      const t = window.setTimeout(() => sfx(danach), 420);
      return () => window.clearTimeout(t);
    }
    if (danach) sfx(danach);
  }, [view.letztes, view.sieger, view.am, mySeat, sfx]);

  const zug = (m: MonopolyZug) => {
    if (!aktiv) return;
    onMove(m);
  };

  // Hervorheben, was der eigene Sitz gerade mit seinen Grundstücken tun kann.
  const markiert = !aktiv
    ? []
    : view.phase === 'zahlen' || view.phase === 'kaufen'
      ? [...a.hypothek, ...a.verkaufen]
      : a.bauen;

  const waehle = (feld: number) => setAuswahl((alt) => (alt === feld ? null : feld));

  return (
    <div className="flex flex-col gap-3 p-2 sm:p-3 2xl:flex-row 2xl:items-start">
      <div className="mx-auto w-full max-w-[min(78vh,760px)] 2xl:flex-1">
        <div className={cn('rounded-xl', gross && 'max-h-[80vh] overflow-auto')}>
          <div style={{ width: gross ? '175%' : '100%', transition: 'width 250ms ease' }}>
            <Brett
              view={view}
              seats={seats}
              auswahl={auswahl}
              onWaehle={waehle}
              markiert={markiert}
              mitte={
                <Mitte
                  view={view}
                  seats={seats}
                  mySeat={mySeat}
                  canAct={canAct}
                  finished={finished}
                  onMove={zug}
                  onHandel={() => setHandelOffen(true)}
                  onWaehle={waehle}
                />
              }
            />
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-2xs text-ink-muted">
          <span>
            Bank: {view.bankHaeuser} Häuser · {view.bankHotels} Hotels
          </span>
          <button
            type="button"
            onClick={() => setGross((g) => !g)}
            className="flex min-h-[32px] items-center gap-1 rounded-md border border-line-strong bg-fill px-2 text-xs text-ink"
          >
            <Icon name="search" size={13} />
            {gross ? 'Brett verkleinern' : 'Brett vergrößern'}
          </button>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 2xl:w-80 2xl:shrink-0">
        {auswahl !== null ? (
          <FeldKarte
            view={view}
            seats={seats}
            feld={auswahl}
            aktiv={aktiv}
            onMove={zug}
            onClose={() => setAuswahl(null)}
          />
        ) : null}
        {mySeat !== null && !view.spieler[mySeat]?.bankrott ? (
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Deine Grundstücke{' '}
              {aktiv && markiert.length > 0 ? '· antippen zum Bauen/Belasten' : ''}
            </h3>
            <MeineGrundstuecke view={view} mySeat={mySeat} auswahl={auswahl} onWaehle={waehle} />
          </section>
        ) : null}
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Konten</h3>
          <Konten view={view} seats={seats} mySeat={mySeat} onWaehle={waehle} />
        </section>
      </div>

      {handelOffen && aktiv && a.handel && mySeat !== null ? (
        <HandelDialog
          view={view}
          seats={seats}
          mySeat={mySeat}
          onMove={zug}
          onClose={() => setHandelOffen(false)}
        />
      ) : null}
    </div>
  );
}
