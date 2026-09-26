import { type TurnBoardDefinition } from '../../types';
import { OptionsForm } from './OptionsForm';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Würfle und zieh im Uhrzeigersinn. Ein Pasch erlaubt einen weiteren Wurf, der dritte Pasch in Folge führt ins Gefängnis. Über Los gibt es 200 €.',
    '• Unbesessene Grundstücke kannst du kaufen. Lehnst du ab, wird das Grundstück versteigert (abschaltbar) – geboten wird reihum in Schritten ab 10 €.',
    '• Auf fremdem Besitz zahlst du Miete: doppelt, wenn der Besitzer die ganze Farbgruppe hat; Bahnhöfe 25–200 €, Werke 4× bzw. 10× die Augenzahl.',
    '• Mit einer vollständigen Farbgruppe baust du gleichmäßig Häuser, nach vier Häusern ein Hotel. Die Bank hat 32 Häuser und 12 Hotels.',
    '• Hypotheken bringen den halben Kaufpreis; Ablösen kostet 10 % Zinsen. Belastete Grundstücke bringen keine Miete.',
    '• Gefängnis: 50 € zahlen, Freikarte nutzen oder einen Pasch würfeln – nach drei Fehlversuchen wird die Kaution fällig.',
    '• In deinem Zug kannst du mit anderen handeln: Grundstücke, Geld und Freikarten gegeneinander.',
    '• Wer nicht zahlen kann, verkauft Häuser oder nimmt Hypotheken auf – sonst ist er pleite. Es gewinnt, wer übrig bleibt, oder beim Rundenlimit das größte Vermögen.',
  ].join('\n'),
  OptionsForm,
};
