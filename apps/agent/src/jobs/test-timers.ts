/**
 * Zeitgeber-Attrappe für die Job-Tests.
 *
 * Bewusst keine Vitest-Fake-Timer: Die Jobs warten zwischen den Durchgängen auf
 * Zusagen (`await`), und `vi.advanceTimersByTime()` läuft an einer noch nicht
 * eingelösten Zusage vorbei. Hier stellt {@link FakeTimers.advance} die Zeit
 * vor **und** gibt der Ereignisschleife anschließend Gelegenheit, die
 * angestoßenen Zusagen einzulösen – die Tests bleiben dadurch ohne echte
 * Wartezeit deterministisch.
 *
 * Bewusst keine `.test.ts`-Datei: Sie wird von Testdateien importiert und nicht
 * selbst als Testdatei eingesammelt (wie `container-runtime.conformance.ts`).
 */

import type { SchedulerTimers, TimerHandle } from './scheduler.js';

interface GeplanterAufruf {
  readonly id: number;
  readonly handler: () => void;
  faelligBei: number;
}

export class FakeTimers implements SchedulerTimers {
  #jetzt = 0;
  #naechsteId = 1;
  readonly #geplant = new Map<number, GeplanterAufruf>();

  setTimeout(handler: () => void, delayMs: number): TimerHandle {
    const id = this.#naechsteId++;
    this.#geplant.set(id, { id, handler, faelligBei: this.#jetzt + delayMs });
    // Die Kennung wandert als TimerHandle durch den Scheduler; sie wird dort
    // ausschließlich an clearTimeout zurückgereicht.
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.#geplant.delete(handle as unknown as number);
  }

  /** Aktuelle Zeit der Attrappe in Millisekunden seit ihrem Beginn. */
  get now(): number {
    return this.#jetzt;
  }

  /** Anzahl der noch offenen Zeitgeber. */
  get pending(): number {
    return this.#geplant.size;
  }

  /**
   * Stellt die Zeit vor und führt alle fällig gewordenen Aufrufe aus.
   *
   * Nach jedem Aufruf wird die Ereignisschleife geleert, damit die Zusagen des
   * Jobs vor dem nächsten Schritt tatsächlich eingelöst sind.
   */
  async advance(ms: number): Promise<void> {
    const ziel = this.#jetzt + ms;

    for (;;) {
      // Zuerst leeren, dann suchen: Ein Job, dessen Durchgang gerade fertig
      // wird, plant seinen nächsten Zeitgeber erst in der Fortsetzung seiner
      // Zusage. Ohne dieses Leeren davor wäre der Zeitgeber hier noch nicht
      // sichtbar und der Takt bliebe im Test stehen.
      await leereEreignisschleife();

      const naechster = [...this.#geplant.values()]
        .filter((eintrag) => eintrag.faelligBei <= ziel)
        .sort((a, b) => a.faelligBei - b.faelligBei)[0];

      if (naechster === undefined) {
        break;
      }

      this.#jetzt = Math.max(this.#jetzt, naechster.faelligBei);
      this.#geplant.delete(naechster.id);
      naechster.handler();
    }

    this.#jetzt = ziel;
    await leereEreignisschleife();
  }
}

/** Gibt allen bereits eingelösten Zusagen Gelegenheit, ihre Fortsetzung zu laufen. */
export async function leereEreignisschleife(durchgaenge = 8): Promise<void> {
  for (let i = 0; i < durchgaenge; i += 1) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
}
