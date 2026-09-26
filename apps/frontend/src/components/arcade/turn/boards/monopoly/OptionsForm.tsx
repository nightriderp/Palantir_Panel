'use client';

import { cn } from '@/components/shared';
import { type MonopolyOptionen } from './types';

const VORGABE: MonopolyOptionen = {
  startgeld: 1500,
  versteigerung: true,
  freiParkenTopf: false,
  rundenlimit: 30,
};

function Wahl<T extends number | boolean>({
  label,
  hinweis,
  wert,
  optionen,
  onChange,
}: {
  label: string;
  hinweis?: string;
  wert: T;
  optionen: { wert: T; text: string }[];
  onChange(v: T): void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {optionen.map((o) => (
          <button
            key={String(o.wert)}
            type="button"
            role="radio"
            aria-checked={o.wert === wert}
            onClick={() => onChange(o.wert)}
            className={cn(
              'min-h-[36px] rounded-md border px-3 py-1 text-sm transition-colors',
              o.wert === wert
                ? 'border-brand bg-brand-soft text-ink'
                : 'border-line-strong bg-fill text-ink-muted',
            )}
          >
            {o.text}
          </button>
        ))}
      </div>
      {hinweis ? <p className="text-xs text-ink-muted">{hinweis}</p> : null}
    </div>
  );
}

/** Einstellungen vor Spielbeginn: Startgeld, Versteigerung, Topf, Rundenlimit. */
export function OptionsForm({
  value,
  onChange,
}: {
  value: Partial<MonopolyOptionen> | null | undefined;
  onChange(value: MonopolyOptionen): void;
  seatCount: number;
}) {
  const o: MonopolyOptionen = { ...VORGABE, ...(value ?? {}) };
  const setze = (teil: Partial<MonopolyOptionen>) => onChange({ ...o, ...teil });
  return (
    <div className="space-y-3">
      <Wahl
        label="Startgeld"
        wert={o.startgeld}
        optionen={[1000, 1500, 2000, 2500].map((w) => ({
          wert: w,
          text: `${w.toLocaleString('de-DE')} €`,
        }))}
        onChange={(startgeld) => setze({ startgeld })}
      />
      <Wahl
        label="Rundenlimit"
        hinweis="Nach so vielen Runden gewinnt das größte Vermögen."
        wert={o.rundenlimit}
        optionen={[
          { wert: 0, text: 'Aus' },
          { wert: 20, text: '20' },
          { wert: 30, text: '30' },
          { wert: 50, text: '50' },
        ]}
        onChange={(rundenlimit) => setze({ rundenlimit })}
      />
      <Wahl
        label="Versteigerung"
        hinweis="Lehnt jemand ein Grundstück ab, wird es reihum versteigert."
        wert={o.versteigerung}
        optionen={[
          { wert: true, text: 'An' },
          { wert: false, text: 'Aus' },
        ]}
        onChange={(versteigerung) => setze({ versteigerung })}
      />
      <Wahl
        label="Frei-Parken-Topf"
        hinweis="Steuern und Strafen sammeln sich im Topf – wer auf Frei Parken landet, räumt ab."
        wert={o.freiParkenTopf}
        optionen={[
          { wert: false, text: 'Aus' },
          { wert: true, text: 'An' },
        ]}
        onChange={(freiParkenTopf) => setze({ freiParkenTopf })}
      />
    </div>
  );
}
