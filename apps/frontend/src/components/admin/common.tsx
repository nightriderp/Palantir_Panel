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
 * Tabelle mit waagerechtem Scrollen auf schmalen Bildschirmen (Mobile-First,
 * Lastenheft §4). Der Inhalt (`<thead>`/`<tbody>`) kommt von der Ansicht.
 */
export function AdminTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Panel padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className={cn('w-full min-w-[640px] border-collapse text-base', className)}>
          {children}
        </table>
      </div>
    </Panel>
  );
}

/** Kopfzelle einer {@link AdminTable}. */
export function Th({
  children,
  className,
  ariaSort,
}: {
  children?: ReactNode;
  className?: string;
  /** Sortierzustand dieser Spalte für Vorlesehilfen (Fundpunkt 212). */
  ariaSort?: 'ascending' | 'descending' | 'none';
}) {
  return (
    <th
      aria-sort={ariaSort}
      className={cn(
        'border-b border-line px-3.5 py-2.5 text-left text-2xs font-semibold uppercase tracking-[0.08em] text-ink-soft',
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

/** Datenzelle einer {@link AdminTable}. */
export function Td({
  children,
  className,
  title,
}: {
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn('border-b border-line/60 px-3.5 py-2.5 align-middle text-ink-muted', className)}
    >
      {children}
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
