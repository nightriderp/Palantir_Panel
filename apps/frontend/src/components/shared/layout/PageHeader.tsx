import { type ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Aktionen rechts neben dem Titel (auf schmalen Geräten darunter). */
  actions?: ReactNode;
  className?: string;
}

/** Einheitlicher Seitenkopf: Titel, Untertitel und Seitenaktionen. */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-4 border-b border-line px-5 py-3.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-3xl font-bold">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2.5">{actions}</div> : null}
    </div>
  );
}
