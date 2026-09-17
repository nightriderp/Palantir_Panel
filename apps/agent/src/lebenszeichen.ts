/**
 * Lebenszeichen des Agents für den Docker-Healthcheck (Review 2026-09-16,
 * Befund 8.3).
 *
 * Der Agent nimmt keine Verbindungen an (Pflichtenheft §1) – ein Healthcheck
 * kann also nichts anrufen. Stattdessen schreibt die Ereignisschleife in
 * festem Takt eine kleine Datei; `deploy/gamenode/docker-compose.yml` prüft
 * ihr Alter. Bleibt die Datei stehen, hängt der Prozess (blockierte Schleife,
 * eingefrorener Start), und Docker startet ihn neu.
 *
 * Bewusst **nur** die Ereignisschleife: Ob die Verbindung zum Backend steht,
 * gehört nicht hinein. Ist die VPS weg, ist der Agent trotzdem gesund, und ein
 * Neustart würde daran nichts ändern – er kostet nur den Reconnect-Zustand.
 * Der Verbindungszustand steht als Text in der Datei, für `docker exec cat`.
 *
 * Der Pfad ist fest, keine Umgebungsvariable: Er ist eine Verabredung
 * zwischen Image und Compose-Datei, kein Betriebsparameter.
 */

import { writeFile } from 'node:fs/promises';

export const LEBENSZEICHEN_PFAD = '/tmp/palantir-agent-alive';
export const LEBENSZEICHEN_INTERVALL_MS = 30_000;

export interface LebenszeichenOptions {
  readonly pfad?: string;
  readonly intervallMs?: number;
  /** Beschreibung des Zustands, die mit in die Datei kommt. */
  readonly zustand?: () => string;
  readonly now?: () => Date;
  readonly onError?: (fehler: unknown) => void;
}

export interface Lebenszeichen {
  stop(): void;
}

/**
 * Schreibt sofort und dann im Takt; die Rückgabe beendet den Zyklus. Der
 * Zeitgeber hält den Prozess nicht am Leben (`unref`), damit das Beenden
 * nicht an ihm hängt.
 */
export function startLebenszeichen(options: LebenszeichenOptions = {}): Lebenszeichen {
  const pfad = options.pfad ?? LEBENSZEICHEN_PFAD;
  const intervallMs = options.intervallMs ?? LEBENSZEICHEN_INTERVALL_MS;
  const now = options.now ?? ((): Date => new Date());
  let laeuft = true;

  const schreiben = (): void => {
    if (!laeuft) {
      return;
    }

    const inhalt = `${now().toISOString()} ${options.zustand?.() ?? ''}`.trimEnd();

    writeFile(pfad, `${inhalt}\n`, 'utf8').catch((fehler: unknown) => {
      options.onError?.(fehler);
    });
  };

  schreiben();

  const timer = setInterval(schreiben, intervallMs);
  timer.unref();

  return {
    stop(): void {
      laeuft = false;
      clearInterval(timer);
    },
  };
}
