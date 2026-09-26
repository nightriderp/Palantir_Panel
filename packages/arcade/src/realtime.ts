/**
 * Echtzeit-Spiele der Spielhalle (Snake, Tetris, Pac-Man …).
 *
 * Aufbau nach dem Vorbild des Schwesterprojekts: Der Browser schickt nicht mehr
 * den Punktestand, sondern **die Eingaben**. Das Backend spielt die Partie aus
 * demselben Startwert mit derselben Logik nach und speichert nur den Stand, den
 * es selbst errechnet hat. Daraus folgen die Regeln für jedes Spiel:
 *
 *   1. `step(state, input)` ist deterministisch. Kein Canvas, kein DOM, keine
 *      Uhr, kein `Math.random()`. Zufall kommt aus `rng.ts`, der Zustand des
 *      Generators liegt im Spielzustand.
 *   2. **Fester Takt.** Ein Schritt ist ein Schritt. Wie viele Millisekunden er
 *      auf dem Bildschirm dauert, sagt `tickMs()`, und das interessiert nur
 *      die Zeichenschicht.
 *   3. **Obergrenzen** für Schritte, Eingaben und Bandgröße. Sie sind kein Teil
 *      der Spielregeln, sondern der Deckel für die Rechenzeit, die eine
 *      einzelne Einsendung im Backend kosten darf.
 *
 * `step` darf den übergebenen Zustand in-place fortschreiben und muss ihn
 * zurückgeben. Die Zeichenschicht hält nur einen Zustand, und das Nachrechnen
 * braucht keine Kopien.
 */

import { type ArcadeGameId } from '@palantir/contracts';

// ---------------------------------------------------------------------------
// Eingaben
// ---------------------------------------------------------------------------

/**
 * Eine Eingabe ist eine Ganzzahl in [1, MAX_ARCADE_INPUT]. 0 heißt „in diesem
 * Schritt nichts".
 *
 * Die Grundbelegung unten teilen sich alle Spiele. Loslassen einer Taste ist
 * `RELEASE + Taste` (Schläger-Spiele brauchen gedrückt/losgelassen). Spiele mit
 * Feldauswahl (Minesweeper, 2048 …) verpacken ihre Daten ab `ARCADE_INPUT_CUSTOM`.
 */
export type ArcadeInput = number;

export const ARCADE_INPUT_NONE = 0;
export const ARCADE_INPUT_UP = 1;
export const ARCADE_INPUT_RIGHT = 2;
export const ARCADE_INPUT_DOWN = 3;
export const ARCADE_INPUT_LEFT = 4;
export const ARCADE_INPUT_ACTION = 5;
/** Zweite Aktionstaste (z. B. Drehen gegen den Uhrzeigersinn, Halten). */
export const ARCADE_INPUT_ACTION2 = 6;
/** Zu einer Taste addiert: diese Taste wurde losgelassen. */
export const ARCADE_INPUT_RELEASE = 8;
/** Ab hier legen Spiele eigene Eingaben fest (Feldnummern usw.). */
export const ARCADE_INPUT_CUSTOM = 16;

/** Größter erlaubter Eingabewert. */
export const MAX_ARCADE_INPUT = 0xffff;

/** Gegenrichtung – Snake darf nicht in sich selbst wenden. */
export function oppositeDirection(input: ArcadeInput): ArcadeInput {
  if (input === ARCADE_INPUT_UP) return ARCADE_INPUT_DOWN;
  if (input === ARCADE_INPUT_DOWN) return ARCADE_INPUT_UP;
  if (input === ARCADE_INPUT_LEFT) return ARCADE_INPUT_RIGHT;
  if (input === ARCADE_INPUT_RIGHT) return ARCADE_INPUT_LEFT;
  return ARCADE_INPUT_NONE;
}

// ---------------------------------------------------------------------------
// Obergrenzen
// ---------------------------------------------------------------------------

/** Höchstzahl Schritte einer Partie (bei 60 Schritten je Sekunde gut eine Stunde). */
export const MAX_ARCADE_TICKS = 250_000;
/** Höchstzahl aufgezeichneter Eingaben. */
export const MAX_ARCADE_INPUTS = 60_000;
/** Höchstgröße eines kodierten Bandes in Bytes – greift vor dem Auspacken. */
export const MAX_ARCADE_REPLAY_BYTES = 384 * 1024;

// ---------------------------------------------------------------------------
// Aufzeichnung
// ---------------------------------------------------------------------------

