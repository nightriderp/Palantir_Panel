import { type TurnBoardDefinition } from '../../types';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Gespielt wird nur auf den dunklen Feldern. Weiß beginnt und zieht nach oben.',
    '• Steine (Männer) ziehen ein Feld diagonal vorwärts. Geschlagen wird durch Überspringen eines gegnerischen Steins auf das freie Feld dahinter – vorwärts wie rückwärts.',
    '• Schlagen ist Pflicht. Ist nach einem Sprung ein weiterer möglich, geht es im selben Zug weiter, bis nichts mehr zu schlagen ist. Welche Schlagfolge du wählst, ist frei.',
    '• Erreicht ein Stein die gegnerische Grundlinie, wird er zur Dame – der Zug endet dort. Damen ziehen und schlagen beliebig weit diagonal.',
    '• Tipp einen Stein an und dann Feld für Feld den Weg. Das Endfeld eines Sprungs kannst du auch direkt antippen, wenn der Weg eindeutig ist.',
    '• Wer keinen Stein mehr hat oder nicht mehr ziehen kann, verliert. Nach 40 Zügen je Seite ohne Schlag und ohne Männerzug ist die Partie remis.',
  ].join('\n'),
};
