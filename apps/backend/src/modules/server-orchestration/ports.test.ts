/**
 * Tests der Portzuweisung (Pflichtenheft §2.4).
 *
 * Geprüft wird die Übersetzung zwischen Spiele-Definition und dem Port-Pool aus
 * B8 – nicht der Pool selbst, der hat seine eigenen Tests in `modules/admin`.
 */

import { type GameTypeDefinition } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type ServerOrchestrationError } from './errors.js';
import { TEST_GAME_TYPE } from './game-registry.js';
import { type PortPoolPort, createPortAllocator, visiblePortOf } from './ports.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

const TWO_PORT_GAME: GameTypeDefinition = {
  ...TEST_GAME_TYPE,
  ports: [
    { containerPort: 8080, protocol: 'tcp', primary: true, label: 'Spiel-Port' },
    { containerPort: 8081, protocol: 'udp', primary: false, label: 'Query' },
  ],
};

const ROUTED_GAME: GameTypeDefinition = {
  ...TWO_PORT_GAME,
  supportsVirtualHostRouting: true,
};

interface Recorded {
  readonly serverId: string;
  readonly requests: readonly {
    protocol: 'tcp' | 'udp' | 'both';
    count: number;
    nodeId?: string | null;
  }[];
}

/** Pool, der ab `nextPort` fortlaufend vergibt und die Anfragen mitschreibt. */
function fakePool(options: { nextPort?: number; exhausted?: boolean } = {}): {
  pool: PortPoolPort;
  calls: Recorded[];
  released: string[];
} {
  const calls: Recorded[] = [];
  const released: string[] = [];
  let next = options.nextPort ?? 27_000;

  return {
    calls,
    released,
    pool: {
      allocateForServer(serverId, requests) {
        calls.push({ serverId, requests });

        if (options.exhausted === true) {
          return Promise.resolve([]);
        }

        const allocated: { port: number; protocol: 'tcp' | 'udp' }[] = [];

        for (const request of requests) {
          for (let i = 0; i < request.count; i += 1) {
            if (request.protocol === 'both') {
              // Wie der echte Pool: eine Nummer, zwei Zeilen.
              const nummer = next++;
              allocated.push({ port: nummer, protocol: 'tcp' });
              allocated.push({ port: nummer, protocol: 'udp' });
              continue;
            }

            allocated.push({ port: next++, protocol: request.protocol });
          }
        }

        return Promise.resolve(allocated);
      },
      releaseForServer(serverId) {
        released.push(serverId);

        return Promise.resolve(1);
      },
    },
  };
}

describe('Portzuweisung über den Pool aus B8', () => {
  it('fragt genau so viele Ports an, wie die Definition braucht', async () => {
    const { pool, calls } = fakePool();

    await createPortAllocator(pool).allocate(SERVER_ID, TWO_PORT_GAME, { nodeId: NODE_ID });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.serverId).toBe(SERVER_ID);
    expect(calls[0]?.requests).toEqual([
      { protocol: 'tcp', count: 1, nodeId: NODE_ID },
      { protocol: 'udp', count: 1, nodeId: NODE_ID },
    ]);
  });

  it('bündelt mehrere Ports desselben Protokolls in eine Anfrage', async () => {
    // Sonst müsste B8 die Belegung je Port erneut laden.
    const definition: GameTypeDefinition = {
      ...TEST_GAME_TYPE,
      ports: [
        { containerPort: 1, protocol: 'tcp', primary: true, label: 'A' },
        { containerPort: 2, protocol: 'tcp', primary: false, label: 'B' },
        { containerPort: 3, protocol: 'tcp', primary: false, label: 'C' },
      ],
    };

    const { pool, calls } = fakePool();

    await createPortAllocator(pool).allocate(SERVER_ID, definition, { nodeId: NODE_ID });

    expect(calls[0]?.requests).toEqual([{ protocol: 'tcp', count: 3, nodeId: NODE_ID }]);
  });

  it('übernimmt Protokoll, Container-Port und Beschriftung aus der Definition', async () => {
    const { pool } = fakePool();
    const assignments = await createPortAllocator(pool).allocate(SERVER_ID, TWO_PORT_GAME, {
      nodeId: NODE_ID,
    });

    expect(assignments[0]).toEqual({
      publicPort: 27_000,
      containerPort: 8080,
      protocol: 'tcp',
      label: 'Spiel-Port',
      primary: true,
    });
    expect(assignments[1]).toMatchObject({ containerPort: 8081, protocol: 'udp', primary: false });
  });

  it('behält die Reihenfolge der Definition bei', async () => {
    const { pool } = fakePool();
    const assignments = await createPortAllocator(pool).allocate(SERVER_ID, TWO_PORT_GAME, {
      nodeId: NODE_ID,
    });

    expect(assignments.map((a) => a.containerPort)).toEqual([8080, 8081]);
  });

  it('meldet PORT_POOL_EXHAUSTED, wenn der Pool zu wenige Ports liefert', async () => {
    // Sonst stünde eine halbe Portzuweisung in der Datenbank.
    const { pool } = fakePool({ exhausted: true });

    try {
      await createPortAllocator(pool).allocate(SERVER_ID, TWO_PORT_GAME, { nodeId: NODE_ID });
      expect.unreachable('Die Zuweisung hätte scheitern müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('PORT_POOL_EXHAUSTED');
    }
  });

  it('gibt die Ports eines Servers wieder frei', async () => {
    const { pool, released } = fakePool();

    await createPortAllocator(pool).release(SERVER_ID);

    expect(released).toEqual([SERVER_ID]);
  });
});

