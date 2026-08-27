'use client';

import {
  NOTIFIABLE_EVENTS,
  NOTIFICATION_RECIPIENT_SCOPES,
  NOTIFICATION_SEVERITIES,
  type NotifiableEventName,
  type NotificationChannelDto,
  type NotificationRecipientScope,
  type NotificationRuleDto,
  type NotificationSeverity,
  type RoleDto,
} from '@palantir/contracts';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FormMessage,
  FormModal,
  Panel,
  SelectField,
  Toggle,
  useToast,
} from '@/components/shared';
import {
  createNotificationRule,
  deleteNotificationRule,
  fetchNotificationChannels,
  fetchNotificationRules,
  fetchRoles,
  updateNotificationRule,
} from '@/lib/api/admin';
import { type ApiResult, errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminError, AdminLoading } from '../common';
import {
  notifiableEventLabel,
  recipientScopeLabel,
  severityLabel,
  severityTone,
} from '../labels';

/**
 * Benachrichtigungs-Regeln: Ereignis → Kanal → Empfängerkreis (Lastenheft §3.6).
 *
 * Der Editor bietet ausschließlich Ereignisse aus {@link NOTIFIABLE_EVENTS} an;
 * alles andere lehnt das Backend mit `NOTIFICATION_EVENT_NOT_NOTIFIABLE` ab.
 * `severity: null` steht für „wie das Ereignis" – kein fester Vorgabewert.
 * `channelId: null` bedeutet „nur Inbox".
 */

type Editor = { mode: 'create' } | { mode: 'edit'; rule: NotificationRuleDto } | null;

