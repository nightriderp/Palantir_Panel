import { startStorageScanInputSchema } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import { createAuditService } from './audit.js';
import { createHostNodeService } from './nodes.js';
import {
  type KnownServerSource,
  type StorageEntryRemover,
  type StorageScanGateway,
  createStorageExplorerService,
  unavailableStorageRemover,
} from './storage.js';
import {
  NODE_ID,
  SERVER_ID,
  actorWith,
  agentEntry,
  createFakeAuditRepository,
  createFakeHostNodeRepository,
  createFakeStorageRepository,
  ctxWith,
  nodeRecord,
  ownerActor,
  snapshotRecord,
} from './test-support.js';

function knownServers(
  entries: [string, string][] = [[SERVER_ID, 'Beispielserver']],
): KnownServerSource {
  return { load: async () => new Map(entries.map(([id, name]) => [id, { name }])) };
}

/** Merkt sich, ob überhaupt versucht wurde, etwas zu entfernen. */
function createRecordingRemover(): StorageEntryRemover & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    async remove(_node, entry) {
      calls.push(entry.id);

      return { success: true, data: null, error: null };
    },
  };
}

function buildService(options: {
  entries?: ReturnType<typeof agentEntry>[];
  servers?: KnownServerSource;
  remover?: StorageEntryRemover;
  gateway?: StorageScanGateway;
}) {
  const audit = createAuditService(createFakeAuditRepository());
  const nodes = createHostNodeService({
    repository: createFakeHostNodeRepository([nodeRecord()]),
    audit,
  });
  const repository = createFakeStorageRepository(
    options.entries ? snapshotRecord(options.entries) : null,
  );

  const storage = createStorageExplorerService({
    repository,
    nodes,
    knownServers: options.servers ?? knownServers(),
    ...(options.remover ? { remover: options.remover } : {}),
    ...(options.gateway ? { gateway: options.gateway } : {}),
  });

  return { storage, repository };
}

/**
 * Lastenheft §3.8: „Aktive Server-Datenordner sind über diese Ansicht bewusst
 * **nicht** löschbar (nur über den dedizierten Server-löschen-Vorgang)."
 */
describe('Storage-Explorer: aktive Server-Datenordner sind nicht löschbar', () => {
  it('meldet den Datenordner eines bekannten Servers als gesperrt', async () => {
    const { storage } = buildService({ entries: [agentEntry()] });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);
    const [entry] = snapshot.breakdown?.entries ?? [];

    expect(entry?.kind).toBe('serverData');
    expect(entry?.permissions.canDelete).toBe(false);
    expect(entry?.deleteBlockedReason).toBe('activeServerData');
  });

  it('lehnt das Löschen mit STORAGE_ENTRY_NOT_DELETABLE ab', async () => {
    const remover = createRecordingRemover();
    const { storage } = buildService({ entries: [agentEntry()], remover });
    const entryId = `/srv/palantir/servers/${SERVER_ID}`;

    await expect(
      storage.deleteEntry(ctxWith(actorWith('node.manage')), NODE_ID, entryId),
    ).rejects.toMatchObject({ code: 'STORAGE_ENTRY_NOT_DELETABLE' });
  });

  it('fasst den Homeserver dabei gar nicht erst an', async () => {
    const remover = createRecordingRemover();
    const { storage, repository } = buildService({ entries: [agentEntry()], remover });

    await storage
      .deleteEntry(ctxWith(actorWith('node.manage')), NODE_ID, `/srv/palantir/servers/${SERVER_ID}`)
      .catch(() => undefined);

    expect(remover.calls).toEqual([]);
    // Der zwischengespeicherte Scan bleibt vollständig.
    expect(repository.snapshot?.entries).toHaveLength(1);
  });

  it('verwehrt es auch dem Owner', async () => {
    const remover = createRecordingRemover();
    const { storage } = buildService({ entries: [agentEntry()], remover });

    await expect(
      storage.deleteEntry(ctxWith(ownerActor()), NODE_ID, `/srv/palantir/servers/${SERVER_ID}`),
    ).rejects.toMatchObject({ code: 'STORAGE_ENTRY_NOT_DELETABLE' });

    expect(remover.calls).toEqual([]);
  });

  it('gibt einen Datenordner ohne bekannten Server ebenfalls nicht frei', async () => {
    // Nicht bekannt heißt nicht „eindeutig verwaist": Solange die Serverliste
    // unvollständig sein kann, bleibt der Ordner gesperrt.
    const { storage } = buildService({ entries: [agentEntry()], servers: knownServers([]) });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);
    const [entry] = snapshot.breakdown?.entries ?? [];

    expect(entry?.kind).toBe('other');
    expect(entry?.permissions.canDelete).toBe(false);
    expect(entry?.deleteBlockedReason).toBe('notClearlyOrphaned');
  });
});

