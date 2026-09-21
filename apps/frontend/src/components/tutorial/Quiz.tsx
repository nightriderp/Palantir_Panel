'use client';

import { useState } from 'react';
import { Button, Icon, Modal, Panel, cn } from '@/components/shared';
import {
  FRAGEN_PRO_SEITE,
  KATALOG_GEBIETE,
  QUIZ_FRAGEN,
  SEITEN_GESAMT,
  frageNummer,
  seitenFragen,
} from './fragenkatalog';
import { antwortEcho, nachfrage, nachfrageFaellig, type Nachfrage } from './spott';

export interface QuizProps {
  /** Je Frage der Platz der gewählten Antwort, `null` für offen. */
  antworten: readonly (number | null)[];
  onAntwort: (frage: number, antwort: number) => void;
  /** Aufgegeben oder durch – in beiden Fällen kommt die Urkunde. */
  onFertig: () => void;
}

/**
 * Das Abschlussquiz – und der größte Scherz des ganzen Tutorials.
 *
 * Angekündigt sind **drei Fragen**, und die drei gibt es auch: Startknopf,
 * Backups, Berechtigungen. Wer sie beantwortet und auf „Auswerten" drückt,
 * bekommt aber keine Urkunde, sondern eine Seitenzahl – und dahinter liegen
 * {@link SEITEN_GESAMT} Seiten mit {@link QUIZ_FRAGEN}.length Fragen über
 * alles zwischen Ordnungszahlen und Ohrringfusionen.
 *
 * Damit das ein Scherz bleibt und keine Geiselnahme wird, gilt dreierlei:
 *
 * - **„Ich gebe auf" steht ab der Enthüllung in jeder Fußzeile.** Kein
 *   versteckter Ausgang, keine Rückfrage, kein schlechtes Gewissen.
 * - **Das Panel fragt von sich aus nach** (`nachfrageFaellig`), ob das ernst
 *   gemeint ist – bei 6, 12, 24, 45, 75 und 111 Fragen. Beide Knöpfe dort
 *   führen irgendwohin; „raus" heißt wirklich raus.
 * - **Jede beantwortete Frage zählt.** Die Urkunde nennt Note *und* Strecke,
 *   also ist Aufhören nach drei Fragen ein Ergebnis und kein Abbruch.
 *
 * Einmal gewählt ist gewählt: Nach der Antwort sind die übrigen Knöpfe
 * gesperrt. Wer zurückklicken kann, klickt sich durch, bis die Quote stimmt –
 * und dann misst die Urkunde nichts mehr.
 */
