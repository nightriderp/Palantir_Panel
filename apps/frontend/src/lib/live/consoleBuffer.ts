import { type ServerConsoleLine } from '@palantir/contracts';

/**
 * Puffer der Live-Konsole.
 *
 * Ein laufender Server schreibt über Stunden Zeilen; alles zu behalten würde
 * den Browser irgendwann ausbremsen. Der Puffer hält deshalb nur die jüngsten
 * Zeilen. Reine Funktion, damit die Grenzfälle prüfbar bleiben.
 */

/** Höchstzahl gehaltener Zeilen – entspricht grob dem, was ein Blättern hergibt. */
export const CONSOLE_BUFFER_LIMIT = 500;

/**
 * Zeile anhängen und dabei den Puffer begrenzen.
 *
 * Doppelte Zeilen (gleiche Id) werden übergangen: nach einem Wiederanlauf des
 * Live-Kanals kann das Backend die letzten Zeilen erneut schicken.
 */
export function appendConsoleLine(
  lines: readonly ServerConsoleLine[],
  incoming: ServerConsoleLine,
  limit: number = CONSOLE_BUFFER_LIMIT,
): ServerConsoleLine[] {
  if (lines.some((line) => line.id === incoming.id)) return [...lines];

  const next = [...lines, incoming];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Mehrere Zeilen auf einmal anhängen, z. B. den Rückblick beim Öffnen. */
export function appendConsoleLines(
  lines: readonly ServerConsoleLine[],
  incoming: readonly ServerConsoleLine[],
  limit: number = CONSOLE_BUFFER_LIMIT,
): ServerConsoleLine[] {
  return incoming.reduce<ServerConsoleLine[]>(
    (accumulated, line) => appendConsoleLine(accumulated, line, limit),
    [...lines],
  );
}
