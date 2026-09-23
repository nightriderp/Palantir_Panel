/**
 * Konsolenaktivität während eines Starts (Betreiber-Wunsch 23.09.2026).
 *
 * Merkt sich je Server die letzte Konsolenzeile und den Zeitpunkt des letzten
 * Fortschritts. Zwei Leser:
 *
 * - **Die Startfrist** (`startup-health.ts`): Mit `startupProgress` in der
 *   Definition verschiebt sich die Frist, solange Fortschritt kommt. CS2 lädt
 *   beim ersten Start gut 70 GB; eine feste Stunde reichte dafür nicht, und der
 *   Server stand auf „Fehler", während SteamCMD sichtbar weiterlud.
 * - **Die Fehlermeldung**: Scheitert ein Start, nennt sie die letzte Zeile der
 *   Konsole – für jedes Spiel, auch ohne `startupProgress`. Wer „nicht
 *   erreichbar" liest, sieht so gleich, woran es hing.
 *
 * **Nur im Speicher, nur während eines Starts.** Aufgeschrieben wird nur für
 * Server im Zustand `starting` (entscheidet der Aufrufer), und der Eintrag
 * geht mit dem Ende des Starts wieder weg. Nach einem Neustart des Backends
 * fehlt er – dann gilt bis zur nächsten Zeile die feste Frist, und das ist die
 * vorsichtige Richtung.
 */

/** Höchstlänge der Zeile in der Fehlermeldung – eine Konsolenzeile kann lang sein. */
const ZEILE_HOECHSTENS = 200;

interface Stand {
  letzteZeile: string;
  fortschrittAm: number | null;
}

export class StartupActivity {
  readonly #stand = new Map<string, Stand>();
  readonly #muster = new Map<string, RegExp | null>();
  readonly #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
  }

  /**
   * Eine Konsolenzeile aufschreiben.
   *
   * @param muster `startupProgress.pattern` der Definition; `undefined` heißt
   *   „jede Zeile zählt", `null` heißt „kein Fortschritt wird gezählt" (die
   *   Definition kennt `startupProgress` nicht).
   */
  zeile(serverId: string, text: string, muster: string | null | undefined): void {
    const bisher = this.#stand.get(serverId);
    const zaehlt = muster !== null && (muster === undefined || this.#passt(muster, text));

    this.#stand.set(serverId, {
      letzteZeile: text,
      fortschrittAm: zaehlt ? this.#now() : (bisher?.fortschrittAm ?? null),
    });
  }

  /** Zeitpunkt des letzten Fortschritts in Millisekunden, sonst `null`. */
  fortschrittAm(serverId: string): number | null {
    return this.#stand.get(serverId)?.fortschrittAm ?? null;
  }

  /** Die letzte Zeile, gekürzt, oder `null`. */
  letzteZeile(serverId: string): string | null {
    const zeile = this.#stand.get(serverId)?.letzteZeile.trim();

    if (zeile === undefined || zeile === '') {
      return null;
    }

    return zeile.length > ZEILE_HOECHSTENS ? `${zeile.slice(0, ZEILE_HOECHSTENS)} …` : zeile;
  }

  /** Den Stand eines Servers verwerfen – zu Beginn und am Ende eines Starts. */
  vergessen(serverId: string): void {
    this.#stand.delete(serverId);
  }

  #passt(muster: string, text: string): boolean {
    let ausdruck = this.#muster.get(muster);

    if (ausdruck === undefined) {
      // Ein kaputtes Muster zählt nichts, statt den Log-Pfad zu Fall zu
      // bringen; der Registry-Test hält es ohnehin aus dem Katalog heraus.
      try {
        ausdruck = new RegExp(muster, 'u');
      } catch {
        ausdruck = null;
      }
      this.#muster.set(muster, ausdruck);
    }

    return ausdruck?.test(text) ?? false;
  }
}
