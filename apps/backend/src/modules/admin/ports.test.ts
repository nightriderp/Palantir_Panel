import { createPortRangeInputSchema, updatePortRangeInputSchema } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import { createAuditService } from './audit.js';
import { type PortRangeLimits, createPortPoolService, rangesOverlap } from './ports.js';
import {
  NODE_ID,
  SERVER_ID,
  actorWith,
  createFakeAuditRepository,
  createFakePortPoolRepository,
  ctxWith,
  portRange,
} from './test-support.js';

/** Eine andere Node als {@link NODE_ID} – für die Bindungsprüfung (Audit W3-6). */
const FREMDE_NODE_ID = '44444444-4444-4444-8444-444444444444';

function build(
  ranges = [portRange()],
  allocations: Parameters<typeof createFakePortPoolRepository>[1] = [],
  limits?: PortRangeLimits,
) {
  const auditRepository = createFakeAuditRepository();
  const repository = createFakePortPoolRepository(ranges, allocations);
  const service = createPortPoolService({
    repository,
    audit: createAuditService(auditRepository),
    ...(limits ? { limits } : {}),
  });

  return { service, repository, auditRepository };
}

/** Der Tunnel des Betriebs: 25000–25564 getunnelt, 25565 gehört dem Router. */
const TUNNEL: PortRangeLimits = { tunnelStart: 25_000, tunnelEnd: 25_564, routerPort: 25_565 };

const adminCtx = () => ctxWith(actorWith('address.manage'));

describe('Port-Bereiche gegen Tunnel und Router (Befund 4.3)', () => {
  const eingabe = (startPort: number, endPort: number) =>
    createPortRangeInputSchema.parse({ label: 'Probe', startPort, endPort, protocol: 'tcp' });

  it('nimmt einen Bereich innerhalb der getunnelten Ports an', async () => {
    const { service } = build([], [], TUNNEL);

    await expect(service.createRange(adminCtx(), eingabe(25_100, 25_200))).resolves.toMatchObject({
      startPort: 25_100,
      endPort: 25_200,
    });
  });

  it('lehnt einen Bereich ab, der aus dem Tunnel herausragt – und sagt warum', async () => {
    const { service } = build([], [], TUNNEL);

    await expect(service.createRange(adminCtx(), eingabe(24_990, 25_100))).rejects.toMatchObject({
      code: 'PORT_RANGE_INVALID',
      message: expect.stringContaining('25000–25564'),
    });
    await expect(service.createRange(adminCtx(), eingabe(30_000, 30_100))).rejects.toMatchObject({
      code: 'PORT_RANGE_INVALID',
      message: expect.stringContaining('GAME_PORT_RANGE_START/END'),
    });
  });

  it('lehnt einen Bereich ab, der den Router-Port enthält', async () => {
    // Der Router-Port liegt hier bewusst innerhalb des Tunnels, damit allein
    // die Router-Prüfung greift.
    const { service } = build([], [], {
      tunnelStart: 25_000,
      tunnelEnd: 26_000,
      routerPort: 25_565,
    });

    await expect(service.createRange(adminCtx(), eingabe(25_500, 25_600))).rejects.toMatchObject({
      code: 'PORT_RANGE_INVALID',
      message: expect.stringContaining('MINECRAFT_ROUTER_PORT'),
    });
    await expect(service.createRange(adminCtx(), eingabe(25_565, 25_565))).rejects.toMatchObject({
      code: 'PORT_RANGE_INVALID',
    });
  });

  it('prüft auch das Ändern eines Bereichs gegen den Tunnel', async () => {
    const bestehend = portRange({ startPort: 25_100, endPort: 25_200, protocol: 'tcp' });
    const { service } = build([bestehend], [], TUNNEL);

    await expect(
      service.updateRange(
        adminCtx(),
        bestehend.id,
        updatePortRangeInputSchema.parse({ startPort: 25_100, endPort: 25_600 }),
      ),
    ).rejects.toMatchObject({ code: 'PORT_RANGE_INVALID' });
  });

  it('ohne Grenzen gilt weiter nur 1024–65535', async () => {
    const { service } = build([]);

    await expect(service.createRange(adminCtx(), eingabe(30_000, 30_100))).resolves.toMatchObject({
      startPort: 30_000,
    });
  });
});

