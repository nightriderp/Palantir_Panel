import { type Tone } from '@/components/shared';
import { type LiveConnectionState } from '@/lib/live/LiveChannelProvider';

/**
 * Beschriftung der Live-Anzeige in der Kopfleiste (Pflichtenheft §5.3).
 *
 * Vorher hatte jeder der drei Verbindungszustände seinen eigenen Text. Das sah
 * man beim Wiederverbinden als Flackern: Ein fehlgeschlagener Versuch dauert
 * wenige Millisekunden, die erste Wartezeit ist eine halbe Sekunde – die
 * Anzeige sprang also mehrmals pro Sekunde zwischen „Verbindung wird aufgebaut"
 * und „Live-Verbindung unterbrochen" hin und her.
 *
 * Deshalb gibt es hier nur noch **zwei** Zustände neben „verbunden", und der
 * Unterschied ist nicht die Art des Fehlversuchs, sondern seine Dauer: Solange
 * es nur ein Aussetzer ist, steht „Wird verbunden …"; erst wenn es
 * {@link AUSFALL_SCHWELLE_MS} lang nicht klappt, steht „Nicht verbunden".
 * `connecting` und `closed` sehen bewusst gleich aus – für den Betrachter sind
 * sie dasselbe.
 */

/** So lange darf die Verbindung weg sein, bevor daraus ein echter Ausfall wird. */
export const AUSFALL_SCHWELLE_MS = 4000;

export interface LiveAnzeige {
  tone: Tone;
  /** Kurztext neben dem Punkt. */
  label: string;
  /** Erklärung für den Tooltip – was das für die Bedienung heißt. */
  title: string;
  pulse: boolean;
}

/**
 * Anzeige aus Verbindungszustand und Dauer.
 *
 * `ausfallBestaetigt` sagt, ob die Verbindung länger als
 * {@link AUSFALL_SCHWELLE_MS} weg ist; die Uhr dafür läuft in der Komponente.
 */
export function liveAnzeige(
  connection: LiveConnectionState,
  ausfallBestaetigt: boolean,
): LiveAnzeige {
  if (connection === 'open') {
    return {
      tone: 'success',
      label: 'Live verbunden',
      title: 'Statusänderungen, Konsole und Messwerte kommen von selbst herein.',
      pulse: true,
    };
  }

  if (!ausfallBestaetigt) {
    return {
      tone: 'warning',
      label: 'Wird verbunden …',
      title: 'Die Live-Verbindung wird gerade aufgebaut.',
      pulse: true,
    };
  }

  return {
    tone: 'danger',
    label: 'Nicht verbunden',
    title:
      'Ohne Live-Verbindung kommen Statusänderungen, Konsole und Messwerte nicht von selbst herein – ' +
      'Bedienen und Laden funktionieren weiter, angezeigte Werte können aber veraltet sein. ' +
      'Es wird im Hintergrund weiter versucht.',
    pulse: false,
  };
}
