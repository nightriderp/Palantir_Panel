import { createHostNodeInputSchema, updateHostNodeInputSchema } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import { AGENT_TOKEN_PREFIX, hashAgentToken } from './agent-token.js';
import { createAuditService } from './audit.js';
import {
  type NodeConnectionSource,
  type NodePlacementSource,
  computeCapacity,
  createHostNodeService,
} from './nodes.js';
import { type PortAllocationRecord, type PortRangeRecord, createPortPoolService } from './ports.js';
import {
  NODE_ID,
  actorWith,
  createFakeAuditRepository,
  createFakeHostNodeRepository,
  createFakePortPoolRepository,
  ctxWith,
  nodeRecord,
  portRange,
} from './test-support.js';

function build(
  options: {
    nodes?: ReturnType<typeof nodeRecord>[];
    placements?: NodePlacementSource;
    /** Port-Bereiche, die es in der Instanz gibt (Audit W3-6). */
    ranges?: PortRangeRecord[];
    allocations?: PortAllocationRecord[];
    /** Offene Agent-Verbindungen; fehlt sie, kennt der Dienst keine. */
    connections?: NodeConnectionSource;
  } = {},
) {
  const auditRepository = createFakeAuditRepository();
  const audit = createAuditService(auditRepository);
  const repository = createFakeHostNodeRepository(options.nodes ?? [nodeRecord()]);
  /*
   * Echter Port-Dienst statt einer Attrappe (Audit W3-6): Die Prüfung beim
   * Löschen einer Node und das Räumen leerer Bereiche laufen über genau diesen
   * Weg – eine Attrappe würde nur die eigene Erwartung bestätigen.
   */
  const portRepository = createFakePortPoolRepository(
    options.ranges ?? [],
    options.allocations ?? [],
  );
  const service = createHostNodeService({
    repository,
    audit,
    portBindings: createPortPoolService({ repository: portRepository, audit }),
    ...(options.placements ? { placements: options.placements } : {}),
    ...(options.connections ? { connections: options.connections } : {}),
  });

  return { service, repository, portRepository, auditRepository };
}

