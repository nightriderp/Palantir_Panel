'use client';

import {
  MIN_PUBLIC_PORT,
  type GameServerDto,
  type PortAllocationDto,
  type PortPoolDto,
  type PortProtocol,
  type PortRangeDto,
} from '@palantir/contracts';
import { useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FormModal,
  MetricTile,
  NumberField,
  PageHeader,
  Panel,
  SelectField,
  TextField,
  Toggle,
  formatDateTime,
  formatNumber,
  formatServerAddress,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  createPortRange,
  deletePortRange,
  fetchAllServers,
  fetchPortAllocations,
  fetchPortPool,
  releasePortAllocation,
  updatePortRange,
} from '@/lib/api/admin';
import { type ApiResult, errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading, AdminTable, Td, Th } from '../common';

/**
 * Adressen – öffentlicher Port-Bereich der VPS (Lastenheft §3.7, Pflichtenheft §2.4).
 *
 * Verwaltet werden nur die **Bereiche**, aus denen vergeben wird; die einzelne
 * Zuordnung entsteht und verschwindet automatisch mit dem Server. Ein Bereich
 * mit noch vergebenen Ports ist nicht löschbar (`permissions.canDelete` aus dem
 * Contract), eine Zuordnung nur bei verwaisten Einträgen freigebbar
 * (`permissions.canRelease`).
 */

const PROTOCOL_OPTIONS: Array<{ value: PortProtocol; label: string }> = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
];

type Editor = { mode: 'create' } | { mode: 'edit'; range: PortRangeDto } | null;

