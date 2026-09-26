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
  const on = (value as { schlagpflicht?: unknown } | null)?.schlagpflicht === true;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink-muted">Schlagpflicht</span>
      <div className="flex gap-1 rounded-tile bg-fill p-1">
        {(
          [
            [false, 'Aus'],
            [true, 'An – wer schlagen kann, muss'],
          ] as const
        ).map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange({ schlagpflicht: v })}
            className={cn(
              'min-h-[36px] flex-1 rounded-lg px-3 text-base font-semibold transition',
              on === v ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:text-ink',
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
    '• Jeder hat vier Figuren im Haus. Reihum wird gewürfelt; ziehe eine Figur so viele Felder im Uhrzeigersinn weiter. Wer zuerst alle vier im Ziel hat, gewinnt.',
    '• Mit einer 6 muss eine Figur aufs Startfeld, solange es frei ist. Nach einer 6 würfelst du noch einmal.',
    '• Solange Figuren im Haus warten, muss das eigene Startfeld zuerst geräumt werden.',
    '• Landest du auf einer fremden Figur, fliegt sie zurück ins Haus. Auf eigene Figuren darfst du nicht ziehen.',
    '• Hausregel: Im Ziel wird nicht übersprungen – alle Zielfelder bis zum Ziel müssen frei sein. Über das letzte Zielfeld hinaus geht es nicht.',
    '• Steht keine Figur auf der Laufbahn und stehen die Figuren im Ziel lückenlos ganz hinten, hast du drei Versuche für eine 6.',
    '• Gibt es nur einen möglichen Zug, führt ihn das Spiel selbst aus. Die Schlagpflicht lässt sich in den Einstellungen einschalten.',
    '• Die Partie endet, sobald die erste Farbe alle Figuren im Ziel hat.',
  ].join('\n'),
  OptionsForm,
};
