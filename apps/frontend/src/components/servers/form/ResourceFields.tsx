'use client';

import {
  SERVER_CPU_MAX_CORES,
  SERVER_CPU_MIN_CORES,
  SERVER_DISK_MAX_MB,
  SERVER_DISK_MIN_MB,
  SERVER_RAM_MAX_MB,
  SERVER_RAM_MIN_MB,
} from '@palantir/validation';
import { NumberField, SliderField, formatMegabytes } from '@/components/shared';

/**
 * Ressourcen-Konfiguration eines Servers (Lastenheft §3.3, Pflichtenheft §10).
 *
 * Gleiche Felder im Wizard und in den Einstellungen. Die Grenzen sind die
 * Formatgrenzen aus `@palantir/validation` – importiert, nicht abgeschrieben
 * (Audit-Fundstelle frontend-lib-09): Solange hier eigene, engere Zahlen
 * standen, stand ein per API angelegter Server mit 64 GB RAM am rechten
 * Anschlag, und jede Berührung des Reglers kappte den Wert beim Speichern
 * stillschweigend auf 32 GB. Ob die Werte tatsächlich vergeben werden dürfen,
 * entscheidet weiterhin das Backend gegen Kontingent und Node-Kapazität.
 *
 * Die Regler zeigen trotzdem nicht die volle Schema-Spanne: Bei 256 GB RAM
 * oder 4 TB Platte deckte ein Regler-Pixel fast ein Gigabyte ab, und die
 * üblichen 2 bis 8 GB wären auf dem Smartphone nicht mehr zu treffen. Deshalb
 * eine praktische Weite wie im Mockup, die ein größerer Bestandswert dehnt
 * (der 64-GB-Server steht dann bei 64 GB, nicht am Anschlag) und die das
 * Schema nach oben deckelt.
 */

/** Schrittweite der Regler – wie im Mockup. */
const RAM_STEP_MB = 256;
const DISK_STEP_MB = 1024;
const CPU_STEP_CORES = 0.5;

/** Praktische Reglerweite (Mockup); siehe Kopfkommentar. */
const RAM_SLIDER_MB = 32_768;
const DISK_SLIDER_MB = 512_000;

/**
 * Rechter Anschlag eines Reglers: die praktische Weite, gedehnt auf einen
 * größeren Bestandswert, gedeckelt durch das Schema.
 */
function reglerMax(praktisch: number, wert: number, schema: number): number {
  return Math.min(schema, Math.max(praktisch, wert));
}

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
        min={SERVER_RAM_MIN_MB}
        max={reglerMax(RAM_SLIDER_MB, ramMb, SERVER_RAM_MAX_MB)}
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
          min={SERVER_CPU_MIN_CORES}
          max={SERVER_CPU_MAX_CORES}
          step={CPU_STEP_CORES}
          value={cpuCores}
          disabled={disabled}
          // Ein leeres Feld meldet `null`; dann bleibt der zuletzt gültige Wert
          // im Entwurf stehen, statt ihn auf 0 zu setzen (frontend-lib-13). Das
          // Feld selbst bleibt leer, bis wieder eine Zahl darin steht.
          onChange={(value) => {
            if (value === null) return;
            onChange({ cpuCores: value });
          }}
        />

        <SliderField
          label="Speicherplatz"
          labelAside={formatMegabytes(diskMb)}
          min={SERVER_DISK_MIN_MB}
          max={reglerMax(DISK_SLIDER_MB, diskMb, SERVER_DISK_MAX_MB)}
          step={DISK_STEP_MB}
          value={diskMb}
          disabled={disabled}
          onChange={(value) => onChange({ diskMb: value })}
        />
      </div>
    </div>
  );
}
