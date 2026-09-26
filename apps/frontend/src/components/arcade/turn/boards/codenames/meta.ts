import { type TurnBoardDefinition } from '../../types';
import { OptionsForm } from './OptionsForm';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• 25 Begriffe liegen offen. Nur die Chefs sehen, welche zu Rot, zu Blau, zu den Passanten gehören – und wo der Attentäter steckt.',
    '• Der Chef am Zug gibt einen Hinweis: ein einziges Wort und eine Zahl. Das Wort darf keinen sichtbaren Begriff enthalten und in keinem stecken.',
    '• Seine Agenten tippen Begriffe an, höchstens einen mehr als die Zahl. Ein eigener Treffer erlaubt weiterzuraten, alles andere beendet den Zug. Passen geht jederzeit.',
    '• Wer den Attentäter antippt, verliert sofort. Es gewinnt das Team, dessen Begriffe zuerst alle aufgedeckt sind.',
    '• Zu zweit oder zu dritt: gemeinsam gegen die Uhr. Ein Chef, der Rest rät, 9 Begriffe in 9 Runden. Nach jeder Runde deckt die Uhr einen gegnerischen Begriff auf.',
  ].join('\n'),
  OptionsForm,
};
