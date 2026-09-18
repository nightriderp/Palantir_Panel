'use client';

import { type ReactNode } from 'react';
import { Button, EmptyState, Panel, cn } from '@/components/shared';

/**
 * Gemeinsame Bausteine der Admin-Ansichten (Arbeitspaket F10).
 *
 * Bewusst klein und darstellend: Sie kapseln nur die Zustände, die in jeder
 * Admin-Ansicht gleich aussehen (fehlende Berechtigung, Laden, Fehler) und eine
 * mobil-taugliche Tabelle. Alles Fachliche bleibt in der jeweiligen Ansicht.
 * Rechte werden hier nicht berechnet – der Aufrufer reicht das Flag aus dem
 * `permissions`-Objekt herein (Pflichtenheft §5.2).
 */

/** Leerzustand, wenn dem Konto die Berechtigung für einen Bereich fehlt. */
export function AdminAccessNotice({ area }: { area: string }) {
  return (
    <EmptyState
      icon="lock"
      title="Kein Zugriff"
      description={`Für ${area} fehlt deinem Konto die Berechtigung. Wende dich an einen Administrator, wenn du sie brauchst.`}
    />
  );
}

/** Ladehinweis für eine noch nicht geladene Ansicht. */
export function AdminLoading({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-base text-ink-faint" role="status">
      {label}
    </div>
  );
}

/** Fehlerzustand mit „Nochmal versuchen". */
export function AdminError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon="warning"
      title="Konnte nicht geladen werden"
      description={message}
      action={
        <Button variant="secondary" iconLeft="restart" onClick={onRetry}>
          Nochmal versuchen
        </Button>
      }
    />
  );
}

/**
 * Tabelle, die auf schmalen Bildschirmen zu Karten wird (Mobile-First,
 * Lastenheft §4 „Mobile Nutzung"; Review 2026-09-16, Befund 12.2).
 *
 * Ab `md` (768 px) eine gewöhnliche Tabelle mit mindestens 640 px Breite und
 * waagerechtem Scrollen. Darunter wird jede Zeile ein Block mit einer Zelle je
 * Zeile, und jede Zelle trägt ihre Spaltenbeschriftung selbst (`label` an
 * {@link Td}); der Tabellenkopf bleibt nur sichtbar, wenn er Sortierknöpfe
 * trägt ({@link SortTh}) – reine Beschriftungen stünden dort doppelt.
 *
 * Bewusst über das Anzeigeverhalten der bestehenden Tabelle gelöst und nicht
 * über eine zweite Kartendarstellung je Ansicht: Die sieben Admin-Tabellen
 * behalten eine Quelle für Reihenfolge, Inhalt und Aktionen je Zeile, und
 * jsdom-Tests sehen weiter eine Tabelle. Die Umschaltung liegt in den
 * Klassen, weil `<thead>`, `<tbody>` und `<tr>` von der Ansicht kommen.
 *
 * Der Inhalt (`<thead>`/`<tbody>`) kommt von der Ansicht.
 */
export function AdminTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Panel padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table
          className={cn(
            'block w-full border-collapse text-base md:table md:min-w-[640px]',
            // Kopf: auf schmalen Bildschirmen eine Zeile aus Sortierknöpfen –
            // ohne Knöpfe ganz weg, sonst stünde dort ein leerer Streifen.
            '[&_thead]:block md:[&_thead]:table-header-group',
            '[&_thead:not(:has(button))]:hidden md:[&_thead:not(:has(button))]:table-header-group',
            '[&_thead_tr]:flex [&_thead_tr]:flex-wrap [&_thead_tr]:gap-x-3 [&_thead_tr]:border-b [&_thead_tr]:border-line [&_thead_tr]:px-3.5 [&_thead_tr]:py-2',
            'md:[&_thead_tr]:table-row md:[&_thead_tr]:border-0 md:[&_thead_tr]:p-0',
            // Rumpf: jede Zeile ein Block mit eigenem Trennstrich.
            '[&_tbody]:block md:[&_tbody]:table-row-group',
            '[&_tbody_tr]:block [&_tbody_tr]:border-b [&_tbody_tr]:border-line/60 [&_tbody_tr]:px-3.5 [&_tbody_tr]:py-2.5 [&_tbody_tr:last-child]:border-b-0',
            'md:[&_tbody_tr]:table-row md:[&_tbody_tr]:border-0 md:[&_tbody_tr]:p-0',
            className,
          )}
        >
          {children}
        </table>
      </div>
    </Panel>
  );
}