export interface ArcadeInputEvent {
  tick: number;
  input: ArcadeInput;
}

/** Das Band einer Partie: alles, was das Backend zum Nachspielen braucht. */
export interface ArcadeRecording {
  /** Länge der Partie in Schritten. */
  totalTicks: number;
  /** Eingaben, streng aufsteigend nach `tick`, höchstens eine je Schritt. */
  events: readonly ArcadeInputEvent[];
}

/**
 * Sammelt Eingaben während des Spielens.
 *
 * Höchstens **eine** Eingabe je Schritt – sonst könnte Snake sich in einem
 * Schritt um 180° drehen. Die Zeichenschicht stellt weitere Tastendrücke in
 * eine Warteschlange und gibt je Schritt eine davon ab.
 */
export class ArcadeRecorder {
  private readonly events: ArcadeInputEvent[] = [];
  private lastTick = -1;

  record(tick: number, input: ArcadeInput): void {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new Error(`ArcadeRecorder: ungültiger Schritt ${String(tick)}`);
    }
    if (tick <= this.lastTick) {
      throw new Error(`ArcadeRecorder: Schritt ${tick} liegt nicht hinter ${this.lastTick}.`);
    }
    if (!Number.isInteger(input) || input <= 0 || input > MAX_ARCADE_INPUT) {
      throw new Error(`ArcadeRecorder: ungültige Eingabe ${String(input)}`);
    }
    this.events.push({ tick, input });
    this.lastTick = tick;
  }

  get length(): number {
    return this.events.length;
  }

  finish(totalTicks: number): ArcadeRecording {
    if (!Number.isInteger(totalTicks) || totalTicks < 0) {
      throw new Error(`ArcadeRecorder: ungültige Länge ${String(totalTicks)}`);
    }
    if (this.lastTick >= totalTicks) {
      throw new Error(`ArcadeRecorder: Eingabe bei ${this.lastTick} liegt hinter ${totalTicks}.`);
    }
    return { totalTicks, events: [...this.events] };
  }
}

// ---------------------------------------------------------------------------
// Kodierung des Bandes
// ---------------------------------------------------------------------------

const REPLAY_FORMAT_VERSION = 1;

/** Packt ein Band in Bytes: Fassung, Länge, Anzahl, dann je Eingabe Abstand und Wert als Varint. */
export function encodeArcadeReplay(recording: ArcadeRecording): Uint8Array {
  const bytes: number[] = [REPLAY_FORMAT_VERSION];
  writeVarint(bytes, recording.totalTicks);
  writeVarint(bytes, recording.events.length);
  let previous = 0;
  for (const event of recording.events) {
    writeVarint(bytes, event.tick - previous);
    writeVarint(bytes, event.input);
    previous = event.tick;
  }
  return Uint8Array.from(bytes);
}

export type ArcadeReplayDecodeResult =
  { ok: true; recording: ArcadeRecording } | { ok: false; reason: string };

/**
 * Packt ein Band aus. Hier kommen **fremde Bytes** ins Backend – jede Zusage
 * wird einzeln geprüft: Größe, Fassung, Obergrenzen, aufsteigende Schritte,
 * nichts hinter dem Ende, keine überzähligen Bytes.
 */
export function decodeArcadeReplay(data: Uint8Array): ArcadeReplayDecodeResult {
  if (data.length === 0) return { ok: false, reason: 'leeres Band' };
  if (data.length > MAX_ARCADE_REPLAY_BYTES) {
    return { ok: false, reason: `Band zu groß (${data.length} Bytes)` };
  }
  if (data[0] !== REPLAY_FORMAT_VERSION) {
    return { ok: false, reason: `unbekannte Formatfassung ${String(data[0])}` };
  }
  const cursor = { offset: 1 };
  const totalTicks = readVarint(data, cursor);
  if (totalTicks === null) return { ok: false, reason: 'Länge unlesbar' };
  if (totalTicks > MAX_ARCADE_TICKS)
    return { ok: false, reason: `zu viele Schritte (${totalTicks})` };
  const count = readVarint(data, cursor);
  if (count === null) return { ok: false, reason: 'Anzahl Eingaben unlesbar' };
  if (count > MAX_ARCADE_INPUTS) return { ok: false, reason: `zu viele Eingaben (${count})` };

  const events: ArcadeInputEvent[] = [];
  let tick = 0;
  for (let i = 0; i < count; i += 1) {
    const delta = readVarint(data, cursor);
    if (delta === null) return { ok: false, reason: `Eingabe ${i}: Abstand unlesbar` };
    if (i > 0 && delta === 0) {
      return { ok: false, reason: `Eingabe ${i}: zwei Eingaben im selben Schritt` };
    }
    tick += delta;
    if (tick >= totalTicks) {
      return { ok: false, reason: `Eingabe ${i}: Schritt ${tick} liegt hinter dem Ende` };
    }
    const input = readVarint(data, cursor);
    if (input === null) return { ok: false, reason: `Eingabe ${i}: Wert unlesbar` };
    if (input === 0 || input > MAX_ARCADE_INPUT) {
      return { ok: false, reason: `Eingabe ${i}: unzulässiger Wert ${input}` };
    }
    events.push({ tick, input });
  }
  if (cursor.offset !== data.length) {
    return { ok: false, reason: `${data.length - cursor.offset} überzählige Bytes` };
  }
  return { ok: true, recording: { totalTicks, events } };
}

