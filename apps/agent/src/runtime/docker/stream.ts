/**
 * Hilfen fuer die Streaming-Antworten der Docker-Engine.
 *
 * Zwei Formate kommen vor:
 *   - **Multiplexter Stream** (Logs, Exec ohne TTY): Folge von Rahmen mit
 *     8-Byte-Kopf `[streamTyp, 0, 0, 0, groesse(4 Byte, big endian)]` und
 *     anschliessender Nutzlast. Nur so lassen sich stdout und stderr in einer
 *     Verbindung trennen.
 *   - **NDJSON** (Statistiken, Engine-Events): ein JSON-Objekt pro Zeile.
 *
 * Beide Parser arbeiten auf `AsyncIterable<Uint8Array>` und kommen daher ohne
 * echten HTTP-Client aus - genau das macht sie testbar.
 */

import { type LogLine, type LogStreamName } from '../types.js';

export interface DockerFrame {
  readonly stream: LogStreamName;
  readonly payload: Buffer;
}

const FRAME_HEADER_LENGTH = 8;

/**
 * Zerlegt einen multiplexten Docker-Stream in Rahmen.
 *
 * Faellt auf `stdout` zurueck, wenn der Stream nicht multiplext ist (das ist der
 * Fall, wenn der Container mit TTY laeuft) - erkennbar daran, dass der
 * Stream-Typ im Kopf keiner der bekannten Werte ist.
 */
export async function* demuxDockerStream(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<DockerFrame> {
  let buffer = Buffer.alloc(0);

  for await (const chunk of source) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

    for (;;) {
      if (buffer.length < FRAME_HEADER_LENGTH) break;

      const streamType = buffer.readUInt8(0);
      if (streamType !== 0 && streamType !== 1 && streamType !== 2) {
        // Kein multiplexter Stream (TTY-Modus): alles ist stdout.
        yield { stream: 'stdout', payload: buffer };
        buffer = Buffer.alloc(0);
        break;
      }

      const payloadLength = buffer.readUInt32BE(4);
      if (buffer.length < FRAME_HEADER_LENGTH + payloadLength) break;

      const payload = buffer.subarray(FRAME_HEADER_LENGTH, FRAME_HEADER_LENGTH + payloadLength);
      buffer = buffer.subarray(FRAME_HEADER_LENGTH + payloadLength);
      yield { stream: streamType === 2 ? 'stderr' : 'stdout', payload: Buffer.from(payload) };
    }
  }

  if (buffer.length > 0) {
    yield { stream: 'stdout', payload: buffer };
  }
}

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s(.*)$/s;

/**
 * Setzt aus Rahmen vollstaendige Logzeilen zusammen.
 *
 * Docker garantiert nicht, dass ein Rahmen genau eine Zeile enthaelt: eine lange
 * Zeile kann ueber mehrere Rahmen laufen, ein Rahmen mehrere Zeilen enthalten.
 * Der Assembler haelt deshalb je Stream einen Rest vor.
 */
/**
 * Obergrenze fuer eine einzelne, noch nicht abgeschlossene Logzeile (Zeichen).
 *
 * Ein Container, der eine endlose Zeile ohne Zeilenumbruch schreibt (fehlerhaft
 * oder absichtlich), liesse den Rest-Puffer sonst unbegrenzt wachsen, bis der
 * Agent das `mem_limit` reisst und per OOM alle Streams der Node abreisst.
 * Bei Ueberschreitung wird der bisherige Rest als gekuerzte Zeile ausgegeben und
 * der Puffer geleert.
 */
const MAX_UNTERMINATED_LINE_LENGTH = 64 * 1024;

const TRUNCATION_MARKER = ' […abgeschnitten]';

export class LogLineAssembler {
  readonly #containerId: string;
  readonly #rest: Record<LogStreamName, string> = { stdout: '', stderr: '' };

  constructor(containerId: string) {
    this.#containerId = containerId;
  }

  push(frame: DockerFrame): LogLine[] {
    const text = this.#rest[frame.stream] + frame.payload.toString('utf8');
    const teile = text.split('\n');
    // Das letzte Element ist der unvollstaendige Rest bis zum naechsten Rahmen.
    let rest = teile.pop() ?? '';

    const zeilen = teile.map((zeile) => this.#toLogLine(frame.stream, zeile));

    // Wuchert der Rest ueber die Grenze, ohne dass ein Umbruch kam, wird er als
    // gekuerzte Zeile abgeschlossen statt weiter im Speicher zu wachsen.
    if (rest.length > MAX_UNTERMINATED_LINE_LENGTH) {
      const gekuerzt = rest.slice(0, MAX_UNTERMINATED_LINE_LENGTH) + TRUNCATION_MARKER;
      zeilen.push(this.#toLogLine(frame.stream, gekuerzt));
      rest = '';
    }

    this.#rest[frame.stream] = rest;
    return zeilen;
  }

  /** Angefangene Zeilen am Ende des Streams ausgeben. */
  flush(): LogLine[] {
    const zeilen: LogLine[] = [];
    for (const stream of ['stdout', 'stderr'] as const) {
      const rest = this.#rest[stream];
      if (rest.length > 0) {
        zeilen.push(this.#toLogLine(stream, rest));
        this.#rest[stream] = '';
      }
    }
    return zeilen;
  }

  #toLogLine(stream: LogStreamName, rohzeile: string): LogLine {
    const zeile = rohzeile.endsWith('\r') ? rohzeile.slice(0, -1) : rohzeile;
    const treffer = TIMESTAMP_PATTERN.exec(zeile);
    if (treffer === null) {
      return { containerId: this.#containerId, stream, message: zeile, timestamp: null };
    }
    const [, zeitstempel = '', nachricht = ''] = treffer;
    return {
      containerId: this.#containerId,
      stream,
      message: nachricht,
      // Docker liefert Nanosekunden; ISO-8601 in JavaScript kennt nur
      // Millisekunden. Date normalisiert das verlustbehaftet, aber einheitlich.
      timestamp: normalisiereZeitstempel(zeitstempel),
    };
  }
}

function normalisiereZeitstempel(wert: string): string | null {
  const datum = new Date(wert);
  return Number.isNaN(datum.getTime()) ? null : datum.toISOString();
}

/** Liest einen NDJSON-Stream (ein JSON-Objekt je Zeile). */
export async function* readNdjson(source: AsyncIterable<Uint8Array>): AsyncGenerator<unknown> {
  let rest = '';

  for await (const chunk of source) {
    rest += Buffer.from(chunk).toString('utf8');
    const zeilen = rest.split('\n');
    rest = zeilen.pop() ?? '';

    for (const zeile of zeilen) {
      const getrimmt = zeile.trim();
      if (getrimmt.length === 0) continue;
      yield JSON.parse(getrimmt);
    }
  }

  const abschluss = rest.trim();
  if (abschluss.length > 0) {
    yield JSON.parse(abschluss);
  }
}

/** Sammelt einen Stream vollstaendig in einen Puffer. */
export async function collectStream(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const teile: Buffer[] = [];
  for await (const chunk of source) {
    teile.push(Buffer.from(chunk));
  }
  return Buffer.concat(teile);
}
