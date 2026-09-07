'use client';

import {
  type BackupDto,
  type BackupProgress,
  type GameConfigValue,
  type GameServerDto,
  type GameTypeDto,
  type ServerCloneJobDto,
} from '@palantir/contracts';
import {
  type CloneServerInput,
  type UpdateServerSettingsInput,
  cloneServerInputSchema,
  updateServerSettingsInputSchema,
} from '@palantir/validation';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_STATUS_META,
  Badge,
  Button,
  DangerConfirmDialog,
  FormModal,
  NumberField,
  Panel,
  TextField,
  ToggleRow,
  formatDateTime,
  formatMegabytes,
  useToast,
} from '@/components/shared';
import {
  backupDownloadUrl,
  cloneServer,
  deleteServer,
  fetchBackup,
  fetchCloneJob,
  fetchGameTypes,
  startExport,
  updateServerSettings,
} from '@/lib/api/servers';
import { errorText, isAborted } from '@/lib/api/client';
import { BASE_DOMAIN } from '@/lib/api/session';
import { useApiResource } from '@/lib/api/useApiResource';
import { type LiveConnectionState } from '@/lib/live/LiveChannelProvider';
import { forgetCloneJob, rememberCloneJob, rememberedCloneJob } from '@/lib/live/cloneJobHandle';
import { ConfigFields } from '../form/ConfigFields';
import { ResourceFields } from '../form/ResourceFields';
import { formatBytes } from '../formatDetail';
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
  /**
   * Zustand des Live-Kanals (Fundpunkt event-flow-06).
   *
   * Nach einem Wiederanlauf liefert das Backend keinen Schnappschuss nach
   * (event-flow-03); der Klon-Stand wird deshalb hier aktiv nachgeholt.
   */
  connection: LiveConnectionState;
  /**
   * Stand der laufenden Sicherung aus dem Live-Kanal (Gefundener Punkt 51).
   *
   * Betrifft hier nur den Export; gewöhnliche Sicherungen zeigt der Reiter
   * „Backups".
   */
  backupProgress: BackupProgress | null;
}

