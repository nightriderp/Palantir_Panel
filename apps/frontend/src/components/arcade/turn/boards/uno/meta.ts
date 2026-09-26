import { type TurnBoardDefinition } from '../../types';
import { UnoOptionsForm } from './Options';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Leg eine Karte, die in Farbe, Zahl oder Symbol zur obersten Karte der Ablage passt.',
    '• Aussetzen überspringt den nächsten Sitz, Richtungswechsel dreht die Reihenfolge (zu zweit wirkt er wie Aussetzen), +2 lässt den nächsten Sitz zwei Karten ziehen und aussetzen.',
    '• Farbwahl passt immer und legt die neue Farbe fest; +4 ebenso, dazu zieht der nächste Sitz vier Karten und setzt aus.',
    '• Passt nichts, ziehst du eine Karte. Passt sie, darfst du sie sofort legen – sonst ist der Nächste dran.',
    '• Drück „UNO!", bevor du deine vorletzte Karte legst. Vergisst du es, kann dich jeder andere bis zum nächsten Zug erwischen: zwei Strafkarten.',
    '• Wer zuerst keine Karten mehr hat, gewinnt die Runde. Im Punktspiel zählen die Resthände der anderen: Zahlen nach Wert, Aktionskarten 20, schwarze Karten 50.',
  ].join('\n'),
  OptionsForm: UnoOptionsForm,
};
