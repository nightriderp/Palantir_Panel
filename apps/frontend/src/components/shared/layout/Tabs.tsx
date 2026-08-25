'use client';

import { cn } from '../utils/cn';

export interface TabItem<TKey extends string = string> {
  key: TKey;
  label: string;
  /**
   * Reiter gesperrt – z. B. weil das `permissions`-Objekt des DTO die Ansicht
   * nicht freigibt (Pflichtenheft §5.2). Der Reiter bleibt sichtbar, ist aber
   * nicht anwählbar.
   */
  locked?: boolean;
  /** Grund der Sperre, erscheint als Tooltip („Für deine Rolle nicht freigegeben."). */
  lockedReason?: string;
}

export interface TabsProps<TKey extends string = string> {
  items: ReadonlyArray<TabItem<TKey>>;
  activeKey: TKey;
  onChange: (key: TKey) => void;
  className?: string;
}

/**
 * Reiterleiste mit Unterstrich (Server-Detail, Benachrichtigungen, Profil).
 *
 * Scrollt auf schmalen Geräten waagerecht, statt umzubrechen.
 */
export function Tabs<TKey extends string = string>({
  items,
  activeKey,
  onChange,
  className,
}: TabsProps<TKey>) {
  return (
    <div
      role="tablist"
      className={cn('flex gap-5.5 overflow-x-auto border-b border-line', className)}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.locked}
            title={item.locked ? item.lockedReason : undefined}
            onClick={() => onChange(item.key)}
            className={cn(
              'whitespace-nowrap border-b-2 px-1 py-2.5 text-base',
              active
                ? 'border-brand font-semibold text-ink'
                : 'border-transparent text-ink-muted hover:text-ink',
              item.locked &&
                'cursor-not-allowed border-transparent text-ink-disabled hover:text-ink-disabled',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
