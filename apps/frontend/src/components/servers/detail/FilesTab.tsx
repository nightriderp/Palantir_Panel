'use client';

import {
  type GameServerDto,
  type ServerFileContentDto,
  type ServerFileEntryDto,
  type ServerFileListDto,
} from '@palantir/contracts';
import { useState } from 'react';
import {
  Button,
  DangerConfirmDialog,
  EmptyState,
  Icon,
  Modal,
  Panel,
  formatDateTime,
  useToast,
} from '@/components/shared';
import {
  deleteFile,
  fetchFileContent,
  fetchFileList,
  fileDownloadUrl,
  saveFileContent,
  uploadFile,
} from '@/lib/api/servers';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { formatBytes } from '../formatDetail';

/**
 * Reiter „Dateien" der Detailansicht (Lastenheft §3.3).
 *
 * Blättern, Hochladen, Herunterladen, Bearbeiten und Löschen im Datenordner
 * des Servers.
 *
 * **Die Upload-Grenze kommt vom Backend** (`maxUploadBytes` im
 * `ServerFileListDto`, gespeist aus `MAX_UPLOAD_SIZE_BYTES`, Pflichtenheft
 * §12.1) und steht nirgends im Frontend. Die Prüfung hier erspart nur den
 * vergeblichen Upload; abgelehnt wird endgültig serverseitig
 * (`FILE_TOO_LARGE`).
 *
 * **Zwei Schranken des Vertrags sind hier bedienbar** (Audit
 * contract-drift-03): `recursive` beim Löschen und `overwrite` beim Hochladen.
 * Beide sind im Agent-Protokoll bewusst als „nur auf ausdrückliche Ansage"
 * angelegt – ein Verzeichnis mit Inhalt und eine bereits vorhandene Datei
 * bleiben unangetastet, bis jemand die Rückfrage bejaht. Vorher hob ein
 * Vorgabewert im Backend die erste Schranke auf (jedes Verzeichnis wurde samt
 * Baum gelöscht), während die zweite gar nicht erreichbar war (Ersetzen ging
 * nur über Löschen und erneutes Hochladen).
 */

