'use client';

import Link from 'next/link';
import { CountBadge } from '../primitives/Badge';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../utils/cn';

export interface SideNavItem {
  key: string;
  label: string;
  icon: IconName;
  /** Ziel-Route. Fehlt sie, wird `onSelect` verwendet. */
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  /** Zähler rechts im Eintrag (z. B. ungelesene Nachrichten). */
  badgeCount?: number;
}

export interface SideNavSectionProps {
  /** Überschrift der Gruppe, z. B. „Administration". Ohne Angabe ohne Überschrift. */
  title?: string;
  /** Zusatz rechts neben der Überschrift, z. B. die Anzahl eigener Server. */
  titleAside?: string;
  items: readonly SideNavItem[];
  className?: string;
}

/**
 * Gruppe von Navigationseinträgen in der Seitenleiste.
 *
 * Welche Einträge überhaupt übergeben werden, entscheidet das aufrufende Paket
 * anhand der Berechtigungen aus dem DTO – die Navigation filtert nicht selbst.
 */
export function SideNavSection({ title, titleAside, items, className }: SideNavSectionProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {title ? (
        <div className="mt-4.5 flex items-center justify-between px-2.5 pb-1">
          <span className="text-2xs uppercase tracking-[0.1em] text-ink-soft">{title}</span>
          {titleAside ? (
            <span className="font-mono text-2xs text-ink-faint">{titleAside}</span>
          ) : null}
        </div>
      ) : null}

      {items.map((item) => {
        const itemClassName = cn(
          'flex items-center gap-2.5 rounded-tile px-2.5 py-2.5 text-base',
          item.active
            ? 'border-l-2 border-brand bg-brand-soft text-white'
            : 'text-ink-muted hover:text-ink',
        );
        const content = (
          <>
            <Icon name={item.icon} size={16} />
            <span className="flex-1 truncate text-left">{item.label}</span>
            {item.badgeCount ? <CountBadge count={item.badgeCount} /> : null}
          </>
        );

        return item.href ? (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            onClick={item.onSelect}
            className={itemClassName}
          >
            {content}
          </Link>
        ) : (
          <button key={item.key} type="button" onClick={item.onSelect} className={itemClassName}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
