import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_ACTION2,
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RELEASE,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  type ArcadeInput,
} from '@palantir/arcade';

/**
 * Grundbelegung der Tastatur für Echtzeit-Spiele.
 *
 * Pfeiltasten und WASD für Richtungen, Leertaste/Enter für die Aktion, X/Shift
 * für die zweite Aktion. Beim Loslassen kommt `ARCADE_INPUT_RELEASE + Taste`
 * zurück – nur wenn `withRelease` gesetzt ist, sonst `null` (die meisten Spiele
 * interessiert Loslassen nicht, und jede Eingabe kostet Platz im Band).
 */

const KEY_TO_INPUT: Record<string, ArcadeInput> = {
  ArrowUp: ARCADE_INPUT_UP,
  w: ARCADE_INPUT_UP,
  W: ARCADE_INPUT_UP,
  ArrowRight: ARCADE_INPUT_RIGHT,
  d: ARCADE_INPUT_RIGHT,
  D: ARCADE_INPUT_RIGHT,
  ArrowDown: ARCADE_INPUT_DOWN,
  s: ARCADE_INPUT_DOWN,
  S: ARCADE_INPUT_DOWN,
  ArrowLeft: ARCADE_INPUT_LEFT,
  a: ARCADE_INPUT_LEFT,
  A: ARCADE_INPUT_LEFT,
  ' ': ARCADE_INPUT_ACTION,
  Enter: ARCADE_INPUT_ACTION,
  x: ARCADE_INPUT_ACTION2,
  X: ARCADE_INPUT_ACTION2,
  Shift: ARCADE_INPUT_ACTION2,
};

export function defaultKeyInput(
  key: string,
  phase: 'press' | 'release',
  withRelease = false,
): ArcadeInput | null {
  const input = KEY_TO_INPUT[key];
  if (input === undefined) return null;
  if (phase === 'press') return input;
  return withRelease ? input + ARCADE_INPUT_RELEASE : null;
}

/** Tasten, die der Wirt der Seite wegnimmt (kein Scrollen beim Spielen). */
export function isGameKey(key: string): boolean {
  return key in KEY_TO_INPUT;
}
