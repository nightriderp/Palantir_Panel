'use client';

import { ToggleRow } from '@/components/shared/form/Fields';
import { type UnoOptions } from './types';

export function UnoOptionsForm({
  value,
  onChange,
}: {
  value: UnoOptions;
  onChange(value: UnoOptions): void;
  seatCount: number;
}) {
  const v: UnoOptions = {
    stapeln: value?.stapeln === true,
    punktspiel: value?.punktspiel === true,
  };
  return (
    <div className="flex flex-col gap-2">
      <ToggleRow
        title="+2 und +4 stapeln"
        description="Wer eine Ziehkarte abbekommt, darf sie mit einer eigenen weiterreichen. Wer nicht kann, zieht die ganze Summe."
        checked={v.stapeln}
        onChange={(stapeln) => onChange({ ...v, stapeln })}
      />
      <ToggleRow
        title="Punktspiel bis 500"
        description="Mehrere Runden: Wer ablegt, bekommt die Punkte der übrigen Hände. Wer zuerst 500 erreicht, gewinnt."
        checked={v.punktspiel}
        onChange={(punktspiel) => onChange({ ...v, punktspiel })}
      />
    </div>
  );
}
