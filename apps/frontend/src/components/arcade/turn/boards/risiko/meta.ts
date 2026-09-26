import { type TurnBoardDefinition } from '../../types';
import { OptionsForm } from './OptionsForm';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Ziel: Erobere alle 42 Länder – im schnellen Spiel genügen 30.',
    '• Aufbau: Die Länder werden zufällig verteilt, danach setzt ihr reihum je eine Armee (oder lasst sie automatisch verteilen).',
    '• Verstärken: Länder geteilt durch drei (mindestens 3) plus Kontinentbonus – Nordamerika 5, Südamerika 2, Europa 5, Afrika 3, Asien 7, Australien 2.',
    '• Karten: Wer im Zug erobert, zieht eine Karte. Drei gleiche, drei verschiedene oder ein Joker mit zwei beliebigen bringen 4, 6, 8, 10, 12, 15, danach je 5 mehr. Ab fünf Karten musst du tauschen. Zeigt eine getauschte Karte ein eigenes Land, kommen dort 2 Armeen dazu.',
    '• Angreifen: Tippe ein eigenes Land mit mindestens zwei Armeen und dann ein Nachbarland. Der Angreifer würfelt mit bis zu drei, der Verteidiger mit bis zu zwei Würfeln; die höchsten Würfel werden verglichen, bei Gleichstand gewinnt der Verteidiger. Der Blitzangriff würfelt, bis das Land fällt oder die Schwelle erreicht ist.',
    '• Nach einer Eroberung ziehst du mindestens so viele Armeen nach, wie du Würfel geworfen hast.',
    '• Befestigen: Einmal pro Zug Armeen zwischen zwei eigenen, verbundenen Ländern verlegen – damit endet der Zug.',
    '• Wer ausscheidet, gibt seine Karten an den Eroberer.',
    '• Die gestrichelten Linien sind Seewege, auch Alaska und Kamtschatka sind über den Kartenrand verbunden. Mit + und − oder zwei Fingern zoomst du, danach verschiebst du die Karte mit einem Finger.',
  ].join('\n'),
  OptionsForm,
};
