import { describe, expect, it } from 'vitest';
import { liveClientFrameSchema, liveTopicSchema } from './server-live.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const TOPIC = { resource: 'server', id: SERVER_ID } as const;

describe('Themen des Live-Kanals (Pflichtenheft §5.3)', () => {
  it('nimmt ein Server-Thema an', () => {
    expect(liveTopicSchema.parse(TOPIC)).toEqual(TOPIC);
  });

  it('lehnt eine unbekannte Ressource ab', () => {
    expect(liveTopicSchema.safeParse({ resource: 'node', id: SERVER_ID }).success).toBe(false);
  });
});

describe('Client-Frames des Live-Kanals (Audit contracts-validation-04)', () => {
  it.each(['subscribe', 'unsubscribe'] as const)('nimmt %s an', (kind) => {
    expect(liveClientFrameSchema.parse({ kind, topic: TOPIC })).toEqual({ kind, topic: TOPIC });
  });

  it('nimmt einen Konsolenbefehl an und trimmt ihn wie der REST-Pfad', () => {
    expect(
      liveClientFrameSchema.parse({ kind: 'consoleCommand', topic: TOPIC, command: '  list  ' }),
    ).toEqual({ kind: 'consoleCommand', topic: TOPIC, command: 'list' });
  });

  it('lehnt eine unbekannte Frame-Art und ein fehlendes Thema ab', () => {
    expect(liveClientFrameSchema.safeParse({ kind: 'ping', topic: TOPIC }).success).toBe(false);
    expect(liveClientFrameSchema.safeParse({ kind: 'subscribe' }).success).toBe(false);
  });

  it('hält am Konsolenbefehl dieselbe Grenze wie der REST-Pfad', () => {
    // Genau die Lücke des Audits: über den Live-Kanal lief bisher jeder
    // beliebig lange, mehrzeilige „Befehl" bis in EXEC_CONSOLE durch.
    const zuLang = { kind: 'consoleCommand', topic: TOPIC, command: 'a'.repeat(513) };
    const mehrzeilig = { kind: 'consoleCommand', topic: TOPIC, command: 'say hallo\nstop' };
    const leer = { kind: 'consoleCommand', topic: TOPIC, command: '   ' };

    expect(liveClientFrameSchema.safeParse(zuLang).success).toBe(false);
    expect(liveClientFrameSchema.safeParse(mehrzeilig).success).toBe(false);
    expect(liveClientFrameSchema.safeParse(leer).success).toBe(false);
  });
});
