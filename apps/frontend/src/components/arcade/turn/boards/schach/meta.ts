import { type TurnBoardDefinition } from '../../types';

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Weiß beginnt. Tipp eine eigene Figur an – die möglichen Zielfelder werden markiert – und dann das Zielfeld.',
    '• Rochade: den König zwei Felder Richtung Turm ziehen. Sie ist nur erlaubt, wenn König und Turm noch nicht gezogen haben, dazwischen alles frei ist und der König weder im Schach steht noch über ein angegriffenes Feld zieht.',
    '• En passant: Zieht ein Bauer zwei Felder und landet neben einem gegnerischen Bauern, darf dieser ihn im direkt folgenden Zug schlagen, als wäre er nur ein Feld gezogen.',
    '• Erreicht ein Bauer die letzte Reihe, wählst du Dame, Turm, Läufer oder Springer.',
    '• Schachmatt gewinnt. Remis gibt es bei Patt, dreifacher Stellungswiederholung, 50 Zügen je Seite ohne Bauernzug und Schlag, zu wenig Material zum Mattsetzen oder per Einigung.',
    '• Wer am Zug ist, kann Remis anbieten oder aufgeben. Ein Angebot nimmt der Gegner an – oder lehnt es ab, indem er einfach zieht.',
  ].join('\n'),
};
