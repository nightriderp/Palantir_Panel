'use client';

import { cn } from '../utils/cn';

export interface SegmentItem<TKey extends string = string> {
  key: TKey;
  label: string;
}

export interface SegmentedControlProps<TKey extends string = string> {
  items: ReadonlyArray<SegmentItem<TKey>>;
  value: TKey;
  onChange: (key: TKey) => void;
  /** Beschriftung der Gruppe für Screenreader, z. B. „Server filtern". */
  label: string;
  className?: string;
}

/**
 * Umschalter für kurze, sich ausschließende Filter („Alle / Online / Offline").
 *
 * Für Ansichtswechsel innerhalb einer Seite gibt es stattdessen `Tabs`.
 */
export function SegmentedControl<TKey extends string = string>({
  items,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<TKey>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex gap-1 rounded-tile bg-fill p-1', className)}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.key)}
            className={cn(
              'whitespace-nowrap rounded-tile px-4 py-2 text-base font-semibold',
              active ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
