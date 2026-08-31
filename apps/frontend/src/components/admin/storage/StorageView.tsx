'use client';

import {
  type HostNodeDto,
  type StorageEntryDto,
  type StorageEntryKind,
  type StorageSnapshotDto,
} from '@palantir/contracts';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  MetricTile,
  PageHeader,
  Panel,
  SelectField,
  Toggle,
  clampPercent,
  cn,
  formatBytes,
  formatDateTime,
  formatNumber,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  deleteStorageEntry,
  fetchNodes,
  fetchStorageSnapshot,
  startStorageScan,
} from '@/lib/api/admin';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading, AdminTable, Td, Th } from '../common';
import { storageBlockReasonLabel, storageKindLabel } from '../labels';

/**
 * Node-Platz / Storage-Explorer (Lastenheft §3.8, Pflichtenheft §16).
 *
 * Der Scan läuft on demand; das Ergebnis wird mit Zeitstempel angezeigt.
 * Löschbar sind Backups, ungenutzte Docker-Images und eindeutig verwaiste Daten
 * – aktive Server-Datenordner **nicht**. Das entscheidet der Contract über
 * `entry.permissions.canDelete`/`deleteBlockedReason`, nicht die Ansicht.
 */

const KIND_TONES: Record<
  StorageEntryKind,
  'brand' | 'success' | 'warning' | 'caution' | 'neutral'
> = {
  serverData: 'brand',
  backup: 'success',
  dockerImage: 'neutral',
  orphaned: 'caution',
  other: 'neutral',
};

export function StorageView() {
  const { user } = useSession();
  const canView = user?.permissions.canViewNodes ?? false;

  const nodes = useApiResource<HostNodeDto[]>((signal) => fetchNodes(signal), canView ? [] : null);
  const [nodeId, setNodeId] = useState<string | null>(null);

  const nodeList = useMemo(() => nodes.data ?? [], [nodes.data]);
  const activeNodeId = nodeId ?? nodeList[0]?.id ?? null;

  /*
   * Die Uebersicht zeigt **alle** Nodes gleichzeitig (Mockup „Platz auf den
   * Nodes"). Dafuer wird je Node der zwischengespeicherte Stand geholt - ein
   * Aufruf je Node, aber nur der gespeicherte Schnappschuss, kein neuer Scan.
   * Eine Node, deren Abruf scheitert, fehlt schlicht in der Karte, statt die
   * ganze Seite zu stoppen.
   */
  const snapshots = useApiResource<Record<string, StorageSnapshotDto>>(
    async (signal) => {
      const results = await Promise.all(
        nodeList.map((node) => fetchStorageSnapshot(node.id, signal)),
      );

      const map: Record<string, StorageSnapshotDto> = {};
      for (const [index, result] of results.entries()) {
        const node = nodeList[index];
        if (node && result.success) map[node.id] = result.data;
      }

      return { success: true, data: map, error: null };
    },
    nodeList.length > 0 ? [nodeList.map((node) => node.id).join(',')] : null,
  );

  /** Gesamtbelegung ueber alle Nodes, die schon einmal gescannt wurden. */
  const total = useMemo(() => {
    let used = 0;
    let capacity = 0;
    for (const snapshot of Object.values(snapshots.data ?? {})) {
      if (!snapshot.breakdown) continue;
      used += snapshot.breakdown.usedBytes;
      capacity += snapshot.breakdown.totalBytes;
    }
    return capacity > 0 ? { used, capacity } : null;
  }, [snapshots.data]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Platz auf den Nodes" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Speicherverwaltung" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Platz auf den Nodes"
        subtitle={
          total
            ? `Gesamt: ${formatBytes(total.used)} / ${formatBytes(total.capacity)} belegt`
            : 'Belegten Speicher der Nodes einsehen und aufräumen'
        }
        className="-mx-5 -mt-5 px-5"
      />

      {nodes.loading ? (
        <AdminLoading label="Nodes werden geladen …" />
      ) : nodes.error ? (
        <AdminError message={nodes.error} onRetry={nodes.reload} />
      ) : (nodes.data ?? []).length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Es ist noch keine Node eingerichtet.
        </Panel>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {nodeList.map((node) => (
              <NodeSummaryCard
                key={node.id}
                node={node}
                snapshot={snapshots.data?.[node.id] ?? null}
                active={node.id === activeNodeId}
                onSelect={() => setNodeId(node.id)}
                onRescanned={(updated) =>
                  snapshots.setData((current) => ({ ...(current ?? {}), [node.id]: updated }))
                }
              />
            ))}
          </div>

          {activeNodeId ? <NodeStorage key={activeNodeId} nodeId={activeNodeId} /> : null}
        </>
      )}
    </div>
  );
}