describe('Port-Bereiche (Pflichtenheft §2.4)', () => {
  it('erkennt Überschneidungen nur innerhalb desselben Protokolls', () => {
    const udp = portRange({ startPort: 27_000, endPort: 27_100, protocol: 'udp' });

    expect(
      rangesOverlap(udp, portRange({ startPort: 27_050, endPort: 27_150, protocol: 'udp' })),
    ).toBe(true);
    expect(
      rangesOverlap(udp, portRange({ startPort: 27_050, endPort: 27_150, protocol: 'tcp' })),
    ).toBe(false);
    expect(
      rangesOverlap(udp, portRange({ startPort: 27_101, endPort: 27_200, protocol: 'udp' })),
    ).toBe(false);
  });

  it('lehnt einen überschneidenden Bereich ab', async () => {
    const { service } = build();
    const input = createPortRangeInputSchema.parse({
      label: 'Zweiter Bereich',
      startPort: 27_002,
      endPort: 27_100,
      protocol: 'udp',
    });

    await expect(service.createRange(adminCtx(), input)).rejects.toMatchObject({
      code: 'PORT_RANGE_OVERLAP',
    });
  });

  it('nimmt denselben Bereich für das andere Protokoll an', async () => {
    const { service, auditRepository } = build();
    const input = createPortRangeInputSchema.parse({
      label: 'TCP-Bereich',
      startPort: 27_000,
      endPort: 27_002,
      protocol: 'tcp',
    });

    const range = await service.createRange(adminCtx(), input);

    expect(range.protocol).toBe('tcp');
    expect(range.totalPorts).toBe(3);
    expect(auditRepository.rows.map((row) => row.action)).toEqual(['address.rangeCreated']);
  });

  it('lehnt jede Bereichsverwaltung ohne address.manage ab', async () => {
    const { service } = build();

    await expect(service.getPool(ctxWith(actorWith('node.manage')))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('gibt einen Bereich mit vergebenen Ports nicht zum Löschen frei', async () => {
    const { service } = build(
      [portRange()],
      [
        {
          id: 'allocation-1',
          rangeId: 'range-1',
          port: 27_000,
          protocol: 'udp',
          serverId: SERVER_ID,
          allocatedAt: new Date('2026-08-26T10:00:00.000Z'),
        },
      ],
    );

    const pool = await service.getPool(adminCtx());

    expect(pool.ranges[0]?.permissions.canDelete).toBe(false);
    await expect(service.removeRange(adminCtx(), 'range-1')).rejects.toMatchObject({
      code: 'PORT_RANGE_IN_USE',
    });
  });

  it('lehnt ein Verkleinern ab, das einen vergebenen Port herausfallen ließe', async () => {
    const { service } = build(
      [portRange()],
      [
        {
          id: 'allocation-1',
          rangeId: 'range-1',
          port: 27_002,
          protocol: 'udp',
          serverId: SERVER_ID,
          allocatedAt: new Date('2026-08-26T10:00:00.000Z'),
        },
      ],
    );

    await expect(
      service.updateRange(
        adminCtx(),
        'range-1',
        updatePortRangeInputSchema.parse({ endPort: 27_001 }),
      ),
    ).rejects.toMatchObject({ code: 'PORT_RANGE_IN_USE' });
  });

  it('rechnet den Pool über alle Bereiche zusammen', async () => {
    const { service } = build([
      portRange({ id: 'range-1', startPort: 27_000, endPort: 27_009 }),
      portRange({ id: 'range-2', startPort: 28_000, endPort: 28_004, protocol: 'tcp' }),
    ]);

    const pool = await service.getPool(adminCtx());

    expect(pool.totalPorts).toBe(15);
    expect(pool.allocatedPorts).toBe(0);
    expect(pool.availablePorts).toBe(15);
  });
});

describe('Port-Zuordnung zu Servern (Pflichtenheft §2.4)', () => {
  it('vergibt den niedrigsten freien Port', async () => {
    const { service } = build();

    const [first] = await service.allocateForServer(SERVER_ID, [{ protocol: 'udp', count: 1 }]);

    expect(first?.port).toBe(27_000);
  });

  it('vergibt denselben Port nicht zweimal', async () => {
    const { service } = build();

    const allocations = await service.allocateForServer(SERVER_ID, [{ protocol: 'udp', count: 3 }]);

    expect(allocations.map((allocation) => allocation.port)).toEqual([27_000, 27_001, 27_002]);
  });

  it('meldet einen erschöpften Pool mit PORT_POOL_EXHAUSTED', async () => {
    const { service } = build();

    await expect(
      service.allocateForServer(SERVER_ID, [{ protocol: 'udp', count: 4 }]),
    ).rejects.toMatchObject({ code: 'PORT_POOL_EXHAUSTED' });
  });

  /*
   * PORT_POOL_EXHAUSTED nur bei echter Erschöpfung (Audit W3-6,
   * backend-admin-resources-17). Vorher trug auch ein Insert ohne Rückgabezeile
   * – praktisch ein Treiberdefekt – diesen Code; der Betreiber vergrößerte
   * daraufhin den Bereich, obwohl das Problem woanders lag.
   */
  it('gibt einem anderen Fehler bei der Vergabe seinen eigenen Code', async () => {
    const { service, repository } = build();

    repository.insertAllocation = async () => {
      throw new Error('Port-Zuordnung konnte nicht angelegt werden.');
    };

    const fehler = await service
      .allocateForServer(SERVER_ID, [{ protocol: 'udp', count: 1 }])
      .catch((error: unknown) => error);

    expect(fehler).toBeInstanceOf(Error);
    expect((fehler as Error).message).toBe('Port-Zuordnung konnte nicht angelegt werden.');
    // Vor allem: kein Fachcode, der eine falsche Fährte legt.
    expect(fehler).not.toMatchObject({ code: 'PORT_POOL_EXHAUSTED' });
  });

  /*
   * Vergabe ohne Node-Angabe (Audit W3-6, backend-admin-resources-09).
   *
   * Ein gebundener Bereich ist die Zusage „diese Ports gehören Node A". Wer
   * ohne Node vergibt, kann sie nicht einhalten – vorher galt genau umgekehrt
   * „keine Angabe = alle Bindungen ignorieren".
   */
  it('greift ohne Node-Angabe nicht in einen gebundenen Bereich', async () => {
    const { service } = build([
      portRange({ id: 'range-node', startPort: 27_000, endPort: 27_002, nodeId: NODE_ID }),
      portRange({ id: 'range-frei', startPort: 28_000, endPort: 28_002, nodeId: null }),
    ]);

    const [allocation] = await service.allocateForServer(SERVER_ID, [
      { protocol: 'udp', count: 1 },
    ]);

    expect(allocation?.rangeId).toBe('range-frei');
    expect(allocation?.port).toBe(28_000);
  });

  it('meldet ohne Node-Angabe Erschöpfung, wenn nur gebundene Bereiche übrig sind', async () => {
    const { service } = build([
      portRange({ id: 'range-node', startPort: 27_000, endPort: 27_002, nodeId: NODE_ID }),
    ]);

    await expect(
      service.allocateForServer(SERVER_ID, [{ protocol: 'udp', count: 1 }]),
    ).rejects.toMatchObject({ code: 'PORT_POOL_EXHAUSTED' });
  });

  it('nimmt mit Node-Angabe den eigenen gebundenen Bereich vor dem ungebundenen', async () => {
    const { service } = build([
      portRange({ id: 'range-node', startPort: 27_000, endPort: 27_002, nodeId: NODE_ID }),
      portRange({ id: 'range-frei', startPort: 28_000, endPort: 28_002, nodeId: null }),
    ]);

    const [allocation] = await service.allocateForServer(SERVER_ID, [
      { protocol: 'udp', count: 1, nodeId: NODE_ID },
    ]);

    expect(allocation?.rangeId).toBe('range-node');
  });

  it('lässt mit Node-Angabe den Bereich einer fremden Node aus', async () => {
    const { service } = build([
      portRange({ id: 'range-node', startPort: 27_000, endPort: 27_002, nodeId: NODE_ID }),
      portRange({ id: 'range-frei', startPort: 28_000, endPort: 28_002, nodeId: null }),
    ]);

    const [allocation] = await service.allocateForServer(SERVER_ID, [
      { protocol: 'udp', count: 1, nodeId: FREMDE_NODE_ID },
    ]);

    expect(allocation?.rangeId).toBe('range-frei');
  });

  it('weicht bei einem Vergabe-Rennen auf den nächsten freien Port aus', async () => {
    const { service, repository } = build();
    const original = repository.insertAllocation.bind(repository);
    let ersterVersuch = true;

    // Simuliert, dass eine parallele Vergabe den zuerst gewählten Port 27_000
    // zwischen Auswahl und Insert belegt hat: Der erste Insert kollidiert
    // (SQLSTATE 23505), danach läuft alles normal.
    repository.insertAllocation = async (data) => {
      if (ersterVersuch) {
        ersterVersuch = false;
        const fehler = new Error('Kollision') as Error & { code?: string };
        fehler.code = '23505';
        throw fehler;
      }
      return original(data);
    };

    const [allocation] = await service.allocateForServer(SERVER_ID, [
      { protocol: 'udp', count: 1 },
    ]);

    // Statt eines rohen 500 wird der nächste freie Port vergeben.
    expect(allocation?.port).toBe(27_001);
    expect(repository.allocations).toHaveLength(1);
  });

  it('nimmt bei einem Fehler mitten in der Vergabe bereits belegte Ports zurück', async () => {
    const { service, repository } = build();
    const original = repository.insertAllocation.bind(repository);
    let aufrufe = 0;

    // Der zweite Port scheitert an einem nicht auflösbaren Fehler – der erste
    // bereits eingefügte Port darf nicht als verwaiste Zuordnung zurückbleiben.
    repository.insertAllocation = async (data) => {
      aufrufe += 1;
      if (aufrufe === 2) {
        throw new Error('Datenbank weg');
      }
      return original(data);
    };

    await expect(
      service.allocateForServer(SERVER_ID, [{ protocol: 'udp', count: 2 }]),
    ).rejects.toThrow('Datenbank weg');
    expect(repository.allocations).toHaveLength(0);
  });

  it('übergeht deaktivierte Bereiche bei der Vergabe', async () => {
    const { service } = build([
      portRange({ id: 'range-1', startPort: 27_000, endPort: 27_002, enabled: false }),
      portRange({ id: 'range-2', startPort: 28_000, endPort: 28_002 }),
    ]);

    const [allocation] = await service.allocateForServer(SERVER_ID, [
      { protocol: 'udp', count: 1 },
    ]);

    expect(allocation?.port).toBe(28_000);
  });

  it('gibt beim Löschen eines Servers alle seine Ports frei', async () => {
    const { service, repository, auditRepository } = build();

    await service.allocateForServer(SERVER_ID, [{ protocol: 'udp', count: 2 }]);
    const released = await service.releaseForServer(SERVER_ID);

    expect(released).toBe(2);
    expect(repository.allocations).toHaveLength(0);
    expect(auditRepository.rows.map((row) => row.action)).toEqual([
      'address.portAllocated',
      'address.portReleased',
    ]);
  });

  it('lässt eine Zuordnung mit Server nicht von Hand freigeben', async () => {
    const { service, repository } = build();

    const [allocation] = await service.allocateForServer(SERVER_ID, [
      { protocol: 'udp', count: 1 },
    ]);

    await expect(service.releaseAllocation(adminCtx(), allocation?.id ?? '')).rejects.toMatchObject(
      {
        code: 'PORT_RANGE_IN_USE',
      },
    );
    expect(repository.allocations).toHaveLength(1);
  });

  it('gibt eine verwaiste Zuordnung frei', async () => {
    const { service, repository } = build(
      [portRange()],
      [
        {
          id: 'allocation-1',
          rangeId: 'range-1',
          port: 27_000,
          protocol: 'udp',
          serverId: null,
          allocatedAt: new Date('2026-08-26T10:00:00.000Z'),
        },
      ],
    );

    const [allocation] = await service.listAllocations(adminCtx());

    expect(allocation?.permissions.canRelease).toBe(true);

    await service.releaseAllocation(adminCtx(), 'allocation-1');

    expect(repository.allocations).toHaveLength(0);
  });

  it('meldet eine unbekannte Zuordnung mit PORT_ALLOCATION_NOT_FOUND', async () => {
    const { service } = build();

    await expect(service.releaseAllocation(adminCtx(), 'allocation-99')).rejects.toMatchObject({
      code: 'PORT_ALLOCATION_NOT_FOUND',
    });
  });
});

/**
 * Bindung an eine Node – die Auskunft, die die Node-Verwaltung vor dem Löschen
 * braucht (Audit W3-6, backend-admin-resources-08).
 */
describe('Node-gebundene Bereiche', () => {
  it('nennt je gebundenem Bereich die Zahl der vergebenen Ports', async () => {
    const { service } = build(
      [
        portRange({ id: 'range-node', label: 'Node-Bereich', nodeId: NODE_ID }),
        portRange({ id: 'range-frei', startPort: 28_000, endPort: 28_002, nodeId: null }),
      ],
      [
        {
          id: 'allocation-1',
          rangeId: 'range-node',
          port: 27_000,
          protocol: 'udp',
          serverId: SERVER_ID,
          allocatedAt: new Date('2026-08-26T10:00:00.000Z'),
        },
      ],
    );

    expect(await service.listNodeBindings(NODE_ID)).toEqual([
      { id: 'range-node', label: 'Node-Bereich', allocatedPorts: 1 },
    ]);
    // Ungebundene Bereiche gehören keiner Node – auch nicht dieser.
    expect(await service.listNodeBindings(FREMDE_NODE_ID)).toEqual([]);
  });

  it('räumt einen leeren gebundenen Bereich und protokolliert den Anlass', async () => {
    const { service, repository, auditRepository } = build([
      portRange({ id: 'range-node', label: 'Node-Bereich', nodeId: NODE_ID }),
    ]);

    await service.removeNodeBinding(adminCtx(), 'range-node');

    expect(repository.ranges).toHaveLength(0);
    expect(auditRepository.rows.map((row) => row.action)).toEqual(['address.rangeDeleted']);
    expect(auditRepository.rows[0]?.metadata).toMatchObject({ reason: 'nodeDeleted' });
  });

  it('räumt keinen Bereich, aus dem noch Ports vergeben sind', async () => {
    const { service, repository } = build(
      [portRange({ id: 'range-node', nodeId: NODE_ID })],
      [
        {
          id: 'allocation-1',
          rangeId: 'range-node',
          port: 27_000,
          protocol: 'udp',
          serverId: SERVER_ID,
          allocatedAt: new Date('2026-08-26T10:00:00.000Z'),
        },
      ],
    );

    await expect(service.removeNodeBinding(adminCtx(), 'range-node')).rejects.toMatchObject({
      code: 'PORT_RANGE_IN_USE',
    });
    expect(repository.ranges).toHaveLength(1);
  });
});

/**
 * Eine Nummer fuer beide Protokolle (`protocol: 'both'`).
 *
 * Satisfactory und 7 Days to Die leiten die zweite Adresse aus der ersten ab,
 * statt sie zu erfragen. Zwei getrennte Anfragen bekaemen zwei verschiedene
 * Nummern - deshalb sucht der Pool hier eine, die in beiden Bereichen frei ist.
 */
describe('Port-Paare fuer beide Protokolle', () => {
  const beideBereiche = () => [
    portRange({ id: 'tcp-1', protocol: 'tcp', startPort: 27_000, endPort: 27_002 }),
    portRange({ id: 'udp-1', protocol: 'udp', startPort: 27_000, endPort: 27_002 }),
  ];

  it('vergibt dieselbe Nummer zweimal - einmal je Protokoll', async () => {
    const { service } = build(beideBereiche());

    const vergeben = await service.allocateForServer(SERVER_ID, [{ protocol: 'both', count: 1 }]);

    expect(vergeben).toHaveLength(2);
    expect(vergeben.map((eintrag) => eintrag.port)).toEqual([27_000, 27_000]);
    expect(vergeben.map((eintrag) => eintrag.protocol).sort()).toEqual(['tcp', 'udp']);
  });

  it('ueberspringt eine Nummer, die auch nur in einem Protokoll belegt ist', async () => {
    // Der haeufige Fall: Ein anderer Server hat 27000 als UDP. Die Nummer ist
    // damit fuer ein Paar verbraucht, obwohl TCP frei waere.
    const { service } = build(beideBereiche(), [
      {
        id: 'zuordnung-fremd',
        rangeId: 'udp-1',
        port: 27_000,
        protocol: 'udp',
        serverId: 'fremd',
        allocatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);

    const vergeben = await service.allocateForServer(SERVER_ID, [{ protocol: 'both', count: 1 }]);

    expect(vergeben.map((eintrag) => eintrag.port)).toEqual([27_001, 27_001]);
  });

  it('vergibt mehrere Paare ohne Ueberschneidung', async () => {
    const { service } = build(beideBereiche());

    const vergeben = await service.allocateForServer(SERVER_ID, [{ protocol: 'both', count: 2 }]);

    expect([...new Set(vergeben.map((eintrag) => eintrag.port))]).toEqual([27_000, 27_001]);
    expect(vergeben).toHaveLength(4);
  });

  it('findet nichts, wenn es ueber dem Zahlenraum keinen zweiten Bereich gibt', async () => {
    // Eine Nummer zu vergeben, die nur halb existiert, waere eine Zusage, die
    // niemand einhalten kann.
    const { service } = build([portRange({ id: 'udp-1', protocol: 'udp' })]);

    await expect(
      service.allocateForServer(SERVER_ID, [{ protocol: 'both', count: 1 }]),
    ).rejects.toMatchObject({ code: 'PORT_POOL_EXHAUSTED' });
  });
});
