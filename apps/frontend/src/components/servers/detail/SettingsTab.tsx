'use client';

import {
  type GameConfigValue,
  type GameServerDto,
  type GameTypeDto,
  type ServerCloneJobDto,
  type BackupDto,
} from '@palantir/contracts';
import {
  type CloneServerInput,
  type UpdateServerSettingsInput,
  cloneServerInputSchema,
  updateServerSettingsInputSchema,
} from '@palantir/validation';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FormModal,
  Panel,
  type Tone,
  formatMegabytes,
  useToast,
} from '@/components/shared';
import {
  backupDownloadUrl,
  cloneServer,
  deleteServer,
  fetchBackup,
  fetchGameTypes,
  startExport,
  updateServerSettings,
} from '@/lib/api/servers';
import { errorText } from '@/lib/api/client';
import { BASE_DOMAIN } from '@/lib/api/session';
import { useApiResource } from '@/lib/api/useApiResource';
import { ConfigFields } from '../form/ConfigFields';
import { NumberField, TextField, ToggleRow } from '../form/Fields';
import { ResourceFields } from '../form/ResourceFields';
import { formatBytes, formatDateTime } from '../formatDetail';
import { useSubdomainCheck } from '../useSubdomainCheck';
import { JobProgress } from './JobProgress';
import { MembersPanel } from './MembersPanel';

/**
 * Reiter „Einstellungen" der Detailansicht (Lastenheft §3.3).
 *
 * Bündelt Ressourcen und Spiel-Konfiguration, Auto-Shutdown,
 * Mitgliederverwaltung, Klonen, vollständigen Export und Löschen. Jeder Block
 * erscheint nur, wenn das passende Flag im `permissions`-Objekt gesetzt ist
 * (Pflichtenheft §5.2).
 */

/** Anzeige des Export-Fortschritts – der Export ist bei B5 eine Sicherung. */
const EXPORT_STATUS_LABELS: Record<BackupDto['status'], string> = {
  pending: 'Wartet',
  running: 'Läuft …',
  completed: 'Fertig',
  failed: 'Fehlgeschlagen',
};

const EXPORT_STATUS_TONE: Record<BackupDto['status'], Tone> = {
  pending: 'warning',
  running: 'warning',
  completed: 'success',
  failed: 'danger',
};

function toDraft(server: GameServerDto): UpdateServerSettingsInput {
  return {
    name: server.name,
    resourceLimits: { ...server.resourceLimits },
    config: { ...server.config },
    startupParameters: server.startupParameters,
    autoShutdownEnabled: server.autoShutdownEnabled,
    autoShutdownTimeoutMinutes: server.autoShutdownTimeoutMinutes,
  };
}

export interface SettingsTabProps {
  server: GameServerDto;
  onServerUpdated: (server: GameServerDto) => void;
  /** Klon-Auftrag aus dem Live-Kanal, solange einer läuft. */
  cloneJob: ServerCloneJobDto | null;
}

