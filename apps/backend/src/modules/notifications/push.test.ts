import { describe, expect, it, vi } from 'vitest';
import {
  type PushMessage,
  type PushOutcome,
  type PushSubscriptionRecord,
  type PushSubscriptionStore,
  sendToUser,
  toPushConfigDto,
} from './push.js';

/**
 * Geprüft wird die Regel, die diese Datei aufstellt: Was passiert mit einem
 * Abonnement, je nachdem wie der Zustelldienst antwortet. Die Verschlüsselung
 * selbst gehört `web-push` (siehe `web-push.ts`).
 */

function abo(endpoint: string): PushSubscriptionRecord {
  return {
    id: `id-${endpoint}`,
    userId: 'konto-1',
    endpoint,
    p256dh: 'schluessel',
    auth: 'geheim',
  };
}

function store(abos: PushSubscriptionRecord[]): PushSubscriptionStore & {
  entfernt: string[];
  benutzt: string[];
} {
  const entfernt: string[] = [];
  const benutzt: string[] = [];

  return {
    entfernt,
    benutzt,
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    removeByEndpoint: async (endpoint) => {
      entfernt.push(endpoint);
    },
    listForUser: async () => abos,
    markUsed: async (endpoint) => {
      benutzt.push(endpoint);
    },
  };
}

const meldung: PushMessage = {
  title: 'Server gestartet',
  body: 'Survival läuft wieder.',
  url: '/notifications',
  tag: 'server-1',
};

describe('sendToUser', () => {
  it('schickt an jedes Gerät und merkt sich die Benutzung', async () => {
    const ablage = store([abo('https://a.example/1'), abo('https://b.example/2')]);
    const sender = { send: async (): Promise<PushOutcome> => 'sent' };

    const ergebnis = await sendToUser({ store: ablage, sender }, 'konto-1', meldung);

    expect(ergebnis).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(ablage.benutzt).toEqual(['https://a.example/1', 'https://b.example/2']);
  });

  it('entfernt ein Abonnement, das der Zustelldienst nicht mehr kennt', async () => {
    const ablage = store([abo('https://weg.example/1')]);
    const sender = { send: async (): Promise<PushOutcome> => 'gone' };

    const ergebnis = await sendToUser({ store: ablage, sender }, 'konto-1', meldung);

    // Ein abgemeldetes Gerät ist kein Fehler – es ist ein abgemeldetes Gerät.
    expect(ergebnis).toEqual({ sent: 0, removed: 1, failed: 0 });
    expect(ablage.entfernt).toEqual(['https://weg.example/1']);
  });

  it('lässt ein Abonnement stehen, wenn der Versuch nur scheitert', async () => {
    const ablage = store([abo('https://a.example/1')]);
    const sender = { send: async (): Promise<PushOutcome> => 'failed' };

    const ergebnis = await sendToUser({ store: ablage, sender }, 'konto-1', meldung);

    expect(ergebnis).toEqual({ sent: 0, removed: 0, failed: 1 });
    expect(ablage.entfernt).toEqual([]);
  });

  it('ein gescheitertes Gerät hält die anderen nicht auf', async () => {
    const ablage = store([abo('https://a.example/1'), abo('https://b.example/2')]);
    const sender = {
      send: async (subscription: PushSubscriptionRecord): Promise<PushOutcome> =>
        subscription.endpoint.includes('a.example') ? 'failed' : 'sent',
    };

    const ergebnis = await sendToUser({ store: ablage, sender }, 'konto-1', meldung);

    expect(ergebnis).toEqual({ sent: 1, removed: 0, failed: 1 });
    expect(ablage.benutzt).toEqual(['https://b.example/2']);
  });

  it('kommt ohne Geräte klar', async () => {
    const ablage = store([]);
    const sender = { send: vi.fn(async (): Promise<PushOutcome> => 'sent') };

    expect(await sendToUser({ store: ablage, sender }, 'konto-1', meldung)).toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    });
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe('toPushConfigDto', () => {
  it('meldet „nicht eingerichtet" ohne Schlüssel', () => {
    expect(toPushConfigDto(undefined)).toEqual({ publicKey: null });
    // Eine leere Variable in der .env ist dasselbe wie keine.
    expect(toPushConfigDto('')).toEqual({ publicKey: null });
  });

  it('reicht den öffentlichen Schlüssel durch', () => {
    expect(toPushConfigDto('BAB…')).toEqual({ publicKey: 'BAB…' });
  });
});
