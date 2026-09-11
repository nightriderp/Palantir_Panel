/**
 * Passphrase abfragen, ohne sie auf den Bildschirm zu schreiben (Fundpunkt 241).
 *
 * Gebraucht von den beiden Wartungskommandos rund um die Verschlüsselung der
 * Panel-Sicherungen. Bewusst **nicht** über eine Umgebungsvariable als
 * Hauptweg: Die stünde in der Prozessumgebung und in der Shell-Geschichte – für
 * eine Passphrase, die den einzigen Weg zurück in die Sicherungen schützt, der
 * falsche Ort. Für Abläufe ohne Terminal gibt es sie trotzdem, aber als
 * ausdrücklich benannte Ausnahme.
 *
 * Die Zeichenverarbeitung steht als reine Funktion daneben: Im Rohmodus liefert
 * das Terminal nicht ein Zeichen pro Ereignis, sondern das, was gerade anfällt –
 * beim Einfügen aus einem Passwortspeicher der ganze Text samt Zeilenende in
 * einem Stück. Genau daran geht eine Zeichen-für-Zeichen-Annahme kaputt, und
 * genau das lässt sich hier ohne Terminal prüfen.
 */

/** Stand der Eingabe zwischen zwei Ereignissen des Terminals. */
export interface Eingabestand {
  readonly wert: string;
  /** Eingabe mit Zeilenende abgeschlossen. */
  readonly fertig: boolean;
  /** Strg+C – der Aufrufer bricht ab, ohne etwas zu schreiben. */
  readonly abgebrochen: boolean;
}

export const LEERE_EINGABE: Eingabestand = { wert: '', fertig: false, abgebrochen: false };

/** Zeilenende und Dateiende (Strg+D) schließen die Eingabe ab. */
const ENDE = new Set(['\n', '\r', '\u0004']);

/** Rücktaste; Terminals schicken je nach Einstellung das eine oder das andere. */
const RUECKTASTE = new Set(['\u007f', '\b']);

/** Strg+C. */
const ABBRUCH = '\u0003';

/**
 * Ein Stück Terminaleingabe verarbeiten.
 *
 * Alles nach dem Zeilenende wird verworfen: Was jemand hinterher tippt, gehört
 * zur nächsten Frage und nicht mehr in diese Antwort.
 */
export function verarbeiteEingabe(stand: Eingabestand, stueck: string): Eingabestand {
  // Ein abgeschlossener Stand bleibt, wie er ist: Der Aufrufer hat den Zuhörer
  // längst abgehängt, und hier soll dasselbe gelten.
  if (stand.fertig || stand.abgebrochen) {
    return stand;
  }

  let wert = stand.wert;

  for (const zeichen of stueck) {
    if (zeichen === ABBRUCH) {
      return { wert: '', fertig: false, abgebrochen: true };
    }

    if (ENDE.has(zeichen)) {
      return { wert, fertig: true, abgebrochen: false };
    }

    if (RUECKTASTE.has(zeichen)) {
      wert = wert.slice(0, -1);

      continue;
    }

    // Steuerzeichen (Pfeiltasten, Tabulator) gehören nicht in eine Passphrase.
    if (zeichen >= ' ') {
      wert += zeichen;
    }
  }

  return { wert, fertig: false, abgebrochen: false };
}

/**
 * Nach einer Passphrase fragen; die Eingabe bleibt unsichtbar.
 *
 * Ohne Terminal (Cronjob, Pipe) gibt es nichts zu fragen – dann zählt
 * `PALANTIR_PASSPHRASE`, und fehlt auch die, bricht der Aufruf benannt ab
 * statt auf eine Eingabe zu warten, die nie kommt.
 */
export async function fragePassphrase(frage: string): Promise<string> {
  const ausUmgebung = process.env.PALANTIR_PASSPHRASE;

  if (ausUmgebung !== undefined && ausUmgebung !== '') {
    return ausUmgebung;
  }

  const eingabe = process.stdin;

  if (!eingabe.isTTY) {
    throw new Error(
      'Kein Terminal für die Eingabe der Passphrase. Entweder das Kommando in einer Shell ausführen ' +
        'oder die Passphrase in PALANTIR_PASSPHRASE übergeben.',
    );
  }

  process.stdout.write(frage);

  return new Promise<string>((erfuellen, ablehnen) => {
    let stand = LEERE_EINGABE;

    function loesen(): void {
      eingabe.setRawMode(false);
      eingabe.pause();
      eingabe.removeListener('data', aufDaten);
      process.stdout.write('\n');
    }

    function aufDaten(stueck: string): void {
      stand = verarbeiteEingabe(stand, stueck);

      if (stand.abgebrochen) {
        loesen();
        ablehnen(new Error('Abgebrochen.'));

        return;
      }

      if (stand.fertig) {
        loesen();
        erfuellen(stand.wert);
      }
    }

    eingabe.setRawMode(true);
    eingabe.resume();
    eingabe.setEncoding('utf8');
    eingabe.on('data', aufDaten);
  });
}