export function SettingsTab({ server, onServerUpdated, cloneJob }: SettingsTabProps) {
  const router = useRouter();
  const toast = useToast();

  const [draft, setDraft] = useState<UpdateServerSettingsInput>(() => toDraft(server));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneDraft, setCloneDraft] = useState<CloneServerInput>({
    name: `${server.name} (Kopie)`,
    subdomain: '',
    includeWorldData: true,
  });
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [localCloneJob, setLocalCloneJob] = useState<ServerCloneJobDto | null>(null);
  const [exportBackup, setExportBackup] = useState<BackupDto | null>(null);
  const [exporting, setExporting] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cloneSubdomain = useSubdomainCheck(cloneDraft.subdomain);
  const gameTypes = useApiResource<GameTypeDto[]>((signal) => fetchGameTypes(signal), []);
  const gameType = gameTypes.data?.find((entry) => entry.id === server.gameType) ?? null;

  // Änderungen von außen (Live-Kanal, andere Aktion) in das Formular übernehmen,
  // solange gerade nicht gespeichert wird.
  useEffect(() => {
    setDraft(toDraft(server));
  }, [server]);

  const activeCloneJob = cloneJob ?? localCloneJob;
  const canEdit = server.permissions.canManageSettings;

  async function save() {
    const parsed = updateServerSettingsInputSchema.safeParse(draft);
    if (!parsed.success) {
      setSaveError(parsed.error.issues[0]?.message ?? 'Die Eingaben passen noch nicht.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    const result = await updateServerSettings(server.id, parsed.data);
    setSaving(false);

    if (!result.success) {
      setSaveError(errorText(result));
      return;
    }
    onServerUpdated(result.data);
    toast.success(
      result.data.pendingRestart
        ? 'Gespeichert. Die Änderungen greifen beim nächsten Neustart.'
        : 'Gespeichert.',
    );
  }

  async function clone() {
    const parsed = cloneServerInputSchema.safeParse(cloneDraft);
    if (!parsed.success) {
      setCloneError(parsed.error.issues[0]?.message ?? 'Die Eingaben passen noch nicht.');
      return;
    }
    if (cloneSubdomain.result && !cloneSubdomain.result.available) {
      setCloneError(cloneSubdomain.result.message);
      return;
    }

    setCloneBusy(true);
    const result = await cloneServer(server.id, parsed.data);
    setCloneBusy(false);

    if (!result.success) {
      setCloneError(errorText(result));
      return;
    }
    setLocalCloneJob(result.data);
    setCloneOpen(false);
    toast.success(
      parsed.data.includeWorldData
        ? 'Der Klon wird angelegt – die Weltdaten werden kopiert.'
        : 'Der Klon wird angelegt.',
    );
  }

  async function exportAll() {
    setExporting(true);
    const result = await startExport(server.id, { stopServer: false });
    setExporting(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    setExportBackup(result.data);
    toast.success(
      'Der Export wurde angestoßen. Der Download erscheint hier, sobald er fertig ist.',
    );
  }

  /**
   * Stand des Exports nachschlagen.
   *
   * Der Export ist bei B5 eine Sicherung mit `isExport`; ein eigenes
   * Fortschritts-Ereignis gibt es dafür nicht. Der Stand wird deshalb auf
   * ausdrücklichen Klick geholt, statt fortlaufend abgefragt zu werden.
   */
  async function refreshExport() {
    if (!exportBackup) return;
    const result = await fetchBackup(exportBackup.id);
    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    setExportBackup(result.data);
  }

  async function remove() {
    setDeleting(true);
    const result = await deleteServer(server.id);
    setDeleting(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    toast.success(`„${server.name}" wurde gelöscht.`);
    router.push('/servers');
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <Panel variant="plain" className="flex flex-col gap-4">
          <h3 className="text-base font-semibold">Allgemein</h3>

          <TextField
            label="Servername"
            value={draft.name}
            onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
          />

          <TextField
            label="Adresse"
            value={server.subdomain}
            onChange={() => undefined}
            disabled
            suffix={`.${BASE_DOMAIN}`}
            hint="Die Subdomain steht seit dem Anlegen fest. Für eine andere Adresse einen Klon anlegen."
          />

          <ResourceFields
            ramMb={draft.resourceLimits.ramMb}
            cpuCores={draft.resourceLimits.cpuCores}
            diskMb={draft.resourceLimits.diskMb}
            onChange={(values) =>
              setDraft((current) => ({
                ...current,
                resourceLimits: { ...current.resourceLimits, ...values },
              }))
            }
          />

          <TextField
            label="Startparameter"
            value={draft.startupParameters}
            hint="Werden beim Start an den Server übergeben."
            onChange={(value) => setDraft((current) => ({ ...current, startupParameters: value }))}
          />

          <ToggleRow
            title="Automatisch herunterfahren, wenn niemand spielt"
            description="Spart Speicher und Platte, wenn ein Server aus Versehen weiterläuft."
            checked={draft.autoShutdownEnabled}
            onChange={(checked) =>
              setDraft((current) => ({ ...current, autoShutdownEnabled: checked }))
            }
          />

          {draft.autoShutdownEnabled ? (
            <NumberField
              label="Inaktivitäts-Timeout in Minuten"
              hint="Leer lassen entspricht dem Standardwert der Instanz."
              min={5}
              max={1440}
              value={draft.autoShutdownTimeoutMinutes ?? 30}
              onChange={(value) =>
                setDraft((current) => ({ ...current, autoShutdownTimeoutMinutes: value }))
              }
            />
          ) : null}

          {gameType ? (
            <>
              <h3 className="text-base font-semibold">Spiel-Konfiguration</h3>
              <ConfigFields
                fields={gameType.configFields}
                values={draft.config}
                lockAfterCreate
                onChange={(key: string, value: GameConfigValue) =>
                  setDraft((current) => ({
                    ...current,
                    config: { ...current.config, [key]: value },
                  }))
                }
              />
            </>
          ) : null}

          {saveError ? (
            <p
              role="alert"
              className="rounded border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {saveError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button onClick={() => setDraft(toDraft(server))} disabled={saving}>
              Verwerfen
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Wird gespeichert …' : 'Speichern'}
            </Button>
          </div>
        </Panel>
      ) : null}

      {server.permissions.canManageMembers || server.memberCount > 0 ? (
        <MembersPanel server={server} />
      ) : null}

      {server.permissions.canClone ? (
        <Panel variant="plain" className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">Klonen</h3>
          <p className="text-sm text-ink-muted">
            Erzeugt einen zweiten Server mit derselben Konfiguration und einer eigenen, neuen
            Adresse. Die Weltdaten können mitkopiert werden – je nach Größe dauert das einen Moment.
          </p>

          {activeCloneJob ? (
            <JobProgress
              job={activeCloneJob}
              title={`Klon „${activeCloneJob.targetName}"`}
              bytes={{ copied: activeCloneJob.copiedBytes, total: activeCloneJob.totalBytes }}
            />
          ) : null}

          {activeCloneJob?.status === 'completed' && activeCloneJob.targetServerId ? (
            <Button
              variant="primary"
              onClick={() => router.push(`/servers/${activeCloneJob.targetServerId}`)}
            >
              Zum Klon
            </Button>
          ) : (
            <Button
              onClick={() => setCloneOpen(true)}
              disabled={activeCloneJob?.status === 'running'}
            >
              Server klonen
            </Button>
          )}
        </Panel>
      ) : null}

      <Panel variant="plain" className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Vollständiger Export</h3>
        <p className="text-sm text-ink-muted">
          Lädt alle Serverdaten als Archiv herunter – Weltdaten, Konfiguration und Sicherungen.
          Deine Daten bleiben jederzeit mitnehmbar.
        </p>

        {exportBackup ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-fill p-3.5">
            <Badge
              tone={EXPORT_STATUS_TONE[exportBackup.status]}
              withDot
              pulse={exportBackup.status === 'pending' || exportBackup.status === 'running'}
            >
              {EXPORT_STATUS_LABELS[exportBackup.status]}
            </Badge>
            <span className="font-mono text-xs text-ink-faint">
              {exportBackup.status === 'completed' ? formatBytes(exportBackup.sizeBytes) : '—'}
            </span>
            <span className="text-xs text-ink-faint">
              Angestoßen am {formatDateTime(exportBackup.createdAt)}
            </span>

            {exportBackup.status === 'completed' ? (
              <a
                href={backupDownloadUrl(exportBackup.id)}
                download
                className="ml-auto inline-flex items-center gap-2 rounded-md border border-line-strong bg-fill px-4 py-2.5 text-base font-semibold text-ink"
              >
                Archiv herunterladen
              </a>
            ) : (
              <Button size="sm" className="ml-auto" onClick={() => void refreshExport()}>
                Stand aktualisieren
              </Button>
            )}
          </div>
        ) : null}

        {exportBackup?.status === 'completed' ? null : (
          <Button onClick={() => void exportAll()} disabled={exporting}>
            {exporting ? 'Wird angestoßen …' : 'Export starten'}
          </Button>
        )}
      </Panel>

      {server.permissions.canDelete ? (
        <Panel variant="plain" className="flex flex-col gap-3 border-danger-line">
          <h3 className="text-base font-semibold text-danger">Server löschen</h3>
          <p className="text-sm text-ink-muted">
            Entfernt den Server endgültig, inklusive aller Weltdaten und Sicherungen (
            {formatMegabytes(server.resourceLimits.diskMb)} Kontingent werden frei). Vorher am
            besten einen Export ziehen.
          </p>
          <div>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Server löschen
            </Button>
          </div>
        </Panel>
      ) : null}

      <FormModal
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        title="Server klonen"
        description="Der Klon bekommt eine eigene Adresse – zwei Server dürfen sich keine teilen."
        submitLabel="Klon anlegen"
        busy={cloneBusy}
        error={cloneError}
        onSubmit={() => void clone()}
      >
        <TextField
          label="Name des Klons"
          value={cloneDraft.name}
          onChange={(value) => setCloneDraft((current) => ({ ...current, name: value }))}
        />
        <TextField
          label="Adresse"
          placeholder="subdomain"
          suffix={`.${BASE_DOMAIN}`}
          value={cloneDraft.subdomain}
          onChange={(value) =>
            setCloneDraft((current) => ({ ...current, subdomain: value.toLowerCase() }))
          }
          error={cloneSubdomain.formatError}
          hint={
            cloneSubdomain.checking
              ? 'Verfügbarkeit wird geprüft …'
              : (cloneSubdomain.result?.message ?? 'Kleinbuchstaben, Ziffern und Bindestriche.')
          }
        />
        <ToggleRow
          title="Weltdaten mitkopieren"
          description="Ohne Weltdaten startet der Klon mit einer frischen Welt."
          checked={cloneDraft.includeWorldData}
          onChange={(checked) =>
            setCloneDraft((current) => ({ ...current, includeWorldData: checked }))
          }
        />
      </FormModal>

      <DangerConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        busy={deleting}
        title="Server löschen?"
        confirmationPhrase={server.name}
        message={`„${server.name}" wird endgültig gelöscht, inklusive aller Welten und Sicherungen. Das lässt sich nicht rückgängig machen.`}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
