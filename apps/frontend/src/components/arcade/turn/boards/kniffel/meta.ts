import { type TurnBoardDefinition } from '../../types';
import { KniffelOptionsForm } from './Options';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Pro Zug würfelst du bis zu dreimal mit fünf Würfeln. Tipp Würfel an, um sie zwischen den Würfen zu halten.',
    '• Danach trägst du das Ergebnis in ein freies Feld ein – notfalls mit 0 Punkten. Jedes Feld gibt es genau einmal.',
    '• Oben zählen nur die passenden Augen (Einser bis Sechser). Kommst du dort auf mindestens 63, gibt es 35 Bonuspunkte.',
    '• Dreier- und Viererpasch zählen alle Augen, Full House 25, kleine Straße (vier in Folge) 30, große Straße (fünf in Folge) 40, Kniffel (fünf gleiche) 50, Chance alle Augen.',
    '• Nach 13 Runden sind alle Felder voll. Allein spielst du auf Bestpunktzahl, sonst gewinnt die höchste Summe.',
  ].join('\n'),
  OptionsForm: KniffelOptionsForm,
};