/** Zuordnung aus einem Bereich – die Attrappe legt keine von sich aus an. */
function allocation(overrides: Partial<PortAllocationRecord> = {}): PortAllocationRecord {
  return {
    id: 'allocation-1',
    rangeId: 'range-node',
    port: 27_000,
    protocol: 'udp',
    serverId: null,
    allocatedAt: new Date('2026-08-26T10:00:00.000Z'),
    ...overrides,
  };
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

  /*
   * Fundpunkt 203: Die Uebersicht zeigte nur `allocated` (alle Zustaende), die
   * harte Schranke rechnet aber gegen die laufenden Server. Auf einer Node mit
   * 28 GB, davon 26 GB gebucht und 20 GB laufend, wies die Seite "2 GB frei"
   * aus - und `POST /api/servers` nahm einen 6-GB-Server an.
   */
  it('fuehrt gebucht und laufend getrennt', () => {
    const capacity = computeCapacity(
      { ramMb: 28_672, cpuCores: 8, diskMb: 2_000_000 },
      { ramMb: 26_624, cpuCores: 8, diskMb: 86_016 },
      { ramMb: 20_480, cpuCores: 6, diskMb: 86_016 },
    );

    expect(capacity.allocated.ramMb).toBe(26_624);
    expect(capacity.running?.ramMb).toBe(20_480);
    // `available` bleibt die vorsichtige Zahl: was die Node bereithalten muss.
    expect(capacity.available.ramMb).toBe(2_048);
  });

  it('faellt ohne eigene Angabe auf die gebuchte Zahl zurueck', () => {
    const capacity = computeCapacity(
      { ramMb: 28_672, cpuCores: 8, diskMb: 2_000_000 },
      { ramMb: 26_624, cpuCores: 8, diskMb: 86_016 },
    );

    expect(capacity.running).toEqual(capacity.allocated);
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

describe('Tunnel-Adresse (Fundpunkt 240)', () => {
  it('bleibt fuer ein Konto mit node.view leer', async () => {
    const { service } = build();

    /*
     * Die Seed-Rolle "Nutzer" traegt `node.view`, damit der Anlegen-Assistent
     * eine Node zur Auswahl stellen kann. Bis Fundpunkt 240 las damit jedes
     * freigeschaltete Konto die WireGuard-Adressen aller Nodes mit.
     */
    const [node] = await service.list(ctxWith(actorWith('node.view')));

    expect(node?.wireguardIp).toBeNull();
    // Alles, wofuer die Uebersicht da ist, steht weiterhin drin.
    expect(node?.name).not.toBe('');
    expect(node?.capacity).toBeDefined();
  });

  it('steht fuer ein Konto mit node.manage drin', async () => {
    const { service } = build();

    const [node] = await service.list(ctxWith(actorWith('node.manage')));

    expect(node?.wireguardIp).not.toBeNull();
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

  /**
   * Audit W2-9, `backend-admin-resources-12`: `ensureAddressFree()` und der
   * Insert sind zwei Schritte. Zwei gleichzeitige Aufrufe mit demselben Namen
   * bestehen beide die Vorprüfung; den zweiten fängt erst der Unique-Index –
   * bisher als roher 23505 und damit als 500 statt als `NODE_ADDRESS_TAKEN`.
   */
  it('beantwortet den Unique-Index (23505) mit NODE_ADDRESS_TAKEN', async () => {
    const { service, repository } = build();
    // Der Gewinner des Rennens hat seinen Insert noch nicht abgeschlossen.
    repository.findByNameOrIp = () => Promise.resolve(null);
    repository.create = () =>
      Promise.reject(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        }),
      );

    const input = createHostNodeInputSchema.parse({
      name: 'Zweitserver',
      wireguardIp: '10.10.0.9',
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
      maintenance: true,
      statusMessage: 'Plattentausch',
    });

    const node = await service.update(ctxWith(actorWith('node.manage')), NODE_ID, input);

    expect(node.status).toBe('maintenance');
    expect(node.statusMessage).toBe('Plattentausch');
  });

  /*
   * Ende der Wartung (Widerspruch zwischen Kommentar und Verhalten in
   * `validation/host-node.ts`).
   *
   * Vorher schrieb das Frontend hier von Hand `offline` – und `markHostConnected`
   * holt das nur beim **Handshake** zurück. Ein durchgehend verbundener Agent
   * macht keinen neuen Handshake, die Node blieb also fälschlich als offline
   * geführt. Jetzt entscheidet die Frage nach der offenen Agent-Sitzung.
   */
  it('trägt nach der Wartung `online` ein, wenn der Agent verbunden ist', async () => {
    const { service } = build({
      nodes: [nodeRecord({ status: 'maintenance', statusMessage: 'Plattentausch' })],
      connections: { isConnected: (nodeId) => nodeId === NODE_ID },
    });
    const input = updateHostNodeInputSchema.parse({ maintenance: false, statusMessage: null });

    const node = await service.update(ctxWith(actorWith('node.manage')), NODE_ID, input);

    expect(node.status).toBe('online');
    expect(node.statusMessage).toBeNull();
  });

  it('trägt nach der Wartung `offline` ein, wenn kein Agent verbunden ist', async () => {
    const { service } = build({
      nodes: [nodeRecord({ status: 'maintenance' })],
      connections: { isConnected: () => false },
    });
    const input = updateHostNodeInputSchema.parse({ maintenance: false });

    const node = await service.update(ctxWith(actorWith('node.manage')), NODE_ID, input);

    expect(node.status).toBe('offline');
  });

  it('nimmt ohne Auskunft über die Verbindungen `offline` an', async () => {
    // Aufbau ohne Agent-Gateway: `offline` ist die sichere Annahme – ein
    // fälschlich `online` geführter Knoten nähme Starts an, die dann scheitern.
    const { service } = build({ nodes: [nodeRecord({ status: 'maintenance' })] });
    const input = updateHostNodeInputSchema.parse({ maintenance: false });

    const node = await service.update(ctxWith(actorWith('node.manage')), NODE_ID, input);

    expect(node.status).toBe('offline');
  });

  it('lässt den Zustand unberührt, wenn nur andere Felder geändert werden', async () => {
    const { service } = build({
      nodes: [nodeRecord({ status: 'maintenance' })],
      connections: { isConnected: () => true },
    });
    const input = updateHostNodeInputSchema.parse({ name: 'Homeserver II' });

    const node = await service.update(ctxWith(actorWith('node.manage')), NODE_ID, input);

    expect(node.name).toBe('Homeserver II');
    expect(node.status).toBe('maintenance');
  });

  it('protokolliert den geschriebenen Zustand, nicht nur den Feldnamen', async () => {
    const { service, auditRepository } = build({
      nodes: [nodeRecord({ status: 'maintenance' })],
      connections: { isConnected: () => true },
    });
    const input = updateHostNodeInputSchema.parse({ maintenance: false });

    await service.update(ctxWith(actorWith('node.manage')), NODE_ID, input);

    expect(auditRepository.rows.map((row) => row.action)).toEqual(['node.updated']);
    expect(auditRepository.rows[0]?.metadata).toEqual({
      changed: ['maintenance'],
      status: 'online',
    });
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

  /*
   * Node-gebundene Port-Bereiche (Audit W3-6, backend-admin-resources-08).
   *
   * `port_ranges.node_id` hängt an `ON DELETE CASCADE`, die Zuordnungen daraus
   * an `ON DELETE RESTRICT` – ohne eigene Prüfung endete der erste Fall als
   * roher Fremdschlüssel-Fehler und der zweite in einem stillen Verschwinden.
   */
  it('lehnt das Entfernen ab, solange aus einem gebundenen Bereich Ports vergeben sind', async () => {
    const { service, repository, portRepository, auditRepository } = build({
      ranges: [portRange({ id: 'range-node', label: 'Node-Bereich', nodeId: NODE_ID })],
      allocations: [allocation()],
    });

    await expect(service.remove(ctxWith(actorWith('node.manage')), NODE_ID)).rejects.toMatchObject({
      code: 'NODE_IN_USE',
    });

    // Node und Bereich bleiben unangetastet, und nichts wurde protokolliert.
    expect(repository.rows).toHaveLength(1);
    expect(portRepository.ranges).toHaveLength(1);
    expect(auditRepository.rows).toHaveLength(0);
  });

  it('räumt einen leeren gebundenen Bereich mit Protokolleintrag, bevor die Node fällt', async () => {
    const { service, repository, portRepository, auditRepository } = build({
      ranges: [portRange({ id: 'range-node', label: 'Node-Bereich', nodeId: NODE_ID })],
    });

    await service.remove(ctxWith(actorWith('node.manage')), NODE_ID);

    expect(repository.rows).toHaveLength(0);
    expect(portRepository.ranges).toHaveLength(0);
    // Reihenfolge zählt: erst der Bereich, dann die Node.
    expect(auditRepository.rows.map((row) => row.action)).toEqual([
      'address.rangeDeleted',
      'node.deleted',
    ]);
    expect(auditRepository.rows[0]?.metadata).toMatchObject({
      label: 'Node-Bereich',
      reason: 'nodeDeleted',
    });
  });

  it('lässt ungebundene Bereiche beim Löschen einer Node unberührt', async () => {
    const { service, portRepository, auditRepository } = build({
      ranges: [portRange({ id: 'range-frei', nodeId: null })],
    });

    await service.remove(ctxWith(actorWith('node.manage')), NODE_ID);

    expect(portRepository.ranges.map((range) => range.id)).toEqual(['range-frei']);
    expect(auditRepository.rows.map((row) => row.action)).toEqual(['node.deleted']);
  });

  it('meldet eine unbekannte Node mit NODE_NOT_FOUND', async () => {
    const { service } = build();

    await expect(
      service.get(ctxWith(actorWith('node.view')), '99999999-9999-4999-8999-999999999999'),
    ).rejects.toMatchObject({ code: 'NODE_NOT_FOUND' });
  });
});

describe('Agent-Token je Node (Gefundener Punkt 57)', () => {
  it('gibt das Token einmal im Klartext aus und speichert nur den Hash', async () => {
    const { service, repository } = build();

    const { token } = await service.issueAgentToken(ctxWith(actorWith('node.manage')), NODE_ID);

    expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    // Nichts am Datensatz verrät das Token selbst.
    expect(JSON.stringify(repository.rows)).not.toContain(token);
    expect(await repository.findByAgentTokenHash(hashAgentToken(token))).not.toBeNull();
  });

  it('findet die Node zum vorgelegten Token und sonst keine', async () => {
    const { service } = build();
    const { token } = await service.issueAgentToken(ctxWith(actorWith('node.manage')), NODE_ID);

    expect((await service.findByAgentToken(token))?.id).toBe(NODE_ID);
    expect(await service.findByAgentToken(`${token}x`)).toBeNull();
    expect(await service.findByAgentToken('')).toBeNull();
  });

  it('erzeugt bei jedem Aufruf ein neues Token und entwertet das alte', async () => {
    const { service } = build();
    const ctx = ctxWith(actorWith('node.manage'));

    const erstes = (await service.issueAgentToken(ctx, NODE_ID)).token;
    const zweites = (await service.issueAgentToken(ctx, NODE_ID)).token;

    expect(zweites).not.toBe(erstes);
    expect(await service.findByAgentToken(erstes)).toBeNull();
    expect((await service.findByAgentToken(zweites))?.id).toBe(NODE_ID);
  });

  it('protokolliert die Vergabe, ohne das Token ins Log zu schreiben', async () => {
    const { service, auditRepository } = build();

    const { token } = await service.issueAgentToken(ctxWith(actorWith('node.manage')), NODE_ID);

    const eintrag = auditRepository.rows.find((e) => e.action === 'node.agentTokenIssued');

    expect(eintrag).toBeDefined();
    expect(JSON.stringify(auditRepository.rows)).not.toContain(token);
  });

  it('verlangt node.manage', async () => {
    const { service } = build();

    await expect(
      service.issueAgentToken(ctxWith(actorWith('node.view')), NODE_ID),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
