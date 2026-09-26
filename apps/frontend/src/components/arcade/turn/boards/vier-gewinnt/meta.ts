import { type TurnBoardDefinition } from '../../types';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Abwechselnd lasst ihr einen Stein in eine der sieben Spalten fallen – er rutscht bis ganz nach unten.',
    '• Wer zuerst vier eigene Steine in einer Linie hat – waagrecht, senkrecht oder diagonal –, gewinnt.',
    '• Ist das Brett voll, ohne dass jemand vier in einer Reihe hat, endet die Partie remis.',
    '• Tipp einfach irgendwo in die gewünschte Spalte.',
  ].join('\n'),
};
