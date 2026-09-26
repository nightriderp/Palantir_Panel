import { cn } from '@/components/shared/utils/cn';
import { type TurnBoardDefinition } from '../../types';

interface SchiffeOptions {
  flotte: 'standard' | 'klassisch';
  nochmal: boolean;
}

function Choice<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange(v: T): void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-1 rounded-tile bg-fill p-1">
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              'min-h-[36px] flex-1 rounded-lg px-3 text-base font-semibold transition',
              value === v ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:text-ink',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function OptionsForm({
  value,
  onChange,
}: {
  value: unknown;
  onChange(value: unknown): void;
  seatCount: number;
}) {
  const raw = (value ?? {}) as Partial<SchiffeOptions>;
  const opts: SchiffeOptions = {
    flotte: raw.flotte === 'klassisch' ? 'klassisch' : 'standard',
    nochmal: raw.nochmal === true,
  };
  const set = (patch: Partial<SchiffeOptions>): void => onChange({ ...opts, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <Choice
        label="Flotte"
        value={opts.flotte}
        options={[
          ['standard', '5 Schiffe (5, 4, 3, 3, 2)'],
          ['klassisch', '10 Schiffe, ohne Berührung'],
        ]}
        onChange={(flotte) => set({ flotte })}
      />
      <Choice
        label="Nach einem Treffer"
        value={opts.nochmal}
        options={[
          [false, 'Gegner ist dran'],
          [true, 'Noch einmal schießen'],
        ]}
        onChange={(nochmal) => set({ nochmal })}
      />
    </div>
  );
}

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Beide verstecken gleichzeitig ihre Flotte auf einem 10×10-Raster: Schiff antippen, Startfeld antippen, mit „Drehen" zwischen waagrecht und senkrecht wechseln – oder „Zufällig".',
    '• Standardflotte: je ein Schiff mit 5, 4, 3, 3 und 2 Feldern; Schiffe dürfen sich berühren. Klassische Flotte: 5, 4, 4, 3, 3, 3, 2, 2, 2, 2 – ohne jede Berührung, auch nicht über Eck.',
    '• Danach schießt ihr abwechselnd auf ein Feld im gegnerischen Raster: Wasser, Treffer oder versenkt. Ein versenktes Schiff wird aufgedeckt.',
    '• Wahlweise darf nach einem Treffer noch einmal geschossen werden.',
    '• Wer zuerst die ganze gegnerische Flotte versenkt, gewinnt.',
  ].join('\n'),
  OptionsForm,
};
