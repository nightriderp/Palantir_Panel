import { type TurnBoardDefinition } from '../../types';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Jeder hat 15 Steine und zieht sie gegen den Uhrzeigersinn ins eigene Heimfeld (unten rechts), dann hinaus. Wer zuerst alle Steine hinausgewürfelt hat, gewinnt.',
    '• Zu Beginn würfelt jeder einen Würfel; die höhere Zahl beginnt und spielt beide Augen. Danach würfelt ihr abwechselnd mit zwei Würfeln – ein Pasch zählt viermal.',
    '• Jeder Würfel bewegt einen Stein um so viele Punkte. Auf Punkte mit zwei oder mehr gegnerischen Steinen darfst du nicht ziehen. Steht dort genau ein gegnerischer Stein, schlägst du ihn auf die Bar.',
    '• Steine auf der Bar müssen zuerst wieder ins gegnerische Heimfeld eingesetzt werden, bevor ein anderer Stein ziehen darf.',
    '• Du musst so viele Würfel nutzen wie möglich. Geht nur einer von beiden, dann der höhere. Geht gar nichts, verfällt der Wurf.',
    '• Hinauswürfeln erst, wenn alle eigenen Steine im Heimfeld stehen. Ein höherer Würfel als nötig darf nur genutzt werden, wenn weiter hinten kein Stein mehr steht.',
    '• Ohne Verdopplungswürfel. Gammon (Gegner hat noch keinen Stein draußen) und Backgammon werden im Ergebnis genannt, zählen aber als einfacher Sieg.',
    '• Bedienung: Stein antippen, dann ein leuchtendes Ziel – auch mehrere Würfel mit demselben Stein auf einmal. Mit „Zug ausführen" abschicken.',
  ].join('\n'),
};
