'use client';

import { ToggleRow } from '@/components/shared/form/Fields';
import { type KniffelOptions } from './types';

export function KniffelOptionsForm({
  value,
  onChange,
}: {
  value: KniffelOptions;
  onChange(value: KniffelOptions): void;
  seatCount: number;
}) {
  return (
    <ToggleRow
      title="Extra-Kniffel +100"
      description="Jeder weitere Kniffel bringt 100 Punkte extra – vorausgesetzt, das Kniffel-Feld steht schon mit 50 Punkten."
      checked={value?.extraKniffel === true}
      onChange={(extraKniffel) => onChange({ extraKniffel })}
    />
  );
}
