import { createHostNodeInputSchema, updateHostNodeInputSchema } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import { createAuditService } from './audit.js';
import { type NodePlacementSource, computeCapacity, createHostNodeService } from './nodes.js';
import {
  NODE_ID,
  actorWith,
  createFakeAuditRepository,
  createFakeHostNodeRepository,
  ctxWith,
  nodeRecord,
} from './test-support.js';

function build(
  options: { nodes?: ReturnType<typeof nodeRecord>[]; placements?: NodePlacementSource } = {},
) {
  const auditRepository = createFakeAuditRepository();
  const repository = createFakeHostNodeRepository(options.nodes ?? [nodeRecord()]);
  const service = createHostNodeService({
    repository,
    audit: createAuditService(auditRepository),
    ...(options.placements ? { placements: options.placements } : {}),
  });

  return { service, repository, auditRepository };
}

function placements(
  serverCount: number,
  allocated = { ramMb: 8_192, cpuCores: 2, diskMb: 100_000 },
): NodePlacementSource {
  return { load: async () => new Map([[NODE_ID, { serverCount, allocated }]]) };
}

describe('Node-Kapazität (Lastenheft §3.7)', () => {
  it('zieht den reservierten Anteil vom Gesamtbestand ab', () => {
    const capacity = computeCapacity(
      { ramMb: 32_768, cpuCores: 8, diskMb: 2_000_000 },
      { ramMb: 8_192, cpuCores: 2, diskMb: 100_000 },
    );

    expect(capacity.available).toEqual({ ramMb: 24_576, cpuCores: 6, diskMb: 1_900_000 });
  });

  it('meldet nie einen negativen Rest, auch wenn überbucht wurde', () => {
    const capacity = computeCapacity(
      { ramMb: 8_192, cpuCores: 4, diskMb: 100_000 },
      { ramMb: 16_384, cpuCores: 8, diskMb: 200_000 },
    );

    expect(capacity.available).toEqual({ ramMb: 0, cpuCores: 0, diskMb: 0 });
  });

  it('setzt ohne Belegung available gleich total', async () => {
    const { service } = build();

    const [node] = await service.list(ctxWith(actorWith('node.view')));

    expect(node?.capacity.available).toEqual(node?.capacity.total);
    expect(node?.serverCount).toBe(0);
    // Solange B4 keine Messwerte liefert, bleibt die Auslastung leer –
    // statt einer erfundenen Null.
    expect(node?.usage).toBeNull();
  });
});

describe('Node-Verwaltung', () => {
  it('zeigt Nodes auch mit node.manage allein – wer verwaltet, muss sehen können', async () => {
    const { service } = build();

    const [node] = await service.list(ctxWith(actorWith('node.manage')));

    expect(node?.permissions).toEqual({ canView: true, canManage: true, canManageStorage: true });
  });

  it('lehnt die Übersicht ohne node.view und node.manage ab', async () => {
    const { service } = build();

    await expect(service.list(ctxWith(actorWith('audit.view')))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('lehnt das Anlegen ohne node.manage ab', async () => {
    const { service } = build();
    const input = createHostNodeInputSchema.parse({
      name: 'Zweitserver',
      wireguardIp: '10.10.0.3',
      totalResources: { ramMb: 16_384, cpuCores: 4, diskMb: 500_000 },
    });

    await expect(service.create(ctxWith(actorWith('node.view')), input)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('lehnt eine bereits vergebene WireGuard-Adresse ab', async () => {
    const { service } = build();
    const input = createHostNodeInputSchema.parse({
      name: 'Zweitserver',
      wireguardIp: '10.10.0.2',
      totalResources: { ramMb: 16_384, cpuCores: 4, diskMb: 500_000 },
    });

    await expect(service.create(ctxWith(actorWith('node.manage')), input)).rejects.toMatchObject({
      code: 'NODE_ADDRESS_TAKEN',
    });
  });

  it('protokolliert das Anlegen im Audit-Log', async () => {
    const { service, auditRepository } = build();
    const input = createHostNodeInputSchema.parse({
      name: 'Zweitserver',
      wireguardIp: '10.10.0.3',
      totalResources: { ramMb: 16_384, cpuCores: 4, diskMb: 500_000 },
    });

    await service.create(ctxWith(actorWith('node.manage')), input);

    expect(auditRepository.rows.map((row) => row.action)).toEqual(['node.created']);
  });

  it('erlaubt es, eine Node in Wartung zu nehmen', async () => {
    const { service } = build();
    const input = updateHostNodeInputSchema.parse({
      status: 'maintenance',
      statusMessage: 'Plattentausch',
    });

    const node = await service.update(ctxWith(actorWith('node.manage')), NODE_ID, input);

    expect(node.status).toBe('maintenance');
    expect(node.statusMessage).toBe('Plattentausch');
  });

  it('entfernt eine leere Node', async () => {
    const { service, repository, auditRepository } = build();

    await service.remove(ctxWith(actorWith('node.manage')), NODE_ID);

    expect(repository.rows).toHaveLength(0);
    expect(auditRepository.rows.map((row) => row.action)).toEqual(['node.deleted']);
  });

  it('lehnt das Entfernen ab, solange Server darauf liegen', async () => {
    const { service, repository } = build({ placements: placements(2) });

    await expect(service.remove(ctxWith(actorWith('node.manage')), NODE_ID)).rejects.toMatchObject({
      code: 'NODE_IN_USE',
    });

    expect(repository.rows).toHaveLength(1);
  });

  it('meldet eine unbekannte Node mit NODE_NOT_FOUND', async () => {
    const { service } = build();

    await expect(
      service.get(ctxWith(actorWith('node.view')), '99999999-9999-4999-8999-999999999999'),
    ).rejects.toMatchObject({ code: 'NODE_NOT_FOUND' });
  });
});