describe('Storage-Explorer: löschbare Posten (Lastenheft §3.8)', () => {
  const backup = agentEntry({
    kind: 'backup',
    path: '/srv/palantir/backups/beispiel.tar.gz',
    backupFileName: 'beispiel.tar.gz',
    inUse: false,
  });
  const ungenutztesImage = agentEntry({
    kind: 'dockerImage',
    path: null,
    serverId: null,
    imageId: 'sha256:abc',
    imageTag: 'palantir/test:1',
    inUse: false,
  });
  const benutztesImage = agentEntry({
    kind: 'dockerImage',
    path: null,
    serverId: null,
    imageId: 'sha256:def',
    imageTag: 'palantir/minecraft:1',
    inUse: true,
  });
  const verwaist = agentEntry({
    kind: 'orphaned',
    path: '/srv/palantir/servers/reste',
    serverId: null,
    inUse: false,
  });

  it('gibt Backups, ungenutzte Images und verwaiste Daten frei', async () => {
    const { storage } = buildService({ entries: [backup, ungenutztesImage, verwaist] });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);

    expect(snapshot.breakdown?.entries.map((entry) => entry.permissions.canDelete)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('sperrt ein Image, das noch benutzt wird', async () => {
    const { storage } = buildService({ entries: [benutztesImage] });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);
    const [entry] = snapshot.breakdown?.entries ?? [];

    expect(entry?.permissions.canDelete).toBe(false);
    expect(entry?.deleteBlockedReason).toBe('imageInUse');
  });

  it('entfernt einen freigegebenen Posten und zieht den Zwischenspeicher nach', async () => {
    const remover = createRecordingRemover();
    const { storage, repository } = buildService({ entries: [backup, verwaist], remover });

    const removed = await storage.deleteEntry(
      ctxWith(actorWith('node.manage')),
      NODE_ID,
      '/srv/palantir/backups/beispiel.tar.gz',
    );

    expect(removed.kind).toBe('backup');
    expect(remover.calls).toEqual(['/srv/palantir/backups/beispiel.tar.gz']);
    expect(repository.snapshot?.entries.map((entry) => entry.path)).toEqual([
      '/srv/palantir/servers/reste',
    ]);
  });

  it('gibt ohne node.manage gar nichts frei', async () => {
    const { storage } = buildService({ entries: [backup] });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.view')), NODE_ID);
    const [entry] = snapshot.breakdown?.entries ?? [];

    expect(entry?.permissions.canView).toBe(true);
    expect(entry?.permissions.canDelete).toBe(false);
    expect(entry?.deleteBlockedReason).toBe('permissionMissing');
  });

  it('lehnt einen unbekannten Posten mit STORAGE_ENTRY_NOT_FOUND ab', async () => {
    const { storage } = buildService({ entries: [backup] });

    await expect(
      storage.deleteEntry(ctxWith(actorWith('node.manage')), NODE_ID, '/gibt/es/nicht'),
    ).rejects.toMatchObject({ code: 'STORAGE_ENTRY_NOT_FOUND' });
  });
});

describe('Storage-Explorer: Scan on demand (Pflichtenheft §16)', () => {
  it('liefert ohne bisherigen Scan eine leere Übersicht statt eines Fehlers', async () => {
    const { storage } = buildService({});

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);

    expect(snapshot.breakdown).toBeNull();
    expect(snapshot.ageSeconds).toBeNull();
    expect(snapshot.permissions.canScan).toBe(true);
  });

  it('verlangt für das Löschen einen vorhandenen Scan', async () => {
    const { storage } = buildService({});

    await expect(
      storage.deleteEntry(ctxWith(actorWith('node.manage')), NODE_ID, '/irgendwas'),
    ).rejects.toMatchObject({ code: 'STORAGE_SCAN_MISSING' });
  });

  it('speichert das Ergebnis des Agents mit dessen Zeitstempel zwischen', async () => {
    const gateway: StorageScanGateway = {
      requestBreakdown: async () => ({
        success: true,
        data: {
          scannedAt: '2026-08-26T09:30:00.000Z',
          totalBytes: 2_000_000_000_000,
          usedBytes: 900_000_000_000,
          freeBytes: 1_100_000_000_000,
          entries: [
            {
              kind: 'backup',
              path: '/srv/palantir/backups/a.tar.gz',
              sizeBytes: 42,
              serverId: null,
              backupFileName: 'a.tar.gz',
              imageId: null,
              imageTag: null,
              inUse: false,
              lastModifiedAt: null,
            },
          ],
        },
        error: null,
      }),
    };

    const { storage, repository } = buildService({ gateway });

    const snapshot = await storage.scan(
      ctxWith(actorWith('node.manage')),
      NODE_ID,
      startStorageScanInputSchema.parse({}),
    );

    expect(snapshot.breakdown?.scannedAt).toBe('2026-08-26T09:30:00.000Z');
    expect(repository.snapshot?.entries).toHaveLength(1);
  });

  it('lehnt eine Antwort ab, die nicht dem vereinbarten Format entspricht', async () => {
    const gateway: StorageScanGateway = {
      // Der Agent läuft auf einer anderen Maschine – sein Ergebnis ist Eingabe
      // wie jede andere.
      requestBreakdown: async () =>
        ({ success: true, data: { scannedAt: 'gestern' }, error: null }) as never,
    };
    const { storage, repository } = buildService({ gateway });

    await expect(
      storage.scan(
        ctxWith(actorWith('node.manage')),
        NODE_ID,
        startStorageScanInputSchema.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'AGENT_COMMAND_INVALID' });

    expect(repository.snapshot).toBeNull();
  });

  it('reicht den Fehlercode des Agents unverändert weiter', async () => {
    const { storage } = buildService({});

    await expect(
      storage.scan(
        ctxWith(actorWith('node.manage')),
        NODE_ID,
        startStorageScanInputSchema.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'AGENT_RUNTIME_UNAVAILABLE' });
  });

  it('meldet den noch fehlenden Lösch-Befehl des Agents als solchen', async () => {
    const { storage } = buildService({
      entries: [
        agentEntry({
          kind: 'orphaned',
          path: '/srv/palantir/servers/reste',
          serverId: null,
          inUse: false,
        }),
      ],
      remover: unavailableStorageRemover(),
    });

    await expect(
      storage.deleteEntry(
        ctxWith(actorWith('node.manage')),
        NODE_ID,
        '/srv/palantir/servers/reste',
      ),
    ).rejects.toMatchObject({ code: 'AGENT_COMMAND_NOT_IMPLEMENTED' });
  });

  it('lehnt den Scan ohne node.manage ab', async () => {
    const { storage } = buildService({});

    await expect(
      storage.scan(ctxWith(actorWith('node.view')), NODE_ID, startStorageScanInputSchema.parse({})),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
