'use client';

import { type OverviewTileDto } from '@palantir/contracts';
import { memo } from 'react';
import { Icon } from '../icons/Icon';
import { Badge } from '../primitives/Badge';
import { buttonClasses } from '../primitives/Button';
import { cn } from '../utils/cn';
import { serverInitials } from '../utils/format';

export interface OverviewTileProps {
  tile: OverviewTileDto;
  /**
   * Bilder des Spieltyps, vom Aufrufer aus der Spieleliste geholt – wie bei
   * der `ServerCard`. Ohne Bilder bleibt es bei den Anfangsbuchstaben.
   */
  gameIconUrl?: string | null;
  gameCoverUrl?: string | null;
  /** Anzeigename des Spiels aus dem Katalog; steht unter dem Titel, wenn die Kachel keinen eigenen trägt. */
  gameTypeName?: string | null;
  /** Bekommt die Adresse, wie sie auf der Kachel steht. */
  onCopyAddress?: (address: string) => void;
  className?: string;
}

/**
 * Kompakte Kachel der Übersicht für etwas, das **kein** Server des Panels ist
 * (Betreiber-Wunsch 26.09.2026): ein befreundeter Server auf einer fremden
 * Instanz, ein Community-Discord.
 *
 * Gebaut wie die `ServerCard`, nur ohne alles, was es dort nicht gibt: keine
 * Messwerte, kein Starten und Stoppen, kein „Verwalten". Was fehlt, steht
 * **ausgegraut** statt weggelassen – die Kachel soll neben den echten Karten
 * nicht aus der Reihe fallen, und wer sie sieht, erkennt, dass dahinter
 * nichts zu bedienen ist.
 *
 * Rein darstellend: alle Daten kommen per Props. Der Link ist ein echtes
 * `<a>` in neuem Tab – das Ziel liegt außerhalb der Anwendung, ein `<Link>`
 * von Next hätte hier nichts vorzuladen.
 */
function OverviewTileIntern({
  tile,
  gameIconUrl = null,
  gameCoverUrl = null,
  gameTypeName = null,
  onCopyAddress,
  className,
}: OverviewTileProps) {
  const untertitel = tile.subtitle ?? tile.gameLabel ?? gameTypeName;
  const spielChip = tile.gameLabel ?? gameTypeName;

  return (
    <article
      className={cn(
        'relative flex flex-col gap-3.5 overflow-hidden rounded-2xl border border-line bg-card-gradient p-4.5',
        className,
      )}
    >
      {gameCoverUrl === null ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${gameCoverUrl})` }}
        />
      )}

      <header className="relative flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-gradient font-mono text-sm font-bold text-canvas"
        >
          {gameIconUrl === null ? (
            serverInitials(tile.title)
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gameIconUrl} alt="" className="h-full w-full object-cover" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{tile.title}</h3>
          {untertitel === null ? null : <p className="text-sm text-ink-soft">{untertitel}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/*
            Statt der Statuspille: Der Zustand eines fremden Servers ist dem
            Panel unbekannt – eine graue Pille sagt genau das, eine rote
            behauptete „offline".
          */}
          <Badge tone="neutral" withDot title="Läuft nicht in diesem Panel – Zustand unbekannt.">
            Extern
          </Badge>
        </div>
      </header>

      <div className="relative flex flex-wrap items-center gap-2 text-xs">
        <span
          title="Spielerzahl wird für externe Server nicht abgefragt."
          className="flex cursor-not-allowed items-center gap-1.5 rounded-md bg-fill px-2.5 py-1.5 text-ink-disabled"
        >
          <Icon name="user" size={13} />—
        </span>
        {spielChip === null ? null : (
          <span className="rounded-md bg-fill px-2.5 py-1.5 text-ink-soft">{spielChip}</span>
        )}

        {tile.address === null ? (
          // Ausgegraut statt weggelassen, wie die nicht freigegebene Adresse
          // auf der Server-Karte.
          <span
            title="Noch keine Adresse hinterlegt."
            className="flex min-w-0 cursor-not-allowed items-center gap-1.5 rounded-md border border-line bg-fill px-2.5 py-1.5 font-mono text-ink-disabled"
          >
            <Icon name="copy" size={11} />
            <span className="truncate">keine Adresse</span>
          </span>
        ) : onCopyAddress ? (
          <button
            type="button"
            onClick={() => onCopyAddress(tile.address ?? '')}
            title="Verbindungsadresse kopieren"
            className="flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-fill px-2.5 py-1.5 font-mono text-ink-faint transition-colors hover:text-ink"
          >
            <Icon name="copy" size={11} />
            <span className="truncate">{tile.address}</span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-fill px-2.5 py-1.5 font-mono text-ink-faint">
            <Icon name="copy" size={11} />
            <span className="truncate">{tile.address}</span>
          </span>
        )}
      </div>

      {/*
        `mt-auto` statt eines leeren Abstandhalters: Der Fuß bleibt unten, wenn
        das Raster die Kachel auf die Höhe einer Server-Karte zieht – ohne den
        doppelten Zwischenraum, den ein leeres Element in der `gap`-Spalte
        mitbrächte.
      */}
      <footer className="relative mt-auto flex items-center gap-2 border-t border-line pt-3.5">
        <span
          className="flex-1 py-2.5 text-sm text-ink-disabled"
          title="Starten, Stoppen und Verwalten gibt es nur für Server dieses Panels."
        >
          Nicht im Panel verwaltet
        </span>
        {tile.linkUrl === null ? null : (
          <a
            href={tile.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses('secondary', 'md')}
          >
            {tile.linkLabel ?? 'Öffnen'}
          </a>
        )}
      </footer>
    </article>
  );
}

/** Memoisiert wie die `ServerCard`: Die Übersicht zeichnet im Sekundentakt. */
export const OverviewTile = memo(OverviewTileIntern);
