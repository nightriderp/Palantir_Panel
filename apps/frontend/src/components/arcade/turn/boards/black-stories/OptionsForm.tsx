'use client';

import { cn } from '@/components/shared';

interface BsOptions {
  runden: number | null;
}

const WAHL = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];

export function OptionsForm({
  value,
  onChange,
  seatCount,
}: {
  value: unknown;
  onChange(value: BsOptions): void;
  seatCount: number;
}) {
  const runden = (value as Partial<BsOptions> | null)?.runden ?? null;
  return (
    <div className="space-y-1.5 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Runden</p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange({ runden: null })}
          className={cn(
            'min-h-9 rounded-full border px-3 text-xs font-semibold',
            runden === null
              ? 'border-violet-400 bg-violet-500/20 text-violet-100'
              : 'border-line-strong bg-fill text-ink-muted',
          )}
        >
          Jeder einmal Meister ({seatCount})
        </button>
        {WAHL.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ runden: n })}
            className={cn(
              'min-h-9 min-w-9 rounded-full border px-2 text-xs font-semibold tabular-nums',
              runden === n
                ? 'border-violet-400 bg-violet-500/20 text-violet-100'
                : 'border-line-strong bg-fill text-ink-muted',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-faint">Der Rätselmeister wechselt reihum mit jeder Runde.</p>
    </div>
  );
}