export function AddressesView() {
  const { user } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageAddresses ?? false;

  const pool = useApiResource<PortPoolDto>(
    (signal) => fetchPortPool(signal),
    canManage ? [] : null,
  );
  const allocations = useApiResource<PortAllocationDto[]>(
    (signal) => fetchPortAllocations(signal),
    canManage ? [] : null,
  );

  const [editor, setEditor] = useState<Editor>(null);
  const [toDelete, setToDelete] = useState<PortRangeDto | null>(null);
  const [busy, setBusy] = useState(false);

  function reloadAll() {
    pool.reload();
    allocations.reload();
  }

  async function toggleEnabled(range: PortRangeDto, enabled: boolean) {
    const result = await updatePortRange(range.id, { enabled });
    if (result.success) {
      pool.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    const result = await deletePortRange(toDelete.id);
    setBusy(false);
    if (result.success) {
      toast.success(`Bereich „${toDelete.label}" gelöscht.`);
      setToDelete(null);
      reloadAll();
    } else {
      toast.error(errorText(result));
    }
  }

  async function release(allocation: PortAllocationDto) {
    const result = await releasePortAllocation(allocation.id);
    if (result.success) {
      toast.success(`Port ${allocation.port} freigegeben.`);
      reloadAll();
    } else {
      toast.error(errorText(result));
    }
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Adressen" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Adressverwaltung" />
      </div>
    );
  }

  const data = pool.data;
  const ranges = data?.ranges ?? [];
  const releasable = (allocations.data ?? []).filter((entry) => entry.permissions.canRelease);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Adressen"
        subtitle="Subdomains, Portblöcke und der öffentliche Port-Bereich der VPS"
        className="-mx-5 -mt-5 px-5"
        actions={
          <Button variant="primary" iconLeft="plus" onClick={() => setEditor({ mode: 'create' })}>
            Neuer Bereich
          </Button>
        }
      />

      <ServerAddressTable />

      {pool.loading ? (
        <AdminLoading label="Port-Pool wird geladen …" />
      ) : pool.error ? (
        <AdminError message={pool.error} onRetry={pool.reload} />
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <MetricTile label="Ports gesamt" value={formatNumber(data.totalPorts)} />
            <MetricTile label="Vergeben" value={formatNumber(data.allocatedPorts)} />
            <MetricTile label="Frei" value={formatNumber(data.availablePorts)} />
          </div>

          {ranges.length === 0 ? (
            <Panel className="text-center text-base text-ink-faint">
              Noch kein Port-Bereich angelegt.
            </Panel>
          ) : (
            <ul className="flex flex-col gap-3">
              {ranges.map((range) => (
                <li key={range.id}>
                  <Panel className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold text-ink">{range.label}</span>
                          <Badge tone="neutral">{range.protocol.toUpperCase()}</Badge>
                          {!range.enabled ? <Badge tone="warning">Deaktiviert</Badge> : null}
                        </div>
                        <span className="font-mono text-sm text-ink-muted">
                          {range.startPort}–{range.endPort}
                        </span>
                        <span className="text-sm text-ink-faint">
                          {formatNumber(range.allocatedPorts)} vergeben ·{' '}
                          {formatNumber(range.availablePorts)} frei
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {range.permissions.canEdit ? (
                          <Toggle
                            checked={range.enabled}
                            onChange={(on) => void toggleEnabled(range, on)}
                            label="Aktiv"
                          />
                        ) : null}
                        {range.permissions.canEdit ? (
                          <Button
                            variant="secondary"
                            iconLeft="gear"
                            onClick={() => setEditor({ mode: 'edit', range })}
                          >
                            Bearbeiten
                          </Button>
                        ) : null}
                        {range.permissions.canDelete ? (
                          <Button
                            variant="danger"
                            iconLeft="trash"
                            onClick={() => setToDelete(range)}
                          >
                            Löschen
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </Panel>
                </li>
              ))}
            </ul>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-ink">Verwaiste Zuordnungen</h2>
            {allocations.loading ? (
              <Panel className="text-center text-sm text-ink-faint">Wird geladen …</Panel>
            ) : releasable.length === 0 ? (
              <Panel className="text-center text-sm text-ink-faint">
                Keine verwaisten Port-Zuordnungen – alle Ports gehören zu einem Server.
              </Panel>
            ) : (
              <AdminTable>
                <thead>
                  <tr>
                    <Th>Port</Th>
                    <Th>Protokoll</Th>
                    <Th>Ehemaliger Server</Th>
                    <Th>Seit</Th>
                    <Th className="text-right">Aktion</Th>
                  </tr>
                </thead>
                <tbody>
                  {releasable.map((allocation) => (
                    <tr key={allocation.id}>
                      <Td className="font-mono text-ink">{allocation.port}</Td>
                      <Td>{allocation.protocol.toUpperCase()}</Td>
                      <Td>{allocation.serverName ?? '—'}</Td>
                      <Td className="whitespace-nowrap">
                        {formatDateTime(allocation.allocatedAt)}
                      </Td>
                      <Td className="text-right">
                        <Button
                          variant="secondary"
                          iconLeft="close"
                          onClick={() => void release(allocation)}
                        >
                          Freigeben
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            )}
          </section>
        </>
      ) : null}

      {editor ? (
        <RangeEditor
          editor={editor}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setEditor(null)}
          onSaved={(label) => {
            toast.success(
              editor.mode === 'create'
                ? `Bereich „${label}" angelegt.`
                : `Bereich „${label}" gespeichert.`,
            );
            setEditor(null);
            reloadAll();
          }}
        />
      ) : null}

      {toDelete ? (
        <DangerConfirmDialog
          open
          onClose={() => setToDelete(null)}
          title={`Bereich „${toDelete.label}" löschen?`}
          confirmLabel="Bereich löschen"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          message="Aus diesem Bereich werden keine Ports mehr vergeben. Bereits vergebene Ports sind nicht betroffen."
        />
      ) : null}
    </div>
  );
}

/** Anlegen oder Bearbeiten eines Port-Bereichs. */
function RangeEditor({
  editor,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Exclude<Editor, null>;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onClose: () => void;
  onSaved: (label: string) => void;
}) {
  const initial = editor.mode === 'edit' ? editor.range : null;
  const [label, setLabel] = useState(initial?.label ?? '');
  const [startPort, setStartPort] = useState(initial?.startPort ?? MIN_PUBLIC_PORT);
  const [endPort, setEndPort] = useState(initial?.endPort ?? MIN_PUBLIC_PORT);
  const [protocol, setProtocol] = useState<PortProtocol>(initial?.protocol ?? 'tcp');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const labelValid = label.trim().length >= 2 && label.trim().length <= 50;
  const boundsValid = startPort <= endPort;

  async function submit() {
    setBusy(true);
    setError(null);
    const result: ApiResult<PortRangeDto> =
      editor.mode === 'create'
        ? await createPortRange({ label: label.trim(), startPort, endPort, protocol, enabled })
        : await updatePortRange(editor.range.id, {
            label: label.trim(),
            startPort,
            endPort,
            enabled,
          });
    setBusy(false);
    if (result.success) {
      onSaved(result.data.label);
    } else {
      setError(errorText(result));
    }
  }

  return (
    <FormModal
      open
      onClose={onClose}
      title={editor.mode === 'create' ? 'Neuer Port-Bereich' : `Bereich „${editor.range.label}"`}
      submitLabel={editor.mode === 'create' ? 'Anlegen' : 'Speichern'}
      submitDisabled={!labelValid || !boundsValid}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
    >
      <TextField
        label="Bezeichnung"
        value={label}
        onChange={setLabel}
        placeholder="z. B. Standardbereich"
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Erster Port"
          value={startPort}
          onChange={setStartPort}
          min={MIN_PUBLIC_PORT}
          max={65535}
        />
        <NumberField
          label="Letzter Port"
          value={endPort}
          onChange={setEndPort}
          min={MIN_PUBLIC_PORT}
          max={65535}
          error={
            !boundsValid ? 'Der erste Port muss kleiner oder gleich dem letzten sein.' : undefined
          }
        />
      </div>
      {editor.mode === 'create' ? (
        <SelectField
          label="Protokoll"
          value={protocol}
          onChange={(value) => setProtocol(value as PortProtocol)}
          options={PROTOCOL_OPTIONS}
        />
      ) : null}
      <Toggle checked={enabled} onChange={setEnabled} label="Bereich ist aktiv" />
    </FormModal>
  );
}

/**
 * Adressen aller Server (Mockup „Adressen").
 *
 * Der Entwurf zeigt auf dieser Seite eine Tabelle über alle Server mit Spiel,
 * Node, Subdomain und Verbindungsadresse. Die App verwaltet hier daneben die
 * Portbereiche der VPS (Pflichtenheft §13) – beides gehört zum Thema „Adresse",
 * deshalb steht die Übersicht auf derselben Seite und nicht in einer eigenen.
 *
 * **Ohne DNS-Spalte:** Das Mockup führt dort einen Zustand („aktiv · SRV" /
 * „ausstehend"). Im `GameServerDto` gibt es dafür kein Feld; eine erfundene
 * Anzeige wäre schlechter als keine. Vermerkt im Abgleich (12.7.2).
 */
function ServerAddressTable() {
  const servers = useApiResource<GameServerDto[]>((signal) => fetchAllServers(signal), []);
  const list = servers.data ?? [];

  return (
    <Panel className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-ink">Server-Adressen</h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          Subdomain und Verbindungsadresse jedes angelegten Servers.
        </p>
      </div>

      {servers.loading ? (
        <AdminLoading label="Server werden geladen …" />
      ) : servers.error ? (
        <AdminError message={servers.error} onRetry={servers.reload} />
      ) : list.length === 0 ? (
        <p className="text-base text-ink-faint">Es ist noch kein Server angelegt.</p>
      ) : (
        <AdminTable>
          <thead>
            <tr>
              <Th>Server</Th>
              <Th>Spiel</Th>
              <Th>Node</Th>
              <Th>Subdomain</Th>
              <Th>Verbindungsadresse</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((server) => (
              <tr key={server.id}>
                <Td className="text-ink">{server.name}</Td>
                <Td>{server.gameTypeName}</Td>
                <Td>{server.hostName ?? '—'}</Td>
                <Td className="font-mono text-sm">{server.subdomain}</Td>
                <Td className="font-mono text-sm text-ink-muted">
                  {formatServerAddress(server.address) ?? 'nicht freigegeben'}
                </Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}
    </Panel>
  );
}
