/**
 * Klang der Spielhalle – Typen für Musik und Effekte.
 *
 * Alles wird im Browser über WebAudio erzeugt: keine Tondateien, keine
 * Lizenzfragen, nichts für die Content-Security-Policy. Die Melodien sind
 * eigene Kompositionen als Notenzettel (Vorbild: Schwesterprojekt).
 *
 * Hochgeladene Stücke (Admin-Seite „Arcade-Musik") ersetzen die Melodie eines
 * Spiels; sie werden per `fetch` geladen und über `decodeAudioData` gespielt,
 * weil die CSP kein `media-src` für die API freigibt.
 */

/** Halbton nach MIDI (69 = A4 = 440 Hz) oder `null` für Pause, Länge in Sechzehnteln. */
export type Note = readonly [number | null, number];

/**
 * Ein Abschnitt: **genau 64 Sechzehntel** (vier Takte 4/4) je Stimme. Ein Test
 * prüft das für jedes Stück – sonst laufen Melodie und Begleitung mit jeder
 * Runde weiter auseinander.
 */
export type Section = readonly Note[];

export const SECTION_SIXTEENTHS = 64;

/** Schlagzeug-Muster über 16 Sechzehntel: `k` Kick, `s` Snare, `h` Hi-Hat, `.` Pause. */
export type DrumPattern = string;

export interface Track {
  /** Anzeigename, z. B. „Schlangenlinien". */
  title: string;
  /** Viertel je Minute. */
  bpm: number;
  /** Klangfarbe der Melodie. */
  wave: OscillatorType;
  /** Klangfarbe der Begleitung (Vorgabe: 'triangle'). */
  bassWave?: OscillatorType;
  /**
   * Folge der Abschnitte, z. B. A-B-A-C. Aus wenigen Abschnitten wird so ein
   * Stück, das eine Minute läuft, bevor es sich wiederholt.
   */
  melody: readonly Section[];
  /** Begleitung, gleich viele Abschnitte wie `melody`. */
  bass: readonly Section[];
  /**
   * Optionale dritte Stimme (Gegenmelodie/Akkordtöne), gleich viele
   * Abschnitte wie `melody`.
   */
  harmony?: readonly Section[];
  /** Optionales Schlagzeug: ein Muster je Takt, läuft im Kreis. */
  drums?: readonly DrumPattern[];
  /** Lautstärke-Faktor 0…1 (Vorgabe 1). */
  gain?: number;
}

/**
 * Geräusche, die jedes Spiel auslösen darf. Bewusst ein gemeinsamer, kleiner
 * Satz – die Spiele klingen dadurch wie aus einem Guss.
 */
export type SfxName =
  | 'click'
  | 'move'
  | 'place'
  | 'capture'
  | 'dice'
  | 'card'
  | 'shuffle'
  | 'eat'
  | 'bounce'
  | 'hit'
  | 'explode'
  | 'shoot'
  | 'powerup'
  | 'line'
  | 'score'
  | 'coin'
  | 'turn'
  | 'error'
  | 'win'
  | 'lose'
  | 'tick'
  | 'flap';
