'use client';

import { type NotificationChannelDto } from '@palantir/contracts';
import { useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FormModal,
  Panel,
  TextField,
  Toggle,
  formatDateTime,
  formatNumber,
  useToast,
} from '@/components/shared';
import {
  createNotificationChannel,
  deleteNotificationChannel,
  fetchNotificationChannels,
  testNotificationChannel,
  updateNotificationChannel,
} from '@/lib/api/admin';
import { type ApiResult, errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminError, AdminLoading } from '../common';

/**
 * Kanäle (Discord-Webhooks) der Benachrichtigungen (Lastenheft §3.6).
 *
 * Die Webhook-URL ist ein Geheimnis und wird nie ausgeliefert – der Contract
 * zeigt nur einen `hint`. Beim Bearbeiten wird das Ziel als Ganzes ersetzt;
 * bleibt das Feld leer, gilt die Vorgabe aus der zentralen `.env`.
 */

type Editor = { mode: 'create' } | { mode: 'edit'; channel: NotificationChannelDto } | null;

export function ChannelsTab() {
  const toast = useToast();
  const resource = useApiResource<NotificationChannelDto[]>(
    (signal) => fetchNotificationChannels(signal),
    [],
  );

  const [editor, setEditor] = useState<Editor>(null);
  const [toDelete, setToDelete] = useState<NotificationChannelDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  async function test(channel: NotificationChannelDto) {
    setTesting(channel.id);
    const result = await testNotificationChannel(channel.id);
    setTesting(null);
    if (result.success) {
      toast.success(`Testnachricht an „${channel.name}" ausgelöst.`);
    } else {
      toast.error(errorText(result));
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    const result = await deleteNotificationChannel(toDelete.id);
    setBusy(false);
    if (result.success) {
      toast.success(`Kanal „${toDelete.name}" gelöscht.`);
      setToDelete(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  const channels = resource.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" iconLeft="plus" onClick={() => setEditor({ mode: 'create' })}>
          Neuer Kanal
        </Button>
      </div>

      {resource.loading ? (
        <AdminLoading label="Kanäle werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : channels.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Noch kein Kanal angelegt. Ohne Kanal werden Meldungen nur in die Inbox zugestellt.
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {channels.map((channel) => (
            <li key={channel.id}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-ink">{channel.name}</span>
                      <Badge tone="neutral">Discord</Badge>
                      {!channel.enabled ? <Badge tone="warning">Deaktiviert</Badge> : null}
                      {!channel.deliverable ? (
                        <Badge tone="danger">Nicht versandfähig</Badge>
                      ) : null}
                    </div>
                    <span className="text-sm text-ink-muted">
                      {channel.target.usesEnvDefault
                        ? 'Standard-Webhook aus der .env'
                        : (channel.target.hint ?? 'Eigener Webhook')}
                      {channel.target.username ? ` · als „${channel.target.username}"` : ''}
                    </span>
                    <span className="text-sm text-ink-faint">
                      {formatNumber(channel.ruleCount)}{' '}
                      {channel.ruleCount === 1 ? 'Regel' : 'Regeln'}
                      {channel.lastDeliveryAt
                        ? ` · zuletzt zugestellt ${formatDateTime(channel.lastDeliveryAt)}`
                        : ''}
                    </span>
                    {channel.lastFailureCode ? (
                      <span className="text-sm text-danger">
                        Letzter Fehler: {channel.lastFailureMessage ?? channel.lastFailureCode}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {channel.permissions.canTest ? (
                      <Button
                        variant="secondary"
                        iconLeft="send"
                        disabled={testing === channel.id}
                        onClick={() => void test(channel)}
                      >
                        Test
                      </Button>
                    ) : null}
                    {channel.permissions.canEdit ? (
                      <Button
                        variant="secondary"
                        iconLeft="gear"
                        onClick={() => setEditor({ mode: 'edit', channel })}
                      >
                        Bearbeiten
                      </Button>
                    ) : null}
                    {channel.permissions.canDelete ? (
                      <Button
                        variant="danger"
                        iconLeft="trash"
                        onClick={() => setToDelete(channel)}
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

      {editor ? (
        <ChannelEditor
          editor={editor}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setEditor(null)}
          onSaved={(name) => {
            toast.success(
              editor.mode === 'create'
                ? `Kanal „${name}" angelegt.`
                : `Kanal „${name}" gespeichert.`,
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
          title={`Kanal „${toDelete.name}" löschen?`}
          confirmLabel="Kanal löschen"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          message={
            toDelete.ruleCount > 0
              ? `${toDelete.ruleCount} ${
                  toDelete.ruleCount === 1 ? 'Regel nutzt' : 'Regeln nutzen'
                } diesen Kanal. Sie stellen danach nur noch in die Inbox zu.`
              : 'Der Kanal wird endgültig entfernt.'
          }
        />
      ) : null}
    </div>
  );
}

function ChannelEditor({
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
  onSaved: (name: string) => void;
}) {
  const initial = editor.mode === 'edit' ? editor.channel : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [username, setUsername] = useState(initial?.target.username ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const nameValid = name.trim().length >= 2;

  async function submit() {
    setBusy(true);
    setError(null);

    const target = {
      ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}),
      ...(username.trim() ? { username: username.trim() } : {}),
    };

    const result: ApiResult<NotificationChannelDto> =
      editor.mode === 'create'
        ? await createNotificationChannel({
            name: name.trim(),
            type: 'discordWebhook',
            target,
            enabled,
          })
        : await updateNotificationChannel(editor.channel.id, {
            name: name.trim(),
            target,
            enabled,
          });

    setBusy(false);
    if (result.success) {
      onSaved(result.data.name);
    } else {
      setError(errorText(result));
    }
  }

  return (
    <FormModal
      open
      onClose={onClose}
      title={editor.mode === 'create' ? 'Neuer Kanal' : `Kanal „${editor.channel.name}"`}
      submitLabel={editor.mode === 'create' ? 'Anlegen' : 'Speichern'}
      submitDisabled={!nameValid}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="z. B. Admin-Kanal" />
      <TextField
        label="Webhook-URL"
        value={webhookUrl}
        onChange={setWebhookUrl}
        placeholder={
          editor.mode === 'edit'
            ? 'Leer lassen, um die bestehende URL zu behalten'
            : 'Leer lassen für den Standard-Webhook aus der .env'
        }
        hint="Die URL ist ein Geheimnis und wird nach dem Speichern nicht mehr angezeigt."
        autoComplete="off"
      />
      <TextField
        label="Absendername (optional)"
        value={username}
        onChange={setUsername}
        placeholder="Abweichender Name in Discord"
      />
      <Toggle checked={enabled} onChange={setEnabled} label="Kanal ist aktiv" />
    </FormModal>
  );
}
