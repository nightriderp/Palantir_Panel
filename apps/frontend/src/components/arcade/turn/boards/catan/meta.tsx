import { cn } from '@/components/shared/utils/cn';
import { type TurnBoardDefinition } from '../../types';

interface CatanOptions {
  layout: 'einsteiger' | 'zufall';
  targetVp: number;
  maxRounds: number;
}

function Choice<T extends string | number>({
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
  const raw = (value ?? {}) as Partial<CatanOptions>;
  const opts: CatanOptions = {
    layout: raw.layout === 'zufall' ? 'zufall' : 'einsteiger',
    targetVp: raw.targetVp === 12 ? 12 : 10,
    maxRounds: typeof raw.maxRounds === 'number' ? raw.maxRounds : 0,
  };
  const set = (patch: Partial<CatanOptions>): void => onChange({ ...opts, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <Choice
        label="Insel"
        value={opts.layout}
        options={[
          ['einsteiger', 'Einsteiger-Aufbau'],
          ['zufall', 'Zufällig'],
        ]}
        onChange={(layout) => set({ layout })}
      />
      <Choice
        label="Siegpunkte zum Sieg"
        value={opts.targetVp}
        options={[
          [10, '10'],
          [12, '12'],
        ]}
        onChange={(targetVp) => set({ targetVp })}
      />
      <Choice
        label="Rundenlimit (danach gewinnt, wer die meisten Punkte hat)"
        value={opts.maxRounds}
        options={[
          [0, 'Aus'],
          [20, '20'],
          [30, '30'],
          [50, '50'],
        ]}
        onChange={(maxRounds) => set({ maxRounds })}
      />
    </div>
  );
}

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Gründung: Reihum setzt jeder eine Siedlung mit Straße, dann in umgekehrter Reihenfolge eine zweite. Die zweite bringt sofort je einen Rohstoff der angrenzenden Felder.',
    '• Abstandsregel: Zwischen zwei Siedlungen liegt immer mindestens eine freie Kreuzung.',
    '• Zug: würfeln – alle Felder mit dieser Zahl bringen den angrenzenden Siedlungen 1, Städten 2 Rohstoffe. Danach handeln, bauen und Entwicklungskarten spielen.',
    '• Bei einer 7 wirft jeder mit mehr als 7 Karten die Hälfte ab. Wer gewürfelt hat, versetzt den Räuber (das Feld bringt nichts mehr) und zieht einem Anlieger eine Karte.',
    '• Kosten: Straße = Holz + Lehm · Siedlung = Holz + Lehm + Wolle + Getreide · Stadt = 2 Getreide + 3 Erz · Entwicklungskarte = Wolle + Getreide + Erz.',
    '• Handel: mit der Bank 4:1, an einem 3:1-Hafen 3:1, an einem Spezialhafen 2:1. Mitspielern kannst du Angebote machen – wer annimmt, mit dem darfst du tauschen.',
    '• Entwicklungskarten: Ritter, Straßenbau, Erfindung, Monopol und Siegpunkte. Höchstens eine pro Zug, nicht im Zug des Kaufs.',
    '• Längste Handelsstraße (ab 5 Straßen am Stück) und größte Rittermacht (ab 3 Rittern) bringen je 2 Siegpunkte. Fremde Siedlungen unterbrechen Straßen.',
    '• Wer in seinem Zug 10 Siegpunkte erreicht, gewinnt.',
  ].join('\n'),
  OptionsForm,
};
