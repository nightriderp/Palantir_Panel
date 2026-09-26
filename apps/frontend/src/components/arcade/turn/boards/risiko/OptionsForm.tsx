'use client';

import { SelectField, ToggleRow } from '@/components/shared';
import { type RisikoOptions } from './types';

const ROUND_LIMITS = [0, 10, 15, 20, 30, 50];

/** Fehlende Felder mit den Vorgaben der Regeln auffüllen – der Wirt reicht auch `{}` herein. */
function withDefaults(value: unknown): RisikoOptions {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<RisikoOptions>;
  return {
    autoPlace: v.autoPlace === true,
    quick: v.quick === true,
    roundLimit: typeof v.roundLimit === 'number' ? v.roundLimit : 0,
  };
}

export function OptionsForm({
  value,
  onChange,
}: {
  value: unknown;
  onChange(value: RisikoOptions): void;
  seatCount: number;
}) {
  const options = withDefaults(value);
  const limits = ROUND_LIMITS.includes(options.roundLimit)
    ? ROUND_LIMITS
    : [...ROUND_LIMITS, options.roundLimit].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        title="Startarmeen automatisch verteilen"
        description="Überspringt das reihum Setzen am Anfang – die Armeen landen zufällig auf den Grenzländern."
        checked={options.autoPlace}
        onChange={(autoPlace) => onChange({ ...options, autoPlace })}
      />
      <ToggleRow
        title="Schnelles Spiel"
        description="Wer 70 % der Länder (30 von 42) hält, gewinnt sofort."
        checked={options.quick}
        onChange={(quick) => onChange({ ...options, quick })}
      />
      <SelectField
        label="Rundenlimit"
        hint="Nach dieser Runde gewinnt, wer die meisten Länder hält."
        value={String(options.roundLimit)}
        onChange={(raw) => onChange({ ...options, roundLimit: Number(raw) })}
        options={limits.map((n) => ({ value: String(n), label: n === 0 ? 'Aus' : `${n} Runden` }))}
      />
    </div>
  );
}
