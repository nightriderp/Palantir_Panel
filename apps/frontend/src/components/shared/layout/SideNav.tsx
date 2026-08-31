'use client';

import Link from 'next/link';
import { type ServerStatus } from '@palantir/contracts';
import { CountBadge, StatusDot } from '../primitives/Badge';
import { Icon, type IconName } from '../icons/Icon';
import { serverStatusMeta } from '../server/serverStatus';
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
/** Überschrift einer Gruppe – gleich für Einträge und Serverliste. */
function SectionHeading({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="mt-4.5 flex items-center justify-between px-2.5 pb-1">
      <span className="text-2xs uppercase tracking-[0.1em] text-ink-soft">{title}</span>
      {aside ? <span className="font-mono text-2xs text-ink-faint">{aside}</span> : null}
    </div>
  );
}

export function SideNavSection({ title, titleAside, items, className }: SideNavSectionProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {title ? <SectionHeading title={title} aside={titleAside} /> : null}

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

export interface SideNavServerItem {
  id: string;
  name: string;
  /** Kürzel für die Kachel vor dem Namen (`serverInitials`). */
  initials: string;
  status: ServerStatus;
  href: string;
  active?: boolean;
}

export interface SideNavServerSectionProps {
  /** Überschrift der Gruppe, im Mockup „Deine Server". */
  title: string;
  items: readonly SideNavServerItem[];
  /** Wird beim Anklicken eines Eintrags aufgerufen (mobile Schublade schließen). */
  onSelect?: () => void;
  className?: string;
}

/**
 * Eigene Server als Sprungziele in der Seitenleiste (Mockup „Deine Server").
 *
 * Eigene Komponente statt eines `SideNavSection`-Eintrags: die Zeile zeigt
 * Kürzel-Kachel und Zustandspunkt statt eines Symbols, und der Zustand kommt
 * aus `serverStatusMeta` – damit dieselbe Farbe und dasselbe Pulsieren gelten
 * wie auf der Server-Karte.
 *
 * Ohne Server rendert die Gruppe nichts, damit bei einem frischen Konto keine
 * leere Überschrift stehen bleibt.
 */
export function SideNavServerSection({
  title,
  items,
  onSelect,
  className,
}: SideNavServerSectionProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <SectionHeading title={title} aside={String(items.length)} />

      {items.map((item) => {
        const meta = serverStatusMeta(item.status);

        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            onClick={onSelect}
            className={cn(
              'flex items-center gap-2.5 rounded-tile px-2.5 py-2 text-base',
              item.active
                ? 'border-l-2 border-brand bg-brand-soft text-white'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <span
              aria-hidden
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm bg-brand-gradient text-3xs font-bold text-canvas"
            >
              {item.initials}
            </span>
            <span className="flex-1 truncate text-left">{item.name}</span>
            <StatusDot tone={meta.tone} pulse={meta.pulse} className="shrink-0" />
            <span className="sr-only">{meta.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