export function RulesTab() {
  const toast = useToast();
  const rules = useApiResource<NotificationRuleDto[]>(
    (signal) => fetchNotificationRules(signal),
    [],
  );
  const channels = useApiResource<NotificationChannelDto[]>(
    (signal) => fetchNotificationChannels(signal),
    [],
  );
  const roles = useApiResource<RoleDto[]>((signal) => fetchRoles(signal), []);

  const [editor, setEditor] = useState<Editor>(null);
  const [toDelete, setToDelete] = useState<NotificationRuleDto | null>(null);
  const [busy, setBusy] = useState(false);

  const roleName = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of roles.data ?? []) map.set(role.id, role.name);
    return map;
  }, [roles.data]);

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    const result = await deleteNotificationRule(toDelete.id);
    setBusy(false);
    if (result.success) {
      toast.success('Regel gelöscht.');
      setToDelete(null);
      rules.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  const list = rules.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" iconLeft="plus" onClick={() => setEditor({ mode: 'create' })}>
          Neue Regel
        </Button>
      </div>

      {rules.loading ? (
        <AdminLoading label="Regeln werden geladen …" />
      ) : rules.error ? (
        <AdminError message={rules.error} onRetry={rules.reload} />
      ) : list.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Noch keine Regel angelegt. Ohne Regel löst kein Ereignis eine Benachrichtigung aus.
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((rule) => (
            <li key={rule.id}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-ink">
                        {notifiableEventLabel(rule.event)}
                      </span>
                      {!rule.enabled ? <Badge tone="warning">Deaktiviert</Badge> : null}
                      {rule.severity ? (
                        <Badge tone={severityTone(rule.severity)}>
                          {severityLabel(rule.severity)}
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-sm text-ink-muted">
                      Empfänger: {recipientScopeLabel(rule.recipientScope)}
                      {rule.recipientScope === 'role'
                        ? ` (${
                            rule.recipientRoleName ??
                            (rule.recipientRoleId ? roleName.get(rule.recipientRoleId) : undefined) ??
                            'unbekannte Rolle'
                          })`
                        : ''}
                    </span>
                    <span className="text-sm text-ink-faint">
                      {rule.inboxEnabled ? 'Inbox' : 'ohne Inbox'}
                      {rule.channelName ? ` · Kanal „${rule.channelName}"` : ' · kein Kanal'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {rule.permissions.canEdit ? (
                      <Button
                        variant="secondary"
                        iconLeft="gear"
                        onClick={() => setEditor({ mode: 'edit', rule })}
                      >
                        Bearbeiten
                      </Button>
                    ) : null}
                    {rule.permissions.canDelete ? (
                      <Button
                        variant="danger"
                        iconLeft="trash"
                        onClick={() => setToDelete(rule)}
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
        <RuleEditor
          editor={editor}
          channels={channels.data ?? []}
          roles={roles.data ?? []}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setEditor(null)}
          onSaved={() => {
            toast.success(editor.mode === 'create' ? 'Regel angelegt.' : 'Regel gespeichert.');
            setEditor(null);
            rules.reload();
          }}
        />
      ) : null}

      {toDelete ? (
        <DangerConfirmDialog
          open
          onClose={() => setToDelete(null)}
          title="Regel löschen?"
          confirmLabel="Regel löschen"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          message={`Für „${notifiableEventLabel(
            toDelete.event,
          )}" wird dann keine Benachrichtigung mehr über diese Regel ausgelöst.`}
        />
      ) : null}
    </div>
  );
}

const INBOX_ONLY = '';

function RuleEditor({
  editor,
  channels,
  roles,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Exclude<Editor, null>;
  channels: NotificationChannelDto[];
  roles: RoleDto[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = editor.mode === 'edit' ? editor.rule : null;
  const [event, setEvent] = useState<NotifiableEventName>(initial?.event ?? NOTIFIABLE_EVENTS[0]);
  const [channelId, setChannelId] = useState<string>(initial?.channelId ?? INBOX_ONLY);
  const [scope, setScope] = useState<NotificationRecipientScope>(
    initial?.recipientScope ?? 'resourceOwner',
  );
  const [roleId, setRoleId] = useState<string>(initial?.recipientRoleId ?? '');
  const [inboxEnabled, setInboxEnabled] = useState(initial?.inboxEnabled ?? true);
  const [severity, setSeverity] = useState<NotificationSeverity | ''>(initial?.severity ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const roleMissing = scope === 'role' && roleId === '';
  const reachesNobody = !inboxEnabled && channelId === INBOX_ONLY;
  const invalid = roleMissing || reachesNobody;

  async function submit() {
    setBusy(true);
    setError(null);
    const channel = channelId === INBOX_ONLY ? null : channelId;
    const recipientRoleId = scope === 'role' ? roleId : null;
    const chosenSeverity = severity === '' ? null : severity;

    const result: ApiResult<NotificationRuleDto> =
      editor.mode === 'create'
        ? await createNotificationRule({
            event,
            channelId: channel,
            recipientScope: scope,
            recipientRoleId,
            inboxEnabled,
            severity: chosenSeverity,
            enabled,
          })
        : await updateNotificationRule(editor.rule.id, {
            channelId: channel,
            recipientScope: scope,
            recipientRoleId,
            inboxEnabled,
            severity: chosenSeverity,
            enabled,
          });

    setBusy(false);
    if (result.success) {
      onSaved();
    } else {
      setError(errorText(result));
    }
  }

  const assignableRoles = roles.filter((role) => !role.isProtected);

  return (
    <FormModal
      open
      onClose={onClose}
      title={editor.mode === 'create' ? 'Neue Regel' : 'Regel bearbeiten'}
      submitLabel={editor.mode === 'create' ? 'Anlegen' : 'Speichern'}
      submitDisabled={invalid}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
    >
      <SelectField
        label="Ereignis"
        value={event}
        onChange={(value) => setEvent(value as NotifiableEventName)}
        disabled={editor.mode === 'edit'}
        options={NOTIFIABLE_EVENTS.map((value) => ({ value, label: notifiableEventLabel(value) }))}
      />
      <SelectField
        label="Kanal"
        value={channelId}
        onChange={setChannelId}
        placeholder="Nur Inbox (kein externer Kanal)"
        options={channels.map((channel) => ({ value: channel.id, label: channel.name }))}
      />
      <SelectField
        label="Empfängerkreis"
        value={scope}
        onChange={(value) => setScope(value as NotificationRecipientScope)}
        options={NOTIFICATION_RECIPIENT_SCOPES.map((value) => ({
          value,
          label: recipientScopeLabel(value),
        }))}
      />
      {scope === 'role' ? (
        <SelectField
          label="Rolle"
          value={roleId}
          onChange={setRoleId}
          placeholder="Rolle wählen"
          options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))}
          error={roleMissing ? 'Für den Empfängerkreis „Rolle" muss eine Rolle gewählt werden.' : undefined}
        />
      ) : null}
      {scope === 'allUsers' ? (
        <FormMessage tone="warning">
          „Alle Konten" erreicht bei einem häufigen Ereignis sehr viele Empfänger – nur für
          Wartungshinweise gedacht.
        </FormMessage>
      ) : null}
      <SelectField
        label="Dringlichkeit"
        value={severity}
        onChange={(value) => setSeverity(value as NotificationSeverity | '')}
        placeholder="Wie das Ereignis"
        options={NOTIFICATION_SEVERITIES.map((value) => ({ value, label: severityLabel(value) }))}
      />
      <Toggle checked={inboxEnabled} onChange={setInboxEnabled} label="In die Inbox zustellen" />
      {reachesNobody ? (
        <FormMessage tone="error">
          Ohne Inbox und ohne Kanal würde die Regel niemanden erreichen.
        </FormMessage>
      ) : null}
      <Toggle checked={enabled} onChange={setEnabled} label="Regel ist aktiv" />
    </FormModal>
  );
}