describe('Hostname-Routing (Pflichtenheft §2.4, §13)', () => {
  it('nimmt für den primären Port keinen Port aus dem Pool', async () => {
    const { pool, calls } = fakePool();
    const assignments = await createPortAllocator(pool).allocate(SERVER_ID, ROUTED_GAME, {
      nodeId: NODE_ID,
      virtualHostPort: 25_565,
    });

    expect(assignments[0]).toMatchObject({ publicPort: 25_565, primary: true });
    // Nur der Nebenport wird angefragt.
    expect(calls[0]?.requests).toEqual([{ protocol: 'udp', count: 1, nodeId: NODE_ID }]);
  });

  it('fragt den Pool gar nicht, wenn alle Ports geteilt sind', async () => {
    const definition: GameTypeDefinition = {
      ...TEST_GAME_TYPE,
      supportsVirtualHostRouting: true,
    };

    const { pool, calls } = fakePool();

    await createPortAllocator(pool).allocate(SERVER_ID, definition, {
      nodeId: NODE_ID,
      virtualHostPort: 25_565,
    });

    expect(calls).toEqual([]);
  });

  it('nutzt den Pool, wenn kein Routing-Port angegeben ist', async () => {
    const { pool } = fakePool();
    const assignments = await createPortAllocator(pool).allocate(SERVER_ID, ROUTED_GAME, {
      nodeId: NODE_ID,
      virtualHostPort: null,
    });

    expect(assignments[0]?.publicPort).toBe(27_000);
  });
});

describe('visiblePortOf() (Pflichtenheft §13)', () => {
  it('liefert den primären Port bei Spielen mit sichtbarem Port', async () => {
    const { pool } = fakePool();
    const assignments = await createPortAllocator(pool).allocate(SERVER_ID, TWO_PORT_GAME, {
      nodeId: NODE_ID,
    });

    expect(visiblePortOf(assignments, false)).toBe(27_000);
  });

  it('liefert null bei Hostname-Routing – der Spieler sieht keinen Port', async () => {
    const { pool } = fakePool();
    const assignments = await createPortAllocator(pool).allocate(SERVER_ID, ROUTED_GAME, {
      nodeId: NODE_ID,
      virtualHostPort: 25_565,
    });

    expect(visiblePortOf(assignments, true)).toBeNull();
  });

  it('liefert null ohne Portzuweisung', () => {
    expect(visiblePortOf([], false)).toBeNull();
  });
});

/**
 * Ein Port, der beide Protokolle traegt (Satisfactory, 7 Days to Die).
 *
 * Diese Spiele leiten die zweite Adresse aus der ersten ab, statt sie zu
 * erfragen: Zwei getrennte Eintraege bekaemen zwei verschiedene Nummern, und
 * damit braeche das Beitreten.
 */
describe('Ein Port fuer beide Protokolle', () => {
  const BEIDE: GameTypeDefinition = {
    ...TEST_GAME_TYPE,
    ports: [{ containerPort: 7777, protocol: 'both', primary: true, label: 'Spiel-Port' }],
  };

  it('fragt den Pool getrennt nach dem Paar', async () => {
    const { pool, calls } = fakePool();

    await createPortAllocator(pool).allocate(SERVER_ID, BEIDE, { nodeId: NODE_ID });

    // Eine Anfrage, und zwar mit `both` - der Pool sucht dann eine Nummer, die
    // in beiden Bereichen frei ist.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.requests).toEqual([{ protocol: 'both', count: 1, nodeId: NODE_ID }]);
  });

  it('macht daraus zwei Zuweisungen mit derselben Nummer', async () => {
    const { pool } = fakePool({ nextPort: 25_000 });

    const zuweisungen = await createPortAllocator(pool).allocate(SERVER_ID, BEIDE, {
      nodeId: NODE_ID,
    });

    expect(zuweisungen).toHaveLength(2);
    expect(zuweisungen.map((z) => z.protocol).sort()).toEqual(['tcp', 'udp']);
    expect(new Set(zuweisungen.map((z) => z.publicPort))).toEqual(new Set([25_000]));
    expect(new Set(zuweisungen.map((z) => z.containerPort))).toEqual(new Set([7777]));
  });

  it('haelt an genau einem primaeren Port fest', async () => {
    // Fuer die angezeigte Adresse ist es einerlei - beide tragen dieselbe
    // Nummer. Fuer jeden Code, der den primaeren Port sucht, ist es das nicht.
    const { pool } = fakePool();

    const zuweisungen = await createPortAllocator(pool).allocate(SERVER_ID, BEIDE, {
      nodeId: NODE_ID,
    });

    expect(zuweisungen.filter((z) => z.primary)).toHaveLength(1);
  });

  it('mischt sich nicht mit den einfachen Ports', async () => {
    const gemischt: GameTypeDefinition = {
      ...TEST_GAME_TYPE,
      ports: [
        { containerPort: 7777, protocol: 'both', primary: true, label: 'Spiel-Port' },
        { containerPort: 15_000, protocol: 'udp', primary: false, label: 'Abfrage' },
      ],
    };
    const { pool, calls } = fakePool({ nextPort: 25_000 });

    const zuweisungen = await createPortAllocator(pool).allocate(SERVER_ID, gemischt, {
      nodeId: NODE_ID,
    });

    // Zwei Aufrufe: erst die einfachen, dann das Paar. Im selben Rutsch liesse
    // sich nicht mehr sagen, welche Zeilen zusammengehoeren.
    expect(calls).toHaveLength(2);
    expect(zuweisungen).toHaveLength(3);

    const paar = zuweisungen.filter((z) => z.containerPort === 7777);
    expect(new Set(paar.map((z) => z.publicPort)).size).toBe(1);
    // Und der einfache Port hat eine andere Nummer bekommen.
    expect(zuweisungen.find((z) => z.containerPort === 15_000)?.publicPort).not.toBe(
      paar[0]?.publicPort,
    );
  });
});
