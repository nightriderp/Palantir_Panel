import { createPortRangeInputSchema, updatePortRangeInputSchema } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import { createAuditService } from './audit.js';
import { createPortPoolService, rangesOverlap } from './ports.js';
import {
  SERVER_ID,
  actorWith,
  createFakeAuditRepository,
  createFakePortPoolRepository,
  ctxWith,
  portRange,
} from './test-support.js';

function build(
  ranges = [portRange()],
  allocations: Parameters<typeof createFakePortPoolRepository>[1] = [],
) {
  const auditRepository = createFakeAuditRepository();
  const repository = createFakePortPoolRepository(ranges, allocations);
  const service = createPortPoolService({
    repository,
    audit: createAuditService(auditRepository),
  });

  return { service, repository, auditRepository };
}

const adminCtx = () => ctxWith(actorWith('address.manage'));

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
