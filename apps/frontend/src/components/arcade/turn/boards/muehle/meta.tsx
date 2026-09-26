import { cn } from '@/components/shared/utils/cn';
import { type TurnBoardDefinition } from '../../types';

function OptionsForm({
  value,
  onChange,
}: {
  value: unknown;
  onChange(value: unknown): void;
  seatCount: number;
}) {
  const springen = (value as { springen?: unknown } | null)?.springen !== false;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink-muted">Springen mit drei Steinen</span>
      <div className="flex gap-1 rounded-tile bg-fill p-1">
        {(
          [
            [true, 'Erlaubt'],
            [false, 'Nicht erlaubt'],
          ] as const
        ).map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange({ springen: v })}
            className={cn(
              'min-h-[36px] flex-1 rounded-lg px-3 text-base font-semibold transition',
              springen === v ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:text-ink',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Jeder hat neun Steine. Erst setzt ihr abwechselnd je einen Stein auf einen freien Punkt, danach zieht ihr sie entlang der Linien auf einen freien Nachbarpunkt.',
    '• Drei eigene Steine in einer Linie sind eine Mühle. Wer eine Mühle schließt, nimmt dem Gegner einen Stein – aber keinen aus einer Mühle, außer alle seine Steine stehen in Mühlen.',
    '• Wer nur noch drei Steine hat, darf springen: auf jeden freien Punkt (abschaltbar in den Einstellungen).',
    '• Verloren hat, wer weniger als drei Steine hat oder nicht mehr ziehen kann.',
    '• Remis bei dreifacher Stellungswiederholung oder nach fünfzig Zügen je Seite ohne Schlagen.',
    '• Bedienung: Stein antippen, dann ein markiertes Feld. Schließt der Zug eine Mühle, blinken die Steine, die du nehmen darfst.',
  ].join('\n'),
  OptionsForm,
};
