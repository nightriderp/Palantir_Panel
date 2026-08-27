'use client';

import {
  NOTIFICATION_SEVERITIES,
  type AnnouncementDto,
  type NotificationSeverity,
} from '@palantir/contracts';
import { useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FormModal,
  PageHeader,
  Panel,
  SelectField,
  TextField,
  formatDateTime,
  formatNumber,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  updateAnnouncement,
} from '@/lib/api/admin';
import { type ApiResult, errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading, DateField, TextArea } from '../common';
import { severityLabel, severityTone } from '../labels';

/**
 * Systemweite Ankündigungen (Lastenheft §3.6).
 *
 * Technisch ein Auslöser wie jeder andere: Beim Veröffentlichen entsteht das
 * Ereignis `announcement.published`, und die Regeln entscheiden über Inbox und
 * externen Kanal. Der Datensatz bleibt eigenständig, damit eine Ankündigung
 * nachträglich korrigiert oder zurückgezogen werden kann.
 */

type Editor = { mode: 'create' } | { mode: 'edit'; announcement: AnnouncementDto } | null;

/** ISO-Datum (nur Tag) aus einem ISO-Zeitstempel für das Datumsfeld. */
function isoDay(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : iso.slice(0, 10);
}

export function AnnouncementsView() {
  const { user } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageNotifications ?? false;

  const resource = useApiResource<AnnouncementDto[]>(
    (signal) => fetchAnnouncements(signal),
    canManage ? [] : null,
  );

  const [editor, setEditor] = useState<Editor>(null);
  const [toDelete, setToDelete] = useState<AnnouncementDto | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    const result = await deleteAnnouncement(toDelete.id);
    setBusy(false);
    if (result.success) {
      toast.success(`Ankündigung „${toDelete.title}" zurückgezogen.`);
      setToDelete(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Ankündigungen" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="systemweite Ankündigungen" />
      </div>
    );
  }

  const announcements = resource.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Ankündigungen"
        subtitle="Systemweite Hinweise für alle Konten veröffentlichen"
        className="-mx-5 -mt-5 px-5"
        actions={
          <Button variant="primary" iconLeft="send" onClick={() => setEditor({ mode: 'create' })}>
            Neue Ankündigung
          </Button>
        }
      />

      {resource.loading ? (
        <AdminLoading label="Ankündigungen werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : announcements.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Noch keine Ankündigung veröffentlicht.
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-ink">{announcement.title}</span>
                      <Badge tone={severityTone(announcement.severity)}>
                        {severityLabel(announcement.severity)}
                      </Badge>
                    </div>
                    <span className="text-sm text-ink-faint">
                      Veröffentlicht {formatDateTime(announcement.publishedAt)}
                      {announcement.publishedByDisplayName
                        ? ` von ${announcement.publishedByDisplayName}`
                        : ''}{' '}
                      · {formatNumber(announcement.recipientCount)} erreicht
                      {announcement.expiresAt
                        ? ` · läuft ab ${formatDateTime(announcement.expiresAt)}`
                        : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {announcement.permissions.canEdit ? (
                      <Button
                        variant="secondary"
                        iconLeft="gear"
                        onClick={() => setEditor({ mode: 'edit', announcement })}
                      >
                        Bearbeiten
                      </Button>
                    ) : null}
                    {announcement.permissions.canDelete ? (
                      <Button
                        variant="danger"
                        iconLeft="trash"
                        onClick={() => setToDelete(announcement)}
                      >
                        Zurückziehen
                      </Button>
                    ) : null}
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm text-ink-muted">{announcement.body}</p>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {editor ? (
        <AnnouncementEditor
          editor={editor}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setEditor(null)}
          onSaved={(title) => {
            toast.success(
              editor.mode === 'create'
                ? `Ankündigung „${title}" veröffentlicht.`
                : `Ankündigung „${title}" gespeichert.`,
            );
            setEditor(null);
            resource.reload();
          }}
        />
      ) : null}

      {toDelete ? (
        <DangerConfirmDialog
          open
          onClose={() => setToDelete(null)}
          title={`„${toDelete.title}" zurückziehen?`}
          confirmLabel="Zurückziehen"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          message="Die Ankündigung wird entfernt. Bereits erzeugte Inbox-Meldungen bleiben bestehen."
        />
      ) : null}
    </div>
  );
}

function AnnouncementEditor({
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
  onSaved: (title: string) => void;
}) {
  const initial = editor.mode === 'edit' ? editor.announcement : null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [severity, setSeverity] = useState<NotificationSeverity>(initial?.severity ?? 'info');
  const [expiresDay, setExpiresDay] = useState(isoDay(initial?.expiresAt ?? null));
  const [error, setError] = useState<string | null>(null);

  const titleValid = title.trim().length >= 1 && title.trim().length <= 120;
  const bodyValid = body.trim().length >= 1 && body.trim().length <= 1800;

  async function submit() {
    setBusy(true);
    setError(null);
    // Ablauf am Ende des gewählten Tages; ohne Angabe läuft die Ankündigung nie ab.
    const expiresAt = expiresDay ? `${expiresDay}T23:59:59.999Z` : null;

    const result: ApiResult<AnnouncementDto> =
      editor.mode === 'create'
        ? await createAnnouncement({ title: title.trim(), body: body.trim(), severity, expiresAt })
        : await updateAnnouncement(editor.announcement.id, {
            title: title.trim(),
            body: body.trim(),
            severity,
            expiresAt,
          });

    setBusy(false);
    if (result.success) {
      onSaved(result.data.title);
    } else {
      setError(errorText(result));
    }
  }

  return (
    <FormModal
      open
      onClose={onClose}
      title={editor.mode === 'create' ? 'Neue Ankündigung' : 'Ankündigung bearbeiten'}
      submitLabel={editor.mode === 'create' ? 'Veröffentlichen' : 'Speichern'}
      submitDisabled={!titleValid || !bodyValid}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
    >
      <TextField label="Titel" value={title} onChange={setTitle} placeholder="Kurz und klar" />
      <TextArea
        label="Text"
        value={body}
        onChange={setBody}
        rows={6}
        maxLength={1800}
        placeholder="Was sollen alle wissen?"
        hint="Höchstens 1800 Zeichen – passt auch in eine Discord-Nachricht."
      />
      <SelectField
        label="Dringlichkeit"
        value={severity}
        onChange={(value) => setSeverity(value as NotificationSeverity)}
        options={NOTIFICATION_SEVERITIES.map((value) => ({ value, label: severityLabel(value) }))}
      />
      <DateField label="Ablaufdatum (optional)" value={expiresDay} onChange={setExpiresDay} />
    </FormModal>
  );
}
