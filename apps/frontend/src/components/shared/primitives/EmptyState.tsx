import { type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../utils/cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Symbol über dem Titel; ohne Angabe bleibt der Bereich schlicht. */
  icon?: IconName;
  /** Aktion, mit der der leere Zustand aufgelöst wird (z. B. „Neuer Server"). */
  action?: ReactNode;
  className?: string;
}

/**
 * Einheitlicher Leerzustand („Noch keine Server", „Keine Treffer", …).
 *
 * Für Inhalte, die es fachlich erst in Phase 2/3 gibt, ist **nicht** diese
 * Komponente zuständig, sondern `PhaseLockedPlaceholder`.
 */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-line-strong px-5 py-12 text-center sm:py-16',
        className,
      )}
    >
      {icon ? <Icon name={icon} size={26} className="mx-auto mb-3.5 text-ink-faint" /> : null}
      <div className="text-lg font-semibold">{title}</div>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-base text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4.5 flex justify-center">{action}</div> : null}
    </div>
  );
}
