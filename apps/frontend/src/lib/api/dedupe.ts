/**
 * Zwei gleichzeitige Abrufe derselben Adresse teilen sich eine Anfrage
 * (Leistungsbericht 19.09.2026, Punkt 4).
 *
 * **Warum es das braucht.** Der Rahmen holt die Serverliste für Kopf- und
 * Seitenleiste, die Übersicht holt dieselbe Liste noch einmal für sich. Beide
 * starten beim Öffnen der Seite, also geht dieselbe Anfrage zweimal über die
 * Leitung. Die zweite bringt nichts, was die erste nicht auch hätte.
 *
 * **Warum kein Zwischenspeicher.** Geteilt wird nur, was gerade unterwegs ist.
 * Sobald die Antwort da ist, ist der Eintrag weg – ein späterer Abruf holt
 * wieder frisch. Ein Zwischenspeicher mit Frist würde die Frage aufwerfen, wie
 * alt eine Liste sein darf, und das ist eine ganz andere Entscheidung als die
 * hier.
 *
 * **Abbrechen.** Jeder Aufrufer hat sein eigenes `AbortSignal`, die geteilte
 * Anfrage aber nur eines. Bricht einer ab, bekommt nur er ein abgebrochenes
 * Ergebnis; die Anfrage selbst läuft für die anderen weiter. Erst wenn alle
 * Teilnehmer abgebrochen haben, wird sie wirklich abgebrochen – sonst risse
 * ein Seitenwechsel im Rahmen der Übersicht die Daten unter den Füßen weg.
 */

interface LaufenderAbruf<T> {
  readonly steuerung: AbortController;
  readonly ergebnis: Promise<T>;
  /** Wie viele Aufrufer noch auf diese Anfrage warten. */
  teilnehmer: number;
}

const laufende = new Map<string, LaufenderAbruf<unknown>>();

/**
 * Den Abruf unter diesem Schlüssel starten – oder sich an einen laufenden
 * hängen.
 *
 * @param schluessel gleiche Zeichenkette heißt „dieselbe Anfrage"; die Adresse
 *   samt Abfrageteil eignet sich dafür.
 * @param starten bekommt das Signal der geteilten Anfrage, nicht das des
 *   einzelnen Aufrufers.
 */
export function teileAbruf<T>(
  schluessel: string,
  starten: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let eintrag = laufende.get(schluessel) as LaufenderAbruf<T> | undefined;

  if (eintrag === undefined) {
    const steuerung = new AbortController();
    const neu: LaufenderAbruf<T> = {
      steuerung,
      teilnehmer: 0,
      ergebnis: starten(steuerung.signal).finally(() => {
        // Nur den eigenen Eintrag entfernen: Inzwischen kann ein neuer Abruf
        // unter demselben Schluessel gestartet sein.
        if (laufende.get(schluessel) === (neu as LaufenderAbruf<unknown>)) {
          laufende.delete(schluessel);
        }
      }),
    };

    eintrag = neu;
    laufende.set(schluessel, neu as LaufenderAbruf<unknown>);
  }

  const dabei = eintrag;

  dabei.teilnehmer += 1;

  let abgemeldet = false;
  const abmelden = (): void => {
    if (abgemeldet) {
      return;
    }

    abgemeldet = true;
    dabei.teilnehmer -= 1;

    if (dabei.teilnehmer <= 0) {
      dabei.steuerung.abort();
    }
  };

  if (signal === undefined) {
    return dabei.ergebnis.finally(abmelden);
  }

  if (signal.aborted) {
    abmelden();

    return Promise.reject(abbruchFehler());
  }

  return new Promise<T>((aufloesen, ablehnen) => {
    const beiAbbruch = (): void => {
      abmelden();
      ablehnen(abbruchFehler());
    };

    signal.addEventListener('abort', beiAbbruch, { once: true });

    dabei.ergebnis.then(
      (wert) => {
        signal.removeEventListener('abort', beiAbbruch);
        abmelden();
        aufloesen(wert);
      },
      (fehler: unknown) => {
        signal.removeEventListener('abort', beiAbbruch);
        abmelden();
        ablehnen(fehler);
      },
    );
  });
}

/**
 * Derselbe Fehler, den `fetch` bei einem Abbruch wirft.
 *
 * Der aufrufende Code unterscheidet Abbruch von Fehlschlag am Namen
 * `AbortError`; ein eigener Fehlertyp liefe hier durch die Fehlerbehandlung
 * und zeigte dem Nutzer eine Meldung für etwas, das er selbst ausgelöst hat.
 */
function abbruchFehler(): Error {
  const fehler = new Error('Die Anfrage wurde abgebrochen.');

  fehler.name = 'AbortError';

  return fehler;
}
