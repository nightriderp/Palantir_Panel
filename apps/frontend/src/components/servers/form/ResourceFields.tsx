'use client';

import { formatMegabytes } from '@/components/shared';
import { NumberField, SliderField } from './Fields';

/**
 * Ressourcen-Konfiguration eines Servers (Lastenheft §3.3, Pflichtenheft §10).
 *
 * Gleiche Felder im Wizard und in den Einstellungen. Die Grenzen hier sind die
 * Formatgrenzen aus `@palantir/validation`; ob die Werte vergeben werden
 * dürfen, entscheidet immer das Backend gegen Kontingent und Node-Kapazität.
 */

/** Schrittweite des RAM-Reglers – wie im Mockup. */
const RAM_STEP_MB = 256;
const RAM_MIN_MB = 512;
const RAM_MAX_MB = 32768;

const DISK_STEP_MB = 1024;
const DISK_MIN_MB = 1024;
const DISK_MAX_MB = 512000;

export interface ResourceFieldsProps {
  ramMb: number;
  cpuCores: number;
  diskMb: number;
  onChange: (values: { ramMb?: number; cpuCores?: number; diskMb?: number }) => void;
  disabled?: boolean;
  /** Warnung unter dem RAM-Regler, z. B. „Übersteigt den freien Speicher". */
  warning?: string | null;
}

export function ResourceFields({
  ramMb,
  cpuCores,
  diskMb,
  onChange,
  disabled,
  warning,
}: ResourceFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <SliderField
        label="Arbeitsspeicher"
        labelAside={formatMegabytes(ramMb)}
        min={RAM_MIN_MB}
        max={RAM_MAX_MB}
        step={RAM_STEP_MB}
        value={ramMb}
        disabled={disabled}
        error={warning ?? null}
        onChange={(value) => onChange({ ramMb: value })}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NumberField
          label="CPU-Kerne"
          hint="Halbe Kerne sind erlaubt, z. B. 1,5."
          min={0.5}
          max={64}
          step={0.5}
          value={cpuCores}
          disabled={disabled}
          onChange={(value) => onChange({ cpuCores: value })}
        />

        <SliderField
          label="Speicherplatz"
          labelAside={formatMegabytes(diskMb)}
          min={DISK_MIN_MB}
          max={DISK_MAX_MB}
          step={DISK_STEP_MB}
          value={diskMb}
          disabled={disabled}
          onChange={(value) => onChange({ diskMb: value })}
        />
      </div>
    </div>
  );
}
