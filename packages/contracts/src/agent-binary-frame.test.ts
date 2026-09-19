import { describe, expect, it } from 'vitest';
import {
  AGENT_BINARY_FRAME_MAGIC,
  type AgentBinaryFrameHeader,
  decodeAgentBinaryFrame,
  encodeAgentBinaryFrame,
  isAgentBinaryFrame,
} from './agent-binary-frame.js';

const KOPF: AgentBinaryFrameHeader = {
  kind: 'commandResultBinary',
  correlationId: '11111111-1111-4111-8111-111111111111',
  frame: {
    kind: 'commandResult',
    correlationId: '11111111-1111-4111-8111-111111111111',
    result: { success: true, data: { offset: 0, bytesRead: 4, totalBytes: 8, eof: false } },
  },
  binaryField: 'contentBase64',
};

describe('Binärframe des Agentenkanals', () => {
  it('liest zurück, was es geschrieben hat', () => {
    const daten = new Uint8Array([1, 2, 3, 0, 255, 128]);
    const gelesen = decodeAgentBinaryFrame(encodeAgentBinaryFrame(KOPF, daten));

    expect(gelesen?.header).toEqual(KOPF);
    expect(gelesen?.payload).toEqual(daten);
  });

  it('kommt mit leeren Nutzdaten zurecht', () => {
    const gelesen = decodeAgentBinaryFrame(encodeAgentBinaryFrame(KOPF, new Uint8Array()));

    expect(gelesen?.payload).toHaveLength(0);
  });

  it('erkennt einen Textframe nicht als Binärframe', () => {
    const text = new TextEncoder().encode(JSON.stringify({ kind: 'commandResult' }));

    expect(isAgentBinaryFrame(text)).toBe(false);
    expect(decodeAgentBinaryFrame(text)).toBeNull();
  });

  it('weist eine Längenangabe zurück, die über das Ende hinausreicht', () => {
    /*
     * Die Zahl kommt von der Gegenseite. Zeigt sie hinter das Pufferende,
     * darf das Lesen nicht in fremden Speicher greifen, sondern muss den
     * Frame verwerfen.
     */
    const echt = encodeAgentBinaryFrame(KOPF, new Uint8Array([1, 2, 3]));
    const verdreht = new Uint8Array(echt);

    new DataView(verdreht.buffer).setUint32(AGENT_BINARY_FRAME_MAGIC.length, 10 ** 6, false);

    expect(decodeAgentBinaryFrame(verdreht)).toBeNull();
  });

  it('verwirft einen Kopf, der kein gültiges JSON ist', () => {
    const kaputt = encodeAgentBinaryFrame(KOPF, new Uint8Array([9]));

    // Erstes Zeichen des Kopfes zerstören.
    kaputt[8] = 0x7b + 1;

    expect(decodeAgentBinaryFrame(kaputt)).toBeNull();
  });

  it('verwirft einen Kopf, dem die Pflichtangaben fehlen', () => {
    const ohneFeld = encodeAgentBinaryFrame(
      { ...KOPF, binaryField: '' } as AgentBinaryFrameHeader,
      new Uint8Array([1]),
    );

    expect(decodeAgentBinaryFrame(ohneFeld)).toBeNull();
  });

  it('verwirft einen zu kurzen Puffer', () => {
    expect(isAgentBinaryFrame(new Uint8Array([0x50, 0x4c]))).toBe(false);
    expect(decodeAgentBinaryFrame(new Uint8Array([0x50, 0x4c]))).toBeNull();
  });
});
