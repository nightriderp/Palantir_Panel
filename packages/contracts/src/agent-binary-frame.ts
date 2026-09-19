/**
 * Dateiblöcke als Rohbytes statt als Base64-Text (Leistungsbericht
 * 19.09.2026, Punkt 1.3).
 *
 * **Warum.** Alle Frames des Agentenkanals sind JSON. Ein Dateiblock reist
 * darin als Base64 und wiegt damit ein Drittel mehr, als er muss – bei einem
 * Weltordner von drei Gigabyte also ein Gigabyte Luft, dazu das Kodieren und
 * Dekodieren auf beiden Seiten.
 *
 * **Wie.** Neben den Textframes gibt es einen Binärframe: ein kurzer Kopf mit
 * demselben Inhalt wie bisher, gefolgt von den Rohbytes. Der Kopf sagt, in
 * welches Feld des Ergebnisses die Bytes gehören.
 *
 * ```
 * │ PLB1 │ Kopflänge (4 Byte) │ Kopf als JSON │ Rohbytes │
 * ```
 *
 * **Warum eine eigene Kennung am Anfang.** Die Empfangsseite bekommt beides
 * über dieselbe Leitung. Vier feste Bytes vorne sagen ihr in einem Vergleich,
 * womit sie es zu tun hat, ohne zu raten oder erst JSON zu versuchen.
 *
 * **Verhandelt, nicht vorausgesetzt.** Der Agent schickt Binärframes nur,
 * wenn das Backend sie im `welcome` angekündigt hat
 * ({@link BackendWelcomeFrame.binaryResults}). Ein älteres Backend lässt das
 * Feld weg und bekommt weiter Base64 – wichtig, weil Panel und Node nach einem
 * Deployment für einige Minuten unterschiedliche Stände fahren.
 */

/** Erkennungszeichen am Anfang jedes Binärframes. */
export const AGENT_BINARY_FRAME_MAGIC = 'PLB1';

/** Länge von Kennung und Kopflängenfeld zusammen. */
const VORSPANN_BYTES = 8;

/**
 * Größte Kopflänge, die beim Lesen akzeptiert wird.
 *
 * Der Kopf trägt ein Ergebnis ohne seine Nutzdaten und bleibt damit klein.
 * Die Grenze verhindert, dass eine verdrehte Längenangabe die Empfangsseite
 * dazu bringt, Megabytes als JSON zu lesen.
 */
const MAX_KOPF_BYTES = 256 * 1024;

/**
 * Kopf eines Binärframes.
 *
 * `frame` ist derselbe Textframe wie sonst, nur ohne die Nutzdaten:
 * `binaryField` benennt das Feld im `data`-Objekt des Ergebnisses, in das die
 * Rohbytes gehören – heute immer `contentBase64`.
 */
export interface AgentBinaryFrameHeader {
  readonly kind: 'commandResultBinary';
  readonly correlationId: string;
  /** Das Ergebnis, wie es als Textframe aussähe, ohne das Feld mit den Daten. */
  readonly frame: unknown;
  readonly binaryField: string;
}

/** Ein gelesener Binärframe. */
export interface AgentBinaryFrame {
  readonly header: AgentBinaryFrameHeader;
  readonly payload: Uint8Array;
}

/** Trägt dieser Puffer die Kennung eines Binärframes? */
export function isAgentBinaryFrame(data: Uint8Array): boolean {
  if (data.length < VORSPANN_BYTES) {
    return false;
  }

  for (let i = 0; i < AGENT_BINARY_FRAME_MAGIC.length; i += 1) {
    if (data[i] !== AGENT_BINARY_FRAME_MAGIC.charCodeAt(i)) {
      return false;
    }
  }

  return true;
}

/** Kopf und Rohbytes zu einem Binärframe zusammensetzen. */
export function encodeAgentBinaryFrame(
  header: AgentBinaryFrameHeader,
  payload: Uint8Array,
): Uint8Array {
  const kopf = new TextEncoder().encode(JSON.stringify(header));
  const gesamt = new Uint8Array(VORSPANN_BYTES + kopf.length + payload.length);

  for (let i = 0; i < AGENT_BINARY_FRAME_MAGIC.length; i += 1) {
    gesamt[i] = AGENT_BINARY_FRAME_MAGIC.charCodeAt(i);
  }

  new DataView(gesamt.buffer).setUint32(AGENT_BINARY_FRAME_MAGIC.length, kopf.length, false);
  gesamt.set(kopf, VORSPANN_BYTES);
  gesamt.set(payload, VORSPANN_BYTES + kopf.length);

  return gesamt;
}

/**
 * Einen Binärframe lesen.
 *
 * `null`, wenn der Puffer keiner ist oder nicht zusammenpasst – die
 * Empfangsseite behandelt ihn dann wie einen beliebigen kaputten Frame und
 * bricht nicht ab. Geprüft wird alles, was aus der Längenangabe folgt: Sie
 * kommt von der Gegenseite und darf nicht über das Ende hinaus zeigen.
 */
export function decodeAgentBinaryFrame(data: Uint8Array): AgentBinaryFrame | null {
  if (!isAgentBinaryFrame(data)) {
    return null;
  }

  const sicht = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const kopfLaenge = sicht.getUint32(AGENT_BINARY_FRAME_MAGIC.length, false);

  if (kopfLaenge === 0 || kopfLaenge > MAX_KOPF_BYTES) {
    return null;
  }

  if (data.length < VORSPANN_BYTES + kopfLaenge) {
    return null;
  }

  let kopf: unknown;

  try {
    kopf = JSON.parse(
      new TextDecoder().decode(data.subarray(VORSPANN_BYTES, VORSPANN_BYTES + kopfLaenge)),
    );
  } catch {
    return null;
  }

  if (!istKopf(kopf)) {
    return null;
  }

  return { header: kopf, payload: data.subarray(VORSPANN_BYTES + kopfLaenge) };
}

function istKopf(wert: unknown): wert is AgentBinaryFrameHeader {
  if (typeof wert !== 'object' || wert === null) {
    return false;
  }

  const kandidat = wert as Partial<AgentBinaryFrameHeader>;

  return (
    kandidat.kind === 'commandResultBinary' &&
    typeof kandidat.correlationId === 'string' &&
    typeof kandidat.binaryField === 'string' &&
    kandidat.binaryField.length > 0 &&
    typeof kandidat.frame === 'object' &&
    kandidat.frame !== null
  );
}