export function Quiz({ antworten, onAntwort, onFertig }: QuizProps) {
  const [seite, setSeite] = useState(1);
  /** Ab hier weiß der Nutzer, dass es nicht bei drei Fragen bleibt. */
  const [enthuellt, setEnthuellt] = useState(false);
  const [rueckfrage, setRueckfrage] = useState<Nachfrage | null>(null);

  const fragen = seitenFragen(seite);
  const gesamt = QUIZ_FRAGEN.length;
  const beantwortet = antworten.filter((wert) => wert !== null).length;
  const letzteSeite = seite >= SEITEN_GESAMT;

  const seiteOffen = fragen.some(
    (_frage, platz) => (antworten[frageNummer(seite, platz) - 1] ?? null) === null,
  );

  function beantworte(frageIndex: number, antwortIndex: number): void {
    onAntwort(frageIndex, antwortIndex);

    // Die Nachfrage hängt an der Zahl **nach** dieser Antwort.
    const neu = beantwortet + 1;
    if (nachfrageFaellig(neu)) setRueckfrage(nachfrage(neu, gesamt));
  }

  function weiter(): void {
    if (!enthuellt) {
      setEnthuellt(true);
      setSeite(2);
      return;
    }

    if (letzteSeite) {
      onFertig();
      return;
    }

    setSeite(seite + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      {enthuellt ? (
        <Fortschritt seite={seite} beantwortet={beantwortet} gesamt={gesamt} />
      ) : (
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
      )}

      {seite === 2 ? <Enthuellung gesamt={gesamt} /> : null}

      {fragen.map((frage, platz) => {
        const nummer = frageNummer(seite, platz);
        const gewaehlt = antworten[nummer - 1] ?? null;

        return (
          <Panel key={frage.key}>
            <fieldset>
              <legend className="text-md font-semibold text-ink">
                {nummer}. {frage.frage}
              </legend>
              {enthuellt ? (
                <div className="mt-1 text-2xs uppercase tracking-[0.1em] text-ink-faint">
                  {KATALOG_GEBIETE[frage.gebiet]}
                </div>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                {frage.antworten.map((antwort, platzAntwort) => {
                  const dieses = gewaehlt === platzAntwort;
                  const richtig = platzAntwort === frage.richtig;

                  return (
                    <Button
                      key={antwort}
                      variant={dieses ? (richtig ? 'success' : 'danger') : 'secondary'}
                      fullWidth
                      disabled={gewaehlt !== null && !dieses}
                      className="justify-start text-left"
                      onClick={() => beantworte(nummer - 1, platzAntwort)}
                    >
                      {antwort}
                    </Button>
                  );
                })}
              </div>
            </fieldset>

            {gewaehlt !== null ? (
              <div className="mt-3">
                <p
                  className={cn(
                    'text-base font-semibold',
                    gewaehlt === frage.richtig ? 'text-success' : 'text-caution',
                  )}
                >
                  {antwortEcho(gewaehlt === frage.richtig, nummer)}
                </p>
                <p className="mt-1 text-base text-ink-muted">{frage.echo}</p>
              </div>
            ) : null}
          </Panel>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base text-ink-faint">
          {seiteOffen
            ? enthuellt
              ? 'Erst diese Seite. Dann sehen wir weiter.'
              : 'Erst alle drei. Ja, wirklich alle drei.'
            : enthuellt
              ? `${beantwortet} von ${gesamt} beantwortet.`
              : 'Das war es. Mehr kommt nicht.'}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {enthuellt ? (
            <Button variant="ghost" onClick={onFertig}>
              Ich gebe auf
            </Button>
          ) : null}
          <Button variant="primary" iconRight="check" disabled={seiteOffen} onClick={weiter}>
            {!enthuellt ? 'Auswerten' : letzteSeite ? 'Abgeben' : 'Nächste Seite'}
          </Button>
        </div>
      </div>

      {/*
        Bewusst ein `Modal` und kein `ConfirmDialog`: Dort schließen Escape,
        Hintergrundklick und der Abbruch-Knopf über denselben Weg, und hier
        bedeuten sie Verschiedenes. Escape heißt „ich lese weiter", der linke
        Knopf heißt „ich höre auf" – das darf nicht dasselbe auslösen.
      */}
      <Modal
        open={rueckfrage !== null}
        onClose={() => setRueckfrage(null)}
        title={rueckfrage?.titel ?? ''}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRueckfrage(null);
                onFertig();
              }}
            >
              {rueckfrage?.raus ?? 'Ich höre auf'}
            </Button>
            <Button variant="primary" onClick={() => setRueckfrage(null)}>
              {rueckfrage?.weiter ?? 'Weiter'}
            </Button>
          </>
        }
      >
        <p className="text-base text-ink-muted">{rueckfrage?.text}</p>
      </Modal>
    </div>
  );
}

/**
 * Der Moment, in dem aus drei Fragen ein Prüfungsbogen wird.
 *
 * Steht nur auf Seite 2 – danach hat es jeder begriffen und die Zeile wäre nur
 * noch im Weg.
 *
 * Bewusst kurz und ohne Aufzählung der Themengebiete: Der Witz ist die Wendung
 * („drei" war die Seitenzahl, nicht die Menge), und eine Liste dahinter nimmt
 * ihr die Spitze – sie erklärt, was man gleich selbst sieht. Aus demselben
 * Grund steht hier auch nichts mehr über den Ausstieg: Der Knopf „Ich gebe
 * auf" steht zwei Zeilen tiefer in der Fußzeile und spricht für sich.
 */
function Enthuellung({ gesamt }: { gesamt: number }) {
  return (
    <Panel variant="outline" className="flex items-start gap-3 motion-safe:animate-fade-up">
      <Icon name="warning" size={18} className="mt-0.5 shrink-0 text-caution" />
      <div>
        <div className="text-md font-semibold text-ink">Drei Fragen, hatten wir gesagt.</div>
        <p className="mt-1 text-base text-ink-muted">
          Die drei sind durch – ernst gemeint, jede einzelne. Nicht ganz so ernst gemeint war das
          Wort „drei“: Sie standen auf Seite 1 von {SEITEN_GESAMT}. Es warten{' '}
          <span className="font-semibold text-ink">{gesamt} Fragen</span>, und mit Gameservern hat
          ab hier keine einzige mehr zu tun.
        </p>
      </div>
    </Panel>
  );
}

/** Seitenzahl, Fragenzahl und ein Balken, der diesmal nicht lügt. */
function Fortschritt({
  seite,
  beantwortet,
  gesamt,
}: {
  seite: number;
  beantwortet: number;
  gesamt: number;
}) {
  const prozent = gesamt > 0 ? Math.round((beantwortet / gesamt) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base text-ink-muted">
          Seite {seite} von {SEITEN_GESAMT}
          <span className="ml-2 text-xs text-ink-faint">
            Frage {Math.min(gesamt, (seite - 1) * FRAGEN_PRO_SEITE + 1)} bis{' '}
            {Math.min(gesamt, seite * FRAGEN_PRO_SEITE)}
          </span>
        </span>
        <span className="font-mono text-xs text-ink-faint">
          {beantwortet} / {gesamt}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={gesamt}
        aria-valuenow={beantwortet}
        aria-valuetext={`${beantwortet} von ${gesamt} Fragen beantwortet`}
        className="h-1.5 w-full overflow-hidden rounded-sm bg-fill"
      >
        <div
          className="h-full rounded-sm bg-brand-gradient transition-[width] duration-300 ease-out"
          style={{ width: `${prozent}%` }}
        />
      </div>
    </div>
  );
}
