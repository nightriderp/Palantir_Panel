'use client';

import { useId, type ReactNode } from 'react';
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
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'border-b border-line px-3.5 py-2.5 text-left text-2xs font-semibold uppercase tracking-[0.08em] text-ink-soft',
        className,
      )}
    >
      {children}
    </th>
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

/**
 * Datumsfeld für Filter (z. B. Audit-Log-Zeitraum).
 *
 * Das Design-System hat bewusst kein Datumsfeld – die einzige Stelle dafür ist
 * bislang der Admin-Bereich. Optik über dieselben Tokens wie die übrigen
 * Eingabefelder; sobald ein zweites Paket eines braucht, gehört es nach F2
 * (vermerkt unter „Gefundene Punkte" in WORK_STATUS.md).
 */
export function DateField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-line-strong bg-fill px-3 py-2.5 text-base text-ink outline-none focus-visible:border-brand"
      />
    </div>
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