function writeVarint(bytes: number[], value: number): void {
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
}

function readVarint(data: Uint8Array, cursor: { offset: number }): number | null {
  let result = 0;
  let shift = 1;
  for (let i = 0; i < 5; i += 1) {
    const byte = data[cursor.offset];
    if (byte === undefined) return null;
    cursor.offset += 1;
    result += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) return result;
    shift *= 128;
  }
  return null;
}

/** Band als Base64 (für JSON-Körper der API). Läuft in Browser und Node. */
export function replayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Base64 zurück in Bytes; `null` bei Unfug. */
export function replayFromBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Die Form eines Echtzeit-Spiels
// ---------------------------------------------------------------------------

/**
 * Reine Logik eines Echtzeit-Spiels.
 *
 * Gezeichnet wird im Frontend (`components/arcade/realtime/<id>.ts`), das hier
 * kennt kein Canvas.
 */
export interface RealtimeGame<S> {
  readonly kind: 'realtime';
  readonly id: ArcadeGameId;
  /**
   * Fassung der Spiellogik. **Hochzählen, sobald sich das Verhalten ändert** –
   * dieselbe Eingabefolge rechnet danach anders, und ein Band aus einem
   * älteren Browser-Tab wird dann abgelehnt statt falsch nachgerechnet.
   */
  readonly version: number;
  /** Anfangszustand aus dem Startwert. */
  create(seed: number): S;
  /** Ein Schritt; darf `state` fortschreiben und gibt ihn zurück. */
  step(state: S, input: ArcadeInput): S;
  isOver(state: S): boolean;
  /** Punktestand, ganzzahlig und nicht negativ. */
  score(state: S): number;
  /**
   * Dauer eines Schritts auf dem Bildschirm in ms. **0 = kein Zeittakt**: Das
   * Spiel rührt sich nur bei einer Eingabe (2048, Minesweeper, Simon im
   * Eingabeteil). Die Zeichenschicht ruft `step` dann nur mit Eingaben auf.
   */
  tickMs(state: S): number;
}

export interface ArcadeReplayResult {
  score: number;
  ticks: number;
  /** War die Partie am Ende des Bandes vorbei? Unbeendete Partien zählen nicht. */
  finished: boolean;
}

/**
 * Spielt ein Band nach. Die Partie endet, sobald die Logik `isOver` meldet –
 * ein Band, das darüber hinaus läuft, verändert den Stand nicht mehr.
 */
export function runArcadeReplay<S>(
  logic: RealtimeGame<S>,
  seed: number,
  recording: ArcadeRecording,
): ArcadeReplayResult {
  if (recording.totalTicks > MAX_ARCADE_TICKS) {
    throw new Error(`runArcadeReplay: ${recording.totalTicks} Schritte über der Grenze`);
  }
  if (recording.events.length > MAX_ARCADE_INPUTS) {
    throw new Error(`runArcadeReplay: ${recording.events.length} Eingaben über der Grenze`);
  }
  let state = logic.create(seed);
  let next = 0;
  let tick = 0;
  for (; tick < recording.totalTicks; tick += 1) {
    if (logic.isOver(state)) break;
    let input = ARCADE_INPUT_NONE;
    const event = recording.events[next];
    if (event !== undefined && event.tick === tick) {
      input = event.input;
      next += 1;
    }
    state = logic.step(state, input);
  }
  return { score: logic.score(state), ticks: tick, finished: logic.isOver(state) };
}
