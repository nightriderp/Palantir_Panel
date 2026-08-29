'use client';

import { useState } from 'react';
import { type HostNodeDto } from '@palantir/contracts';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  PageHeader,
  Panel,
  formatDateTime,
  formatMegabytes,
  formatNumber,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { deleteNode, fetchNodes, updateNode } from '@/lib/api/admin';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { NODE_STATUS_META } from '@/components/nodes/nodeStatus';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';
import { AddNodeWizard } from './AddNodeWizard';

/**
 * Node-Verwaltung im Admin-Bereich (Lastenheft §3.7).
 *
 * Anlegen über den {@link AddNodeWizard} (inkl. Anbinde-Anleitung), sowie je Node
 * Wartung ein/aus und Entfernen. Der Zustand „online" wird nicht von Hand gesetzt
 * – das entscheidet die Agent-Verbindung; deshalb schaltet „Wartung beenden" auf
 * `offline`, bis der Agent die Node wieder meldet.
 */
export function NodesAdminView() {
  const { user } = useSession();
  const canManage = user?.permissions.canManageNodes ?? false;
  const toast = useToast();

  const {
    data: nodes,
    loading,
    error,
    reload,
  } = useApiResource<HostNodeDto[]>((signal) => fetchNodes(signal), canManage ? [] : null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HostNodeDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Nodes" />
        <div className="px-5 py-5">
          <AdminAccessNotice area="die Node-Verwaltung" />
        </div>
      </div>
    );
  }

  async function toggleMaintenance(node: HostNodeDto) {
    setBusyId(node.id);
    const next = node.status === 'maintenance' ? 'offline' : 'maintenance';
    const result = await updateNode(node.id, { status: next });
    setBusyId(null);

    if (result.success) {
      toast.success(next === 'maintenance' ? 'Node in Wartung genommen.' : 'Wartung beendet.');
      reload();
    } else {
      toast.error(errorText(result));
    }
  }

  async function confirmDelete() {
    if (pendingDelete === null) {
      return;
    }
    setBusyId(pendingDelete.id);
    const result = await deleteNode(pendingDelete.id);
    setBusyId(null);

    if (result.success) {
      toast.success(`Node „${pendingDelete.name}" entfernt.`);
      setPendingDelete(null);
      reload();
    } else {
      toast.error(errorText(result));
    }
  }

  return (
    <div>
      <PageHeader
        title="Nodes"
        subtitle="Gameserver-Hosts anbinden und verwalten."
        actions={
          <Button variant="primary" iconLeft="plus" onClick={() => setWizardOpen(true)}>
            Node hinzufügen
          </Button>
        }
      />

      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 py-5">
        {loading ? (
          <AdminLoading label="Nodes werden geladen …" />
        ) : error ? (
          <AdminError message={error} onRetry={reload} />
        ) : nodes && nodes.length > 0 ? (
          nodes.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              busy={busyId === node.id}
              onToggleMaintenance={() => toggleMaintenance(node)}
              onDelete={() => setPendingDelete(node)}
            />
          ))
        ) : (
          <Panel>
            <p className="text-base text-ink-muted">
              Noch keine Node angebunden. Lege mit „Node hinzufügen“ die erste an.
            </p>
          </Panel>
        )}
      </div>

      <AddNodeWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={reload} />

      <DangerConfirmDialog
        open={pendingDelete !== null}
        onClose={() => (busyId ? undefined : setPendingDelete(null))}
        title="Node entfernen"
        message={
          pendingDelete
            ? `Die Node „${pendingDelete.name}" wird entfernt. Solange noch Server auf ihr liegen, lehnt das Backend die Löschung ab.`
            : ''
        }
        confirmationPhrase={pendingDelete?.name ?? ''}
        confirmLabel="Node entfernen"
        onConfirm={confirmDelete}
        busy={busyId === pendingDelete?.id}
      />
    </div>
  );
}

function NodeRow({
  node,
  busy,
  onToggleMaintenance,
  onDelete,
}: {
  node: HostNodeDto;
  busy: boolean;
  onToggleMaintenance: () => void;
  onDelete: () => void;
}) {
  const status = NODE_STATUS_META[node.status];

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-ink">{node.name}</h2>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-0.5 font-mono text-xs text-ink-faint">{node.wireguardIp}</p>
        </div>
        {node.permissions.canManage ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={onToggleMaintenance}>
              {node.status === 'maintenance' ? 'Wartung beenden' : 'In Wartung'}
            </Button>
            <Button variant="danger" size="sm" iconLeft="trash" disabled={busy} onClick={onDelete}>
              Entfernen
            </Button>
          </div>
        ) : null}
      </div>

      {node.statusMessage ? (
        <p className="mt-2 text-sm text-warning">{node.statusMessage}</p>
      ) : null}

      <dl className="mt-4 grid gap-3 sm:grid-cols-4">
        <Metric label="RAM" value={formatMegabytes(node.capacity.total.ramMb)} />
        <Metric label="CPU-Kerne" value={formatNumber(node.capacity.total.cpuCores)} />
        <Metric label="Speicher" value={formatMegabytes(node.capacity.total.diskMb)} />
        <Metric label="Server" value={formatNumber(node.serverCount)} />
      </dl>

      <p className="mt-3 text-xs text-ink-faint">
        {node.lastSeenAt
          ? `Zuletzt gesehen: ${formatDateTime(node.lastSeenAt)}`
          : 'Noch nie verbunden – der Agent hat sich bisher nicht gemeldet.'}
      </p>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1 text-base text-ink-muted">{value}</dd>
    </div>
  );
}