/**
 * Eine Node in der Uebersicht (Mockup „Platz auf den Nodes").
 *
 * Balken, die drei Anteile Serverdaten / Sicherungen / Images und ein Hinweis,
 * wenn verwaiste Daten liegen. „Neu einlesen" stoesst den Scan genau dieser
 * Node an; die Auswahl darunter oeffnet ihre Einzelheiten.
 */
function NodeSummaryCard({
  node,
  snapshot,
  active,
  onSelect,
  onRescanned,
}: {
  node: HostNodeDto;
  snapshot: StorageSnapshotDto | null;
  active: boolean;
  onSelect: () => void;
  onRescanned: (snapshot: StorageSnapshotDto) => void;
}) {
  const toast = useToast();
  const [scanning, setScanning] = useState(false);

  const breakdown = snapshot?.breakdown ?? null;
  const percent =
    breakdown && breakdown.totalBytes > 0
      ? clampPercent((breakdown.usedBytes / breakdown.totalBytes) * 100)
      : null;

  function sizeOf(kind: StorageEntryKind): number {
    return breakdown?.categories.find((category) => category.kind === kind)?.sizeBytes ?? 0;
  }

  const orphaned = sizeOf('orphaned');

  async function rescan() {
    setScanning(true);
    const result = await startStorageScan(node.id, { includeImages: true });
    setScanning(false);

    if (result.success) {
      onRescanned(result.data);
      toast.success(`„${node.name}" neu eingelesen.`);
    } else {
      toast.error(errorText(result));
    }
  }

  return (
    <Panel className={cn('flex flex-col gap-3', active && 'border-brand-line')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSelect}
          className={cn('text-base font-semibold', active ? 'text-ink' : 'text-ink-muted')}
        >
          {node.name}
        </button>

        <Button
          iconLeft="restart"
          disabled={!(snapshot?.permissions.canScan ?? false) || scanning}
          onClick={() => void rescan()}
        >
          {scanning ? 'Läuft …' : 'Neu einlesen'}
        </Button>
      </div>

      {percent === null ? (
        <p className="text-sm text-ink-faint">Für diese Node ist noch kein Scan gelaufen.</p>
      ) : (
        <>
          <div className="h-1.5 overflow-hidden rounded-sm bg-fill-strong">
            <div className="h-full rounded-sm bg-brand" style={{ width: `${percent}%` }} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                ['Serverdaten', 'serverData'],
                ['Sicherungen', 'backup'],
                ['Images', 'dockerImage'],
              ] as const
            ).map(([label, kind]) => (
              <div key={kind}>
                <div className="text-2xs uppercase tracking-[0.08em] text-ink-soft">{label}</div>
                <div className="mt-1 font-mono text-md text-ink">{formatBytes(sizeOf(kind))}</div>
                <div className="text-xs text-ink-faint">In Benutzung</div>
              </div>
            ))}
          </div>

          {orphaned > 0 ? (
            <p className="text-xs text-caution">
              {formatBytes(orphaned)} gehören zu Servern, die es nicht mehr gibt.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/** Speicherübersicht einer einzelnen Node. */
function NodeStorage({ nodeId }: { nodeId: string }) {
  const toast = useToast();
  const [includeImages, setIncludeImages] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [kindFilter, setKindFilter] = useState<StorageEntryKind | ''>('');
  const [toDelete, setToDelete] = useState<StorageEntryDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resource = useApiResource<StorageSnapshotDto>(
    (signal) => fetchStorageSnapshot(nodeId, signal),
    [nodeId],
  );

  const snapshot = resource.data;
  const breakdown = snapshot?.breakdown ?? null;

  const entries = useMemo(() => {
    const all = breakdown?.entries ?? [];
    return kindFilter ? all.filter((entry) => entry.kind === kindFilter) : all;
  }, [breakdown, kindFilter]);

  async function runScan() {
    setScanning(true);
    const result = await startStorageScan(nodeId, { includeImages });
    setScanning(false);
    if (result.success) {
      resource.setData(result.data);
      toast.success('Scan abgeschlossen.');
    } else {
      toast.error(errorText(result));
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const result = await deleteStorageEntry(nodeId, toDelete.id);
    setDeleting(false);
    if (result.success) {
      toast.success(`„${toDelete.label}" gelöscht.`);
      setToDelete(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  const canScan = snapshot?.permissions.canScan ?? false;

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink-muted">
            {breakdown
              ? `Letzter Scan: ${formatDateTime(breakdown.scannedAt)}`
              : 'Für diese Node ist noch kein Scan gelaufen.'}
          </span>
          {snapshot?.ageSeconds != null ? (
            <span className="text-2xs text-ink-faint">
              vor {Math.round(snapshot.ageSeconds / 60)} min ermittelt
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            checked={includeImages}
            onChange={setIncludeImages}
            label="Docker-Images einbeziehen"
            disabled={!canScan || scanning}
          />
          <Button
            variant="primary"
            iconLeft="restart"
            disabled={!canScan || scanning}
            onClick={() => void runScan()}
          >
            {scanning ? 'Scan läuft …' : 'Scan starten'}
          </Button>
        </div>
      </Panel>

      {resource.loading ? (
        <AdminLoading label="Speicherübersicht wird geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : !breakdown ? (
        <Panel className="text-center text-base text-ink-faint">
          Noch keine Daten – starte einen Scan, um die Belegung zu ermitteln.
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <MetricTile label="Gesamt" value={formatBytes(breakdown.totalBytes)} />
            <MetricTile label="Belegt" value={formatBytes(breakdown.usedBytes)} />
            <MetricTile label="Frei" value={formatBytes(breakdown.freeBytes)} />
          </div>

          <div className="flex flex-wrap gap-2">
            {breakdown.categories.map((category) => (
              <span
                key={category.kind}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm"
              >
                <Badge tone={KIND_TONES[category.kind]}>{storageKindLabel(category.kind)}</Badge>
                <span className="text-ink-muted">{formatBytes(category.sizeBytes)}</span>
                <span className="text-ink-faint">({formatNumber(category.entryCount)})</span>
              </span>
            ))}
          </div>

          <div className="max-w-xs">
            <SelectField
              label="Kategorie"
              value={kindFilter}
              onChange={(value) => setKindFilter(value as StorageEntryKind | '')}
              placeholder="Alle Kategorien"
              options={breakdown.categories.map((category) => ({
                value: category.kind,
                label: storageKindLabel(category.kind),
              }))}
            />
          </div>

          {entries.length === 0 ? (
            <Panel className="text-center text-sm text-ink-faint">
              Keine Einträge in dieser Kategorie.
            </Panel>
          ) : (
            <AdminTable>
              <thead>
                <tr>
                  <Th>Eintrag</Th>
                  <Th>Kategorie</Th>
                  <Th className="text-right">Größe</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Aktion</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="text-ink">
                      <div className="flex flex-col">
                        <span>{entry.label}</span>
                        {entry.path ? (
                          <span className="font-mono text-2xs text-ink-faint">{entry.path}</span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={KIND_TONES[entry.kind]}>{storageKindLabel(entry.kind)}</Badge>
                    </Td>
                    <Td className="text-right">{formatBytes(entry.sizeBytes)}</Td>
                    <Td>{entry.inUse ? 'In Benutzung' : 'Ungenutzt'}</Td>
                    <Td className="text-right">
                      {entry.permissions.canDelete ? (
                        <Button
                          variant="danger"
                          iconLeft="trash"
                          onClick={() => setToDelete(entry)}
                        >
                          Löschen
                        </Button>
                      ) : (
                        <span
                          className="text-2xs text-ink-faint"
                          title={
                            entry.deleteBlockedReason
                              ? storageBlockReasonLabel(entry.deleteBlockedReason)
                              : undefined
                          }
                        >
                          Nicht löschbar
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          )}
        </>
      )}

      {toDelete ? (
        <DangerConfirmDialog
          open
          onClose={() => setToDelete(null)}
          title={`„${toDelete.label}" löschen?`}
          confirmLabel="Endgültig löschen"
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          message={`${storageKindLabel(toDelete.kind)} · ${formatBytes(
            toDelete.sizeBytes,
          )} werden unwiderruflich von der Node entfernt.`}
        />
      ) : null}
    </div>
  );
}