/** Pfad in die Bestandteile für die Brotkrumen-Leiste zerlegen. */
function breadcrumbs(path: string): Array<{ label: string; path: string }> {
  const crumbs = [{ label: 'Datenordner', path: '' }];
  if (path.length === 0) return crumbs;

  let current = '';
  for (const segment of path.split('/').filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}

function entryIcon(entry: ServerFileEntryDto) {
  if (entry.type === 'directory') return 'layers' as const;
  return 'clipboard' as const;
}

export interface FilesTabProps {
  server: GameServerDto;
}

export function FilesTab({ server }: FilesTabProps) {
  const toast = useToast();
  const [path, setPath] = useState('');
  const [editing, setEditing] = useState<ServerFileContentDto | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ServerFileEntryDto | null>(null);
  /**
   * Datei, deren Upload am belegten Zielpfad gescheitert ist (Audit
   * contract-drift-03). Sie wird festgehalten, bis der Nutzer das Ersetzen
   * bestätigt oder abbricht – nur so kommt derselbe Upload ein zweites Mal mit
   * `overwrite` los, ohne dass er die Datei erneut auswählen muss.
   */
  const [pendingOverwrite, setPendingOverwrite] = useState<File | null>(null);

  const listing = useApiResource<ServerFileListDto>(
    (signal) => fetchFileList(server.id, path, signal),
    [server.id, path],
  );

  const data = listing.data;
  const writable = data?.writable ?? false;

  async function openFile(entry: ServerFileEntryDto) {
    if (entry.type === 'directory') {
      setPath(entry.path);
      return;
    }
    if (!entry.editable) {
      toast.warning('Diese Datei lässt sich nicht im Editor öffnen – bitte herunterladen.');
      return;
    }

    const result = await fetchFileContent(server.id, entry.path);
    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    setEditing(result.data);
    setEditDraft(result.data.content);
    setEditError(null);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const result = await saveFileContent(server.id, editing.path, editDraft);
    setSaving(false);

    if (!result.success) {
      setEditError(errorText(result));
      return;
    }
    toast.success('Datei gespeichert.');
    setEditing(null);
    listing.reload();
  }

  async function upload(file: File, overwrite = false) {
    if (data && file.size > data.maxUploadBytes) {
      toast.error(
        `„${file.name}" ist ${formatBytes(file.size)} groß. Erlaubt sind höchstens ${formatBytes(data.maxUploadBytes)} pro Datei.`,
      );
      return;
    }

    setBusy(true);
    const result = await uploadFile(server.id, path, file, overwrite);
    setBusy(false);

    if (!result.success) {
      /*
       * Der Zielpfad ist belegt (Audit contract-drift-03). Statt den Nutzer
       * mit einem Fehler stehen zu lassen – ersetzen ginge sonst nur über
       * Löschen und erneutes Hochladen – wird gefragt und der Upload auf
       * Wunsch mit `overwrite` wiederholt.
       */
      if (result.error.code === 'AGENT_FILE_EXISTS') {
        setPendingOverwrite(file);
        return;
      }
      // Jeder andere Fehler beendet den Vorgang – auch den zweiten Anlauf mit
      // `overwrite`, dessen Dialog sonst offen stehen bliebe.
      setPendingOverwrite(null);
      toast.error(errorText(result));
      return;
    }
    setPendingOverwrite(null);
    toast.success(`„${file.name}" hochgeladen.`);
    listing.setData(result.data);
  }

  async function remove(entry: ServerFileEntryDto) {
    setBusy(true);
    /*
     * Den Inhalt nimmt nur ein Verzeichnis mit, und nur, weil der Dialog es
     * vorher benannt hat (Audit contract-drift-03). Bei einer Datei ist das
     * Feld ohne Bedeutung und bleibt weg.
     */
    const result = await deleteFile(server.id, entry.path, entry.type === 'directory');
    setBusy(false);
    setPendingDelete(null);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    toast.success(`„${entry.name}" gelöscht.`);
    listing.reload();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Pfad" className="flex flex-wrap items-center gap-1 text-sm">
          {breadcrumbs(path).map((crumb, index, all) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPath(crumb.path)}
                disabled={index === all.length - 1}
                className="text-brand disabled:text-ink-muted"
              >
                {crumb.label}
              </button>
              {index < all.length - 1 ? <span className="text-ink-faint">/</span> : null}
            </span>
          ))}
          {data && !writable ? (
            <span className="ml-2 rounded-full bg-fill-strong px-2 py-0.5 text-2xs text-ink-faint">
              Nur Ansicht
            </span>
          ) : null}
        </nav>

        {writable ? (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-fill px-3.5 py-1.5 text-sm font-semibold text-ink">
            <Icon name="upload" size={12} />
            {busy ? 'Wird übertragen …' : 'Hochladen'}
            <input
              type="file"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = '';
              }}
            />
          </label>
        ) : null}
      </div>

      {data ? (
        <p className="text-xs text-ink-faint">
          Höchstens {formatBytes(data.maxUploadBytes)} pro Datei.
        </p>
      ) : null}

      {listing.loading && !data ? (
        <Panel variant="outline" className="text-center text-base text-ink-muted">
          Verzeichnis wird geladen …
        </Panel>
      ) : null}

      {listing.error ? (
        <Panel variant="outline" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-base text-danger">{listing.error}</span>
          <Button onClick={listing.reload}>Erneut versuchen</Button>
        </Panel>
      ) : null}

      {data && data.entries.length === 0 ? (
        <EmptyState title="Dieses Verzeichnis ist leer" icon="layers" />
      ) : null}

      {data && data.entries.length > 0 ? (
        <Panel variant="plain" padding="none" className="overflow-hidden">
          <div className="hidden grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-line px-3.5 py-2 text-2xs uppercase tracking-[0.08em] text-ink-soft sm:grid">
            <span>Name</span>
            <span className="text-right">Größe</span>
            <span className="text-right">Geändert</span>
            <span />
          </div>

          <ul className="divide-y divide-line">
            {data.entries.map((entry) => (
              <li
                key={entry.path}
                className="grid grid-cols-1 gap-1 px-3.5 py-2.5 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-3"
              >
                <button
                  type="button"
                  onClick={() => void openFile(entry)}
                  className="flex min-w-0 items-center gap-2 text-left text-base text-ink"
                >
                  <Icon name={entryIcon(entry)} size={14} className="shrink-0 text-ink-faint" />
                  <span className="truncate">{entry.name}</span>
                </button>

                <span className="font-mono text-xs text-ink-faint sm:text-right">
                  {entry.type === 'directory' ? '—' : formatBytes(entry.sizeBytes)}
                </span>
                <span className="font-mono text-xs text-ink-faint sm:text-right">
                  {formatDateTime(entry.modifiedAt)}
                </span>

                <span className="flex gap-2 sm:justify-end">
                  {entry.downloadable ? (
                    <a
                      href={fileDownloadUrl(server.id, entry.path)}
                      className="text-xs text-brand"
                      download
                    >
                      Herunterladen
                    </a>
                  ) : null}
                  {writable ? (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(entry)}
                      className="text-xs text-danger"
                    >
                      Löschen
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? editing.path : ''}
        className="max-w-3xl"
        footer={
          <>
            <Button onClick={() => setEditing(null)} disabled={saving}>
              Schließen
            </Button>
            {editing?.writable ? (
              <Button variant="primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Wird gespeichert …' : 'Speichern'}
              </Button>
            ) : null}
          </>
        }
      >
        <textarea
          value={editDraft}
          onChange={(event) => setEditDraft(event.target.value)}
          readOnly={!editing?.writable}
          spellCheck={false}
          aria-label="Dateiinhalt"
          className="h-[50vh] w-full resize-y rounded-md border border-line-strong bg-fill p-3 font-mono text-xs text-ink outline-none focus-visible:border-brand"
        />
        {editError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {editError}
          </p>
        ) : null}
      </Modal>

      {/*
        Der Dialog benennt den Unterschied, den der Vertrag macht (Audit
        contract-drift-03): Bei einem Verzeichnis geht der gesamte Inhalt mit –
        genau dafür schickt die Bestätigung `recursive`. Vorher stand über
        beiden Fällen „Datei löschen?", und ein Klick neben `world/` nahm
        wortlos den ganzen Regionsbaum mit.
      */}
      <DangerConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        busy={busy}
        title={pendingDelete?.type === 'directory' ? 'Verzeichnis löschen?' : 'Datei löschen?'}
        message={
          pendingDelete
            ? pendingDelete.type === 'directory'
              ? `„${pendingDelete.name}" wird mit seinem gesamten Inhalt endgültig aus dem Datenordner entfernt.`
              : `„${pendingDelete.name}" wird endgültig aus dem Datenordner entfernt.`
            : ''
        }
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />

      <DangerConfirmDialog
        open={pendingOverwrite !== null}
        onClose={() => setPendingOverwrite(null)}
        busy={busy}
        title="Datei ersetzen?"
        message={
          pendingOverwrite
            ? `Im Datenordner liegt bereits „${pendingOverwrite.name}". Der bisherige Inhalt geht beim Ersetzen verloren.`
            : ''
        }
        confirmLabel="Ersetzen"
        onConfirm={() => {
          if (pendingOverwrite) void upload(pendingOverwrite, true);
        }}
      />
    </div>
  );
}