export function SettingsTab({
  server,
  onServerUpdated,
  cloneJob,
  connection,
  backupProgress,
}: SettingsTabProps) {
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
    // Nicht vorbelegt: Anhalten greift in den laufenden Betrieb ein und bleibt
    // eine bewusste Entscheidung des Nutzers (Gefundener Punkt 107).
    stopSourceServer: false,
  });
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [localCloneJob, setLocalCloneJob] = useState<ServerCloneJobDto | null>(null);
  const [exportBackup, setExportBackup] = useState<BackupDto | null>(null);
  const [exporting, setExporting] = useState(false);
  /**
   * Server für den Export anhalten.
   *
   * Vorgabe „aus": Ein Export soll niemanden aus dem Spiel werfen. Wer einen
   * verlässlichen Spielstand mitnehmen will, schaltet die Option ein – ein
   * laufender Server schreibt weiter in die Dateien, die gerade gepackt werden.
   */
  const [exportStopServer, setExportStopServer] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cloneSubdomain = useSubdomainCheck(cloneDraft.subdomain);
  const gameTypes = useApiResource<GameTypeDto[]>((signal) => fetchGameTypes(signal), []);
  const gameType = gameTypes.data?.find((entry) => entry.id === server.gameType) ?? null;

  /*
   * Formular auf den angezeigten Server einstellen (Fundpunkt frontend-lib-04).
   *
   * Der Effekt hing an `server` – und `ServerDetail` baut bei **jedem**
   * Live-Statuswechsel ein neues DTO-Objekt (`{...data, status, statusMessage}`).
   * Wer während des Startvorgangs Startparameter oder Namen tippte, verlor die
   * Eingabe kommentarlos, sobald `starting → running` eintraf. Der Status hat
   * mit dem Formular nichts zu tun; zurückgesetzt wird deshalb nur noch beim
   * Wechsel auf einen **anderen** Server.
   *
   * Der Server steckt in einer Referenz, damit der Effekt beim Aufbau den
   * aktuellen Stand liest, ohne dass jede Änderung daran ihn erneut auslöst.
   */
  const serverRef = useRef(server);
  serverRef.current = server;

  useEffect(() => {
    setDraft(toDraft(serverRef.current));
  }, [server.id]);

  /*
   * Klon-Stand nachholen (Fundpunkt event-flow-06).
   *
   * `fetchCloneJob` gab es seit F3, gerufen hat es nie jemand: Der Fortschritt
   * lebte allein in der 202-Antwort und im Live-Ereignis. Wer die Detailseite
   * verließ und zurückkam – oder die Seite neu lud –, sah nichts mehr, obwohl
   * der Auftrag weiterlief. Und riss der Kanal ab, blieb die Anzeige für immer
   * bei „Wartet 0 %", weil nach einem Wiederanlauf kein Schnappschuss
   * nachgeliefert wird (event-flow-03).
   *
   * Der Effekt läuft deshalb beim Öffnen des Reiters **und** bei jedem Wechsel
   * des Verbindungszustands, also insbesondere nach jedem Wiederanlauf. Ohne
   * gemerkten Auftrag kostet er nichts – dann gibt es auch keine Id, die man
   * abfragen könnte.
   */
  useEffect(() => {
    const gemerkt = rememberedCloneJob(server.id);

    if (gemerkt === null) return;

    // Sofort etwas zeigen; die Antwort ersetzt es gleich durch die Wahrheit.
    setLocalCloneJob((aktuell) => aktuell ?? gemerkt);

    let verworfen = false;

    void fetchCloneJob(server.id, gemerkt.id).then((ergebnis) => {
      if (verworfen || isAborted(ergebnis)) return;

      if (ergebnis.success) {
        setLocalCloneJob(ergebnis.data);
        rememberCloneJob(ergebnis.data);

        return;
      }

      // Netzfehler o. Ä.: Der gemerkte Stand bleibt stehen, es wird erneut
      // versucht, sobald sich der Kanal wieder meldet.
      if (ergebnis.error.code !== 'SERVER_NOT_FOUND') return;

      /*
       * Das Backend kennt den Auftrag nicht mehr. Die Auftragsliste liegt dort
       * bewusst im Arbeitsspeicher (`clone-jobs.ts`) – nach einem Neustart ist
       * sie leer und der Hintergrundlauf tot. Als „läuft" stehen zu bleiben
       * wäre die schlechteste Auskunft: Der Nutzer wartet auf etwas, das nicht
       * mehr passiert.
       */
      const hinweis =
        'Der Auftrag ist nicht mehr bekannt – vermutlich wurde die Verwaltung zwischendurch neu gestartet. Bitte prüfe, ob der Klon angelegt wurde, bevor du es erneut versuchst.';

      forgetCloneJob(server.id);
      setLocalCloneJob({
        ...gemerkt,
        status: 'cancelled',
        // `JobProgress` zeigt `statusMessage` nur bei `failed`; für alles andere
        // ist `step` die sichtbare Zeile – der Hinweis steht deshalb in beiden.
        step: hinweis,
        statusMessage: hinweis,
        finishedAt: new Date().toISOString(),
      });
    });

    return () => {
      verworfen = true;
    };
  }, [server.id, connection]);

  // Den über den Kanal gemeldeten Stand mitschreiben, damit er ein Neuladen
  // der Seite überlebt. Abgeschlossene Aufträge vergisst der Merkzettel selbst.
  useEffect(() => {
    if (cloneJob === null) return;

    rememberCloneJob(cloneJob);
  }, [cloneJob]);

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
    // Merken, damit der Fortschritt Reiterwechsel und Neuladen übersteht
    // (Fundpunkt event-flow-06).
    rememberCloneJob(result.data);
    setCloneOpen(false);
    toast.success(
      parsed.data.includeWorldData
        ? parsed.data.stopSourceServer
          ? 'Der Klon wird angelegt – der Server wird für die Kopie kurz angehalten.'
          : 'Der Klon wird angelegt – die Weltdaten werden kopiert.'
        : 'Der Klon wird angelegt.',
    );
  }

  async function exportAll() {
    setExporting(true);
    const result = await startExport(server.id, { stopServer: exportStopServer });
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
   * Seit dem Live-Ereignis `backup.progressed` (Gefundener Punkt 51) meldet
   * sich der Fortschritt von selbst; dieser Weg bleibt als Rückfall, wenn der
   * Live-Kanal getrennt ist – und er holt den vollständigen DTO, den das
   * Ereignis bewusst nicht trägt (Prüfsumme, Ablageort).
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

  /*
   * Live gemeldeten Stand in die Anzeige übernehmen (Gefundener Punkt 51).
   *
   * Nur für den Export, den diese Ansicht angestoßen hat – eine gewöhnliche
   * Sicherung desselben Servers geht sie nichts an. Gemischt wird in den
   * vorhandenen DTO hinein: Das Ereignis trägt bewusst keine aufrufer-
   * abhängigen Felder, die hier sonst verloren gingen.
   */
  useEffect(() => {
    if (!backupProgress || backupProgress.backupId !== exportBackup?.id) return;

    setExportBackup((vorher) =>
      vorher === null
        ? vorher
        : {
            ...vorher,
            status: backupProgress.status,
            sizeBytes: backupProgress.sizeBytes,
            completedAt: backupProgress.completedAt,
            failureMessage: backupProgress.failureMessage,
          },
    );
  }, [backupProgress, exportBackup?.id]);

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
            hint="Werden dem Server beim Start als PALANTIR_STARTUP_PARAMETERS übergeben. Leer lassen, wenn unsicher."
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
              // Leer ist hier eine gültige Aussage („Standardwert der Instanz")
              // und wird als `null` gespeichert – nicht als 0
              // (Audit-Fundstelle frontend-lib-13).
              value={draft.autoShutdownTimeoutMinutes}
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
            {/*
              Der Export ist bei B5 eine Sicherung – deshalb dieselbe Tabelle
              wie im Backup-Reiter (Audit frontend-lib-14), statt einer eigenen.
            */}
            <Badge
              tone={BACKUP_STATUS_META[exportBackup.status].tone}
              withDot
              pulse={exportBackup.status === 'pending' || exportBackup.status === 'running'}
            >
              {BACKUP_STATUS_META[exportBackup.status].label}
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
          <div className="flex flex-col gap-3">
            <ToggleRow
              title="Server für den Export anhalten"
              description="Ein laufender Server schreibt weiter – ohne Anhalten kann der Spielstand im Archiv unvollständig sein."
              checked={exportStopServer}
              onChange={setExportStopServer}
              disabled={exporting}
            />
            <Button onClick={() => void exportAll()} disabled={exporting}>
              {exporting ? 'Wird angestoßen …' : 'Export starten'}
            </Button>
          </div>
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
        {cloneDraft.includeWorldData ? (
          <ToggleRow
            title="Quellserver für die Kopie anhalten"
            description="Ein laufender Server schreibt weiter – ohne Anhalten kann der kopierte Spielstand unvollständig sein. Danach läuft er wieder wie zuvor."
            checked={cloneDraft.stopSourceServer === true}
            onChange={(checked) =>
              setCloneDraft((current) => ({ ...current, stopSourceServer: checked }))
            }
          />
        ) : null}
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
