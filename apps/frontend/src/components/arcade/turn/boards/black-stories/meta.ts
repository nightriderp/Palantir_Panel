import { type TurnBoardDefinition } from '../../types';
import { OptionsForm } from './OptionsForm';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Reihum ist jemand Rätselmeister, wählt eine rabenschwarze Geschichte und kennt als Einziger die Lösung.',
    '• Alle anderen stellen Fragen, die sich mit Ja oder Nein beantworten lassen. Der Meister antwortet mit Ja, Nein, Irrelevant oder „Gute Frage!".',
    '• Wer glaubt, es zu wissen, wagt eine Lösung. Richtig gelöst gibt einen Punkt. Braucht die Runde 20 Fragen oder mehr, punktet auch der Meister – ebenso, wenn er auflösen muss.',
    '• Am selben Gerät fragt man einfach laut: Der Meister zählt die mündlichen Antworten mit und tippt an, wer gelöst hat.',
    '• Nach der letzten Runde gewinnt, wer die meisten Punkte hat. Alle Geschichten sind frei erfunden und neu geschrieben.',
  ].join('\n'),
  OptionsForm,
};
