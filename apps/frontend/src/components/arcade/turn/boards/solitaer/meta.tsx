'use client';

import { cn } from '@/components/shared';
import { type TurnBoardDefinition } from '../../types';

function OptionsForm({
  value,
  onChange,
}: {
  value: { draw?: 1 | 3 };
  onChange(value: { draw: 1 | 3 }): void;
}) {
  const draw = value.draw === 3 ? 3 : 1;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm text-ink-muted">Karten je Ziehen</legend>
      <div className="flex gap-2">
        {([1, 3] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ draw: n })}
            className={cn(
              'min-h-[44px] flex-1 rounded-tile border px-3 text-md transition-colors',
              draw === n
                ? 'border-brand bg-brand-soft text-ink'
                : 'border-line-strong bg-fill text-ink-muted hover:text-ink',
            )}
          >
            {n === 1 ? 'Eine Karte (leichter)' : 'Drei Karten (knifflig)'}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Ziel: alle Karten nach Farben von Ass bis König auf die vier Ablagen oben rechts bringen.',
    '• Im Tableau legst du absteigend und immer abwechselnd Rot auf Schwarz. Auf eine leere Reihe darf nur ein König.',
    '• Tippe eine offene Karte an und dann das Ziel – mögliche Ziele leuchten grün. Nochmal auf dieselbe Karte tippen schickt sie auf die Ablage.',
    '• Tipp auf den Stapel zieht neue Karten; ist er leer, wird der Talon wieder umgedreht (kostet Punkte).',
    '• Punkte: Ablage +10, vom Talon ins Tableau +5, Karte aufdecken +5, von der Ablage zurück −15. Wer schnell löst, bekommt einen Bonus für wenige Züge.',
  ].join('\n'),
  OptionsForm,
};
