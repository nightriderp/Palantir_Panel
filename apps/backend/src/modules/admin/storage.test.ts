import { type AgentStorageEntry, httpStatusForErrorCode } from '@palantir/contracts';
import { startStorageScanInputSchema } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import { createAuditService } from './audit.js';
import { createHostNodeService } from './nodes.js';
import {
  type KnownServerSource,
  type StorageEntryRemover,
  type StorageScanGateway,
  createStorageExplorerService,
  storageEntryId,
  unavailableStorageRemover,
} from './storage.js';
import {
  NODE_ID,
  SERVER_ID,
  USER_ID,
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

/**
 * Agent, der genau diese Postenliste meldet.
 *
 * Die Liste ist bewusst `unknown[]`: Ein Teil der Tests schickt absichtlich
 * Posten, die dem Vertrag nicht entsprechen – der Agent läuft auf einer anderen
 * Maschine, sein Ergebnis ist Eingabe wie jede andere.
 */
function breakdownGateway(entries: readonly unknown[]): StorageScanGateway {
  return {
    requestBreakdown: async () =>
      ({
        success: true,
        data: {
          scannedAt: '2026-08-26T09:30:00.000Z',
          totalBytes: 2_000_000_000_000,
          usedBytes: 900_000_000_000,
          freeBytes: 1_100_000_000_000,
          entries,
        },
        error: null,
      }) as never,
  };
}

function buildService(options: {
  entries?: ReturnType<typeof agentEntry>[];
  servers?: KnownServerSource;
  remover?: StorageEntryRemover;
  gateway?: StorageScanGateway;
}) {
  const auditRepository = createFakeAuditRepository();
  const audit = createAuditService(auditRepository);
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
    audit,
    knownServers: options.servers ?? knownServers(),
    ...(options.remover ? { remover: options.remover } : {}),
    ...(options.gateway ? { gateway: options.gateway } : {}),
  });

  return { storage, repository, auditRepository };
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

  it('protokolliert die Löschung genau einmal mit Handelndem, Ziel und Ergebnis', async () => {
    // Pflichtenheft §6: Seit A3 den Remover mitbringt, sind die Daten real
    // weg – ohne diesen Eintrag stünde die einzige destruktive Aktion des
    // Speicher-Explorers nicht im append-only Log.
    const { storage, auditRepository } = buildService({
      entries: [backup, verwaist],
      remover: createRecordingRemover(),
    });

    await storage.deleteEntry(
      ctxWith(actorWith('node.manage')),
      NODE_ID,
      '/srv/palantir/backups/beispiel.tar.gz',
    );

    expect(auditRepository.rows).toHaveLength(1);
    expect(auditRepository.rows[0]).toMatchObject({
      action: 'storage.entryDeleted',
      actorId: USER_ID,
      actorDisplayName: 'Test-Admin',
      ipHint: '10.0.0.x',
      targetType: 'storageEntry',
      targetId: '/srv/palantir/backups/beispiel.tar.gz',
      metadata: {
        nodeId: NODE_ID,
        kind: 'backup',
        sizeBytes: 5_000_000,
        path: '/srv/palantir/backups/beispiel.tar.gz',
      },
    });
  });

  it('protokolliert nichts, wenn der Posten gesperrt ist', async () => {
    const { storage, auditRepository } = buildService({ entries: [agentEntry()] });

    await storage
      .deleteEntry(ctxWith(actorWith('node.manage')), NODE_ID, `/srv/palantir/servers/${SERVER_ID}`)
      .catch(() => undefined);

    expect(auditRepository.rows).toEqual([]);
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

/**
 * Fundpunkt 136: Der Agent meldet `orphaned`, wenn er zu einem Datenordner
 * **keinen Container** findet. Fehlt der Container, während das Panel den
 * Server noch führt – Prune auf der Node, neu aufgesetzter Docker-Host –, war
 * dessen Datenordner über den Speicher-Explorer löschbar. Die Sperre griff nur
 * für `serverData`.
 */
/*
 * Fundpunkt 224: Die Fallunterscheidung ueber `entry.kind` ist ueber die Union
 * vollstaendig - der Wert kommt aber aus einer `jsonb`-Spalte und wird beim
 * Lesen nicht nachgeprueft. Ohne `default`-Zweig lieferte `classifyEntry`
 * `undefined`, und die ganze Node-Platz-Seite antwortete mit HTTP 500 -
 * dauerhaft, denn der Scan liegt gespeichert.
 */
describe('Storage-Explorer: unbekannte Postenart legt die Seite nicht lahm (Fundpunkt 224)', () => {
  it('zeigt sie als „other" und gesperrt, der Rest der Liste bleibt lesbar', async () => {
    const unbekannt = {
      ...agentEntry({ path: '/srv/palantir/neuartig', serverId: null, inUse: false }),
      // Eine Fassung des Agents, die dieser Code noch nicht kennt.
      kind: 'nochNichtErfunden',
    } as unknown as AgentStorageEntry;
    const backup = agentEntry({
      kind: 'backup',
      path: '/srv/palantir/backups/beispiel.tar.gz',
      backupFileName: 'beispiel.tar.gz',
      serverId: null,
      inUse: false,
    });

    const { storage } = buildService({ entries: [unbekannt, backup] });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);
    const eintraege = snapshot.breakdown?.entries ?? [];

    expect(eintraege).toHaveLength(2);
    expect(eintraege[0]).toMatchObject({
      kind: 'other',
      label: '/srv/palantir/neuartig',
      deleteBlockedReason: 'notClearlyOrphaned',
    });
    expect(eintraege[0]?.permissions.canDelete).toBe(false);
    // Der bekannte Posten daneben bleibt unveraendert loeschbar.
    expect(eintraege[1]?.permissions.canDelete).toBe(true);
  });
});

describe('Storage-Explorer: verwaister Ordner eines bekannten Servers (Fundpunkt 136)', () => {
  /** Datenordner, benannt nach der Server-Id, aber ohne Container auf der Node. */
  const ohneContainer = agentEntry({
    kind: 'orphaned',
    path: `/srv/palantir/servers/${SERVER_ID}`,
    serverId: null,
    inUse: false,
  });

  it('sperrt ihn, solange das Panel den Server noch kennt', async () => {
    const { storage } = buildService({ entries: [ohneContainer] });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);
    const [entry] = snapshot.breakdown?.entries ?? [];

    expect(entry?.deleteBlockedReason).toBe('activeServerData');
    expect(entry?.permissions.canDelete).toBe(false);
    // Und er wird als das gezeigt, was er ist: der Datenordner dieses Servers.
    expect(entry?.kind).toBe('serverData');
    expect(entry?.serverId).toBe(SERVER_ID);
    expect(entry?.label).toBe('Beispielserver');
  });

  it('lehnt das Löschen mit dem Fachcode ab, ohne den Homeserver anzufassen', async () => {
    const remover = createRecordingRemover();
    const { storage } = buildService({ entries: [ohneContainer], remover });

    await expect(
      storage.deleteEntry(
        ctxWith(actorWith('node.manage')),
        NODE_ID,
        storageEntryId(ohneContainer),
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_ENTRY_NOT_DELETABLE' });
    expect(remover.calls).toEqual([]);
  });

  it('lässt den Ordner eines wirklich gelöschten Servers weiterhin entfernen', async () => {
    const remover = createRecordingRemover();
    const { storage } = buildService({
      entries: [ohneContainer],
      // Das Panel kennt diesen Server nicht mehr – er ist gelöscht.
      servers: knownServers([]),
      remover,
    });

    const entfernt = await storage.deleteEntry(
      ctxWith(actorWith('node.manage')),
      NODE_ID,
      storageEntryId(ohneContainer),
    );

    expect(entfernt.kind).toBe('orphaned');
    expect(remover.calls).toEqual([storageEntryId(ohneContainer)]);
  });

  it('vergleicht den Ordnernamen unabhängig von der Schreibweise', async () => {
    const grossgeschrieben = agentEntry({
      kind: 'orphaned',
      path: `/srv/palantir/servers/${SERVER_ID.toUpperCase()}`,
      serverId: null,
      inUse: false,
    });
    const { storage } = buildService({ entries: [grossgeschrieben] });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);

    expect(snapshot.breakdown?.entries[0]?.deleteBlockedReason).toBe('activeServerData');
  });

  it('sperrt auch einen Datenordner, dessen serverId der Agent nicht mitgeschickt hat', async () => {
    // Derselbe Weg für `serverData`: Meldet der Agent den Ordner ohne Id,
    // benennt der Ordnername den Server trotzdem eindeutig.
    const ohneId = agentEntry({ serverId: null });
    const { storage } = buildService({ entries: [ohneId] });

    const snapshot = await storage.getSnapshot(ctxWith(actorWith('node.manage')), NODE_ID);

    expect(snapshot.breakdown?.entries[0]).toMatchObject({
      kind: 'serverData',
      serverId: SERVER_ID,
      deleteBlockedReason: 'activeServerData',
    });
  });
});

/**
 * Audit-Fundstelle backend-admin-resources-10: Bis hierher fielen alle Posten
 * ohne Pfad, Image-Id und Image-Tag auf die feste Kennung `'unbekannt'`
 * zurück – zwei davon waren nicht auseinanderzuhalten.
 */
describe('Storage-Explorer: Kennung eines Postens ist eindeutig', () => {
  it('unterscheidet zwei fremde Ordner am Pfad', () => {
    const alt = agentEntry({ kind: 'orphaned', path: '/srv/palantir/servers/alt-server' });
    const misc = agentEntry({ kind: 'orphaned', path: '/srv/palantir/servers/misc' });

    expect(storageEntryId(alt)).not.toBe(storageEntryId(misc));
  });

  it('unterscheidet zwei Posten ganz ohne natürliches Merkmal', () => {
    // Kein Pfad, kein Image, kein Dateiname – früher beide „unbekannt".
    const gemeinsam = {
      kind: 'orphaned' as const,
      path: null,
      serverId: null,
      backupFileName: null,
      imageId: null,
      imageTag: null,
    };
    const klein = agentEntry({ ...gemeinsam, sizeBytes: 10 });
    const gross = agentEntry({ ...gemeinsam, sizeBytes: 20 });

    expect(storageEntryId(klein)).not.toBe('unbekannt');
    expect(storageEntryId(klein)).not.toBe(storageEntryId(gross));
  });

  it('zieht den Backup-Dateinamen heran, wenn der Pfad fehlt', () => {
    const eins = agentEntry({ kind: 'backup', path: null, backupFileName: 'a.tar.gz' });
    const zwei = agentEntry({ kind: 'backup', path: null, backupFileName: 'b.tar.gz' });

    expect(storageEntryId(eins)).toBe('a.tar.gz');
    expect(storageEntryId(zwei)).toBe('b.tar.gz');
  });

  it('bleibt bei Images exakt die imageId', () => {
    // Der Remover reicht die Kennung unverändert als `imageId` an den Agent
    // weiter (createAgentStorageEntryRemover in B3) – ein Präfix hier würde
    // dort ins Leere greifen.
    const image = agentEntry({
      kind: 'dockerImage',
      path: null,
      serverId: null,
      imageId: 'sha256:abc',
      imageTag: 'palantir/test:1',
    });

    expect(storageEntryId(image)).toBe('sha256:abc');
  });
});

describe('Storage-Explorer: mehrdeutige Kennung wird nicht geraten', () => {
  /** Ein Posten ohne jedes natürliche Merkmal – zweimal erzeugt: dieselbe Kennung, zwei Dinge. */
  function namenloserPosten(): ReturnType<typeof agentEntry> {
    return agentEntry({
      kind: 'orphaned',
      path: null,
      serverId: null,
      backupFileName: null,
      imageId: null,
      imageTag: null,
      inUse: false,
    });
  }

  it('lehnt das Löschen mit einem eigenen Katalogcode ab (409)', async () => {
    // Contracts-Nachzug W2-C2: Vorher lieh sich der Fall `STORAGE_SCAN_MISSING`
    // – „es gibt keine Übersicht", obwohl es sehr wohl eine gibt. Der eigene
    // Code benennt den Grund: die Kennung ist nicht eindeutig.
    const { storage } = buildService({ entries: [namenloserPosten(), namenloserPosten()] });

    await expect(
      storage.deleteEntry(
        ctxWith(actorWith('node.manage')),
        NODE_ID,
        storageEntryId(namenloserPosten()),
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_ENTRY_AMBIGUOUS' });

    expect(httpStatusForErrorCode('STORAGE_ENTRY_AMBIGUOUS')).toBe(409);
  });

  it('fasst dabei weder Homeserver noch Zwischenspeicher noch Log an', async () => {
    const remover = createRecordingRemover();
    const { storage, repository, auditRepository } = buildService({
      entries: [namenloserPosten(), namenloserPosten()],
      remover,
    });

    await storage
      .deleteEntry(ctxWith(actorWith('node.manage')), NODE_ID, storageEntryId(namenloserPosten()))
      .catch(() => undefined);

    expect(remover.calls).toEqual([]);
    expect(repository.snapshot?.entries).toHaveLength(2);
    expect(auditRepository.rows).toEqual([]);
  });

  it('entfernt bei eindeutiger Kennung genau einen Posten', async () => {
    // Gegenprobe zum alten `filter` über die Kennung: Der zweite Posten bleibt.
    const verwaist = agentEntry({
      kind: 'orphaned',
      path: '/srv/palantir/servers/alt-server',
      serverId: null,
      inUse: false,
    });
    const anderer = agentEntry({
      kind: 'orphaned',
      path: '/srv/palantir/servers/misc',
      serverId: null,
      inUse: false,
    });
    const { storage, repository } = buildService({
      entries: [verwaist, anderer],
      remover: createRecordingRemover(),
    });

    await storage.deleteEntry(
      ctxWith(actorWith('node.manage')),
      NODE_ID,
      '/srv/palantir/servers/alt-server',
    );

    expect(repository.snapshot?.entries.map((entry) => entry.path)).toEqual([
      '/srv/palantir/servers/misc',
    ]);
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

  it('nimmt fremde Ordner an, statt den ganzen Scan zu verwerfen', async () => {
    // Audit-Fundstelle contracts-validation-02: Auf dem Homeserver liegt ein
    // von Hand angelegter Ordner `alt-server`. Der Agent kennt keinen Container
    // dazu und rät nicht – er meldet `orphaned` ohne serverId. Unter dem
    // Backup-Verzeichnis trägt derselbe Ordnername dagegen die serverId, so wie
    // er auf der Platte steht: keine UUID.
    const { storage, repository } = buildService({
      gateway: breakdownGateway([
        {
          kind: 'orphaned',
          path: '/srv/palantir/servers/alt-server',
          sizeBytes: 1_024,
          serverId: null,
          backupFileName: null,
          imageId: null,
          imageTag: null,
          inUse: false,
          lastModifiedAt: null,
        },
        {
          kind: 'backup',
          path: '/srv/palantir/backups/alt-server/a.tar.gz',
          sizeBytes: 42,
          serverId: 'alt-server',
          backupFileName: 'a.tar.gz',
          imageId: null,
          imageTag: null,
          inUse: false,
          lastModifiedAt: null,
        },
      ]),
    });

    const snapshot = await storage.scan(
      ctxWith(actorWith('node.manage')),
      NODE_ID,
      startStorageScanInputSchema.parse({}),
    );
    const [verwaist, archiv] = snapshot.breakdown?.entries ?? [];

    expect(repository.snapshot?.entries).toHaveLength(2);
    expect(verwaist).toMatchObject({ kind: 'orphaned', serverId: null });
    // Aufräumen ist der Zweck der Ansicht – der Ordner ist freigegeben.
    expect(verwaist?.permissions.canDelete).toBe(true);
    expect(archiv).toMatchObject({ kind: 'backup', serverId: 'alt-server' });
  });

  it('übergeht einen unbrauchbaren Posten und behält die übrigen', async () => {
    const { storage, repository } = buildService({
      gateway: breakdownGateway([
        { kind: 'backup', path: 42 } as never,
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
      ]),
    });

    const snapshot = await storage.scan(
      ctxWith(actorWith('node.manage')),
      NODE_ID,
      startStorageScanInputSchema.parse({}),
    );

    expect(repository.snapshot?.entries).toHaveLength(1);
    expect(snapshot.breakdown?.entries[0]?.id).toBe('/srv/palantir/backups/a.tar.gz');
  });

  it('lehnt eine Meldung ab, in der kein einziger Posten brauchbar ist', async () => {
    // Ein fremder Ordner ist ein Ordner – eine Liste ohne einen einzigen
    // gültigen Posten ist ein auseinandergelaufenes Protokoll.
    const { storage, repository } = buildService({
      gateway: breakdownGateway([{ kind: 'backup', path: 42 } as never]),
    });

    await expect(
      storage.scan(
        ctxWith(actorWith('node.manage')),
        NODE_ID,
        startStorageScanInputSchema.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'AGENT_COMMAND_INVALID' });

    expect(repository.snapshot).toBeNull();
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
