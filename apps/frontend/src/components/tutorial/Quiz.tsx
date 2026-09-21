'use client';

import { Button, Icon, Panel, cn } from '@/components/shared';
import { QUIZ_FRAGEN } from './inhalt';

export interface QuizProps {
  /** Je Frage der Index der gewählten Antwort, `null` für offen. */
  antworten: readonly (number | null)[];
  onAntwort: (frage: number, antwort: number) => void;
  onFertig: () => void;
}

/**
 * Das Abschlussquiz – drei Fragen, eine Antwort je Frage, keine Korrektur.
 *
 * **Einmal gewählt ist gewählt.** Nach der Antwort sind die Schaltflächen
 * gesperrt und die Rückmeldung steht darunter. Wer zurückklicken und
 * ausprobieren kann, klickt sich durch, bis drei Häkchen dastehen – und dann
 * misst die Urkunde am Ende nichts mehr.
 *
 * Die Fragen sind echt: Sie prüfen die drei Dinge, die in diesem Panel
 * tatsächlich zählen (der Startknopf, die Backups, die Berechtigungen). Der
 * Spott steckt in den falschen Antworten, nicht in der Bewertung.
 */
export function Quiz({ antworten, onAntwort, onFertig }: QuizProps) {
  const offen = QUIZ_FRAGEN.some((_frage, index) => (antworten[index] ?? null) === null);

  return (
    <div className="flex flex-col gap-4">
      <Panel variant="outline" className="flex items-start gap-3">
        <Icon name="clipboard" size={18} className="mt-0.5 shrink-0 text-brand" />
        <div>
          <div className="text-md font-semibold text-ink">Abschlussprüfung</div>
          <p className="mt-1 text-base text-ink-muted">
            Drei Fragen. Keine Wiederholung, keine zweite Chance, kein Spickzettel. Das Ergebnis
            steht danach auf einer Urkunde, die du niemandem zeigen willst.
          </p>
        </div>
      </Panel>

      {QUIZ_FRAGEN.map((frage, frageIndex) => {
        const gewaehlt = antworten[frageIndex] ?? null;

        return (
          <Panel key={frage.key}>
            <fieldset>
              <legend className="text-md font-semibold text-ink">
                {frageIndex + 1}. {frage.frage}
              </legend>

              <div className="mt-3 flex flex-col gap-2">
                {frage.antworten.map((antwort, antwortIndex) => {
                  const dieses = gewaehlt === antwortIndex;

                  return (
                    <Button
                      key={antwort.text}
                      variant={dieses ? (antwort.richtig ? 'success' : 'danger') : 'secondary'}
                      fullWidth
                      // Gesperrt wird alles außer der gegebenen Antwort: Die
                      // bleibt in voller Farbe stehen, damit das Ergebnis
                      // sichtbar ist – ein gesperrter Knopf verblasst
                      // (`disabled:opacity-50`). Ein zweiter Klick darauf
                      // ändert nichts, die Antwort steht schon.
                      disabled={gewaehlt !== null && !dieses}
                      className="justify-start text-left"
                      onClick={() => onAntwort(frageIndex, antwortIndex)}
                    >
                      {antwort.text}
                    </Button>
                  );
                })}
              </div>
            </fieldset>

            {gewaehlt !== null ? (
              <p
                className={cn(
                  'mt-3 text-base',
                  frage.antworten[gewaehlt]?.richtig ? 'text-success' : 'text-caution',
                )}
              >
                {frage.antworten[gewaehlt]?.echo}
              </p>
            ) : null}
          </Panel>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-ink-faint">
          {offen ? 'Erst alle drei. Ja, wirklich alle drei.' : 'Das war es. Mehr kommt nicht.'}
        </p>
        <Button variant="primary" iconRight="check" disabled={offen} onClick={onFertig}>
          Auswerten
        </Button>
      </div>
    </div>
  );
}