/**
 * Kopfzelle einer {@link AdminTable}.
 *
 * Auf schmalen Bildschirmen versteckt: Dort trägt jede Zelle ihre Beschriftung
 * selbst ({@link Td} `label`). Nur {@link SortTh} bleibt sichtbar (`mobil`),
 * weil der Sortierknopf sonst verloren ginge.
 */
export function Th({
  children,
  className,
  ariaSort,
  mobil = false,
}: {
  children?: ReactNode;
  className?: string;
  /** Sortierzustand dieser Spalte für Vorlesehilfen (Fundpunkt 212). */
  ariaSort?: 'ascending' | 'descending' | 'none';
  /** Auch auf schmalen Bildschirmen zeigen – für Kopfzellen mit Bedienelement. */
  mobil?: boolean;
}) {
  return (
    <th
      aria-sort={ariaSort}
      className={cn(
        'text-left text-2xs font-semibold uppercase tracking-[0.08em] text-ink-soft',
        mobil ? 'block py-0.5 md:table-cell' : 'hidden md:table-cell',
        'md:border-b md:border-line md:px-3.5 md:py-2.5',
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * Kopfzelle, die sich anklicken lässt (Fundpunkt 212).
 *
 * Der Pfeil zeigt die Richtung; `aria-sort` sagt dasselbe einer Vorlesehilfe.
 * Bewusst ein `<button>` in der Zelle und nicht ein Klick auf das `<th>`: Nur
 * so ist die Spalte auch mit der Tastatur erreichbar.
 */
export function SortTh({
  children,
  className,
  aktiv,
  richtung,
  onSort,
}: {
  children?: ReactNode;
  className?: string;
  aktiv: boolean;
  richtung: 'asc' | 'desc';
  onSort: () => void;
}) {
  return (
    <Th
      className={className}
      ariaSort={aktiv ? (richtung === 'asc' ? 'ascending' : 'descending') : 'none'}
      mobil
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-[0.08em]',
          aktiv ? 'text-ink' : 'text-ink-soft hover:text-ink-muted',
        )}
      >
        {children}
        <span aria-hidden className="text-[0.7em]">
          {aktiv ? (richtung === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </Th>
  );
}

/**
 * Blätterleiste unter einer Tabelle (Fundpunkt 212).
 *
 * Erscheint erst ab der zweiten Seite: Eine Leiste mit „Seite 1 von 1" ist
 * Platz für nichts.
 */
export function Blaetterleiste({
  seite,
  seiten,
  gesamt,
  onBlaettern,
}: {
  seite: number;
  seiten: number;
  gesamt: number;
  onBlaettern: (zu: number) => void;
}) {
  if (seiten <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
      <span className="text-xs text-ink-faint">
        Seite {seite} von {seiten} · {gesamt} Einträge
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={seite <= 1} onClick={() => onBlaettern(seite - 1)}>
          Zurück
        </Button>
        <Button size="sm" disabled={seite >= seiten} onClick={() => onBlaettern(seite + 1)}>
          Weiter
        </Button>
      </div>
    </div>
  );
}

/**
 * Datenzelle einer {@link AdminTable}.
 *
 * `label` ist die Spaltenbeschriftung für schmale Bildschirme: Dort steht sie
 * links, der Inhalt rechts. Ab `md` verschwindet sie (`display: none`, damit
 * auch aus dem Zugänglichkeitsbaum – die Kopfzeile übernimmt). Zellen ohne
 * `label` (Auswahlkästchen, Aktionen) nehmen die ganze Breite; `text-right`
 * aus `className` wirkt dort weiter.
 */
export function Td({
  children,
  className,
  title,
  label,
}: {
  children?: ReactNode;
  className?: string;
  title?: string;
  /** Spaltenbeschriftung, die auf schmalen Bildschirmen an der Zelle steht. */
  label?: string;
}) {
  return (
    <td
      title={title}
      className={cn(
        'text-ink-muted md:table-cell md:border-b md:border-line/60 md:px-3.5 md:py-2.5 md:align-middle',
        label === undefined ? 'block py-1' : 'flex items-start justify-between gap-3 py-1',
        className,
      )}
    >
      {label === undefined ? (
        children
      ) : (
        <>
          <span className="shrink-0 pt-0.5 text-2xs uppercase tracking-[0.08em] text-ink-soft md:hidden">
            {label}
          </span>
          <span className="min-w-0 break-words text-right md:contents">{children}</span>
        </>
      )}
    </td>
  );
}

/** Beschriftete Kennzahl/Angabe in einem Detailbereich. */
export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-[0.08em] text-ink-soft">{label}</span>
      <span className="text-base text-ink">{children}</span>
    </div>
  );
}
