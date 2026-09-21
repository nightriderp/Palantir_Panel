/**
 * Ob dieser Browser den Rundgang schon gesehen hat.
 *
 * **Bewusst im `localStorage` und nicht am Konto** – wie die Anzeige-Vorlieben
 * der Benachrichtigungen (`notifications/preferences.ts`) und aus demselben
 * Grund: Im `AccountDto` gibt es dafür kein Feld und im Backend keinen
 * Endpunkt, und ein neues Vertragsfeld samt Migration für „Willkommensdialog
 * schon gesehen" wäre für das, was hier passiert, zu viel Apparat. Die Folge
 * ist ehrlich benannt: Wer das Panel an einem zweiten Gerät öffnet, bekommt den
 * Rundgang dort noch einmal. Sobald das Backend eine Vorliebe am Konto führt,
 * wandert dieser Stand dorthin.
 *
 * Der gespeicherte Text ist absichtlich ein einzelnes Wort und kein JSON: Es
 * gibt genau zwei Zustände, und ein beschädigter Eintrag soll auf „noch nicht
 * gesehen" hinauslaufen, nicht auf einen Fehler.
 */

export const RUNDGANG_STORAGE_KEY = 'palantir.rundgang';

/** `offen` – noch nicht gesehen, der Rundgang startet von selbst. */
export type RundgangStand = 'offen' | 'erledigt';

export function parseStand(raw: string | null): RundgangStand {
  return raw === 'erledigt' ? 'erledigt' : 'offen';
}

export function serializeStand(stand: RundgangStand): string {
  return stand;
}
