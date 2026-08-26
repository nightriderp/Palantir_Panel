'use client';

import {
  SCHEDULE_ACTIONS,
  type GameServerDto,
  type ScheduleAction,
  type ScheduleDto,
} from '@palantir/contracts';
import { type ScheduleInput, scheduleInputSchema } from '@palantir/validation';
import { useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  EmptyState,
  FormModal,
  Panel,
  useToast,
} from '@/components/shared';
import { createSchedule, deleteSchedule, fetchSchedules, updateSchedule } from '@/lib/api/servers';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { SelectField, TextField, Toggle } from '../form/Fields';
import { describeCron, formatDateTime } from '../formatDetail';

/**
 * Reiter „Aufgaben" der Detailansicht (Lastenheft §3.3).
 *
 * Geplante Aufgaben wie ein nächtlicher Neustart oder ein Konsolenbefehl zu
 * fester Uhrzeit. Der Zeitplan steht als Cron-Ausdruck; daneben steht immer
 * die Beschreibung im Klartext, damit niemand Cron lesen können muss.
 */

const ACTION_LABELS: Record<ScheduleAction, string> = {
  backup: 'Sicherung erstellen',
  restart: 'Server neu starten',
  command: 'Konsolenbefehl senden',
};

const RUN_RESULT_LABELS: Record<NonNullable<ScheduleDto['lastRunResult']>, string> = {
  success: 'erfolgreich',
  failed: 'fehlgeschlagen',
  skipped: 'übersprungen',
};

/** Zeitzone des Browsers – Vorgabe für neue Aufgaben. */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

function emptyDraft(): ScheduleInput {
  return {
    name: '',
    action: 'restart',
    command: null,
    cronExpression: '0 4 * * *',
    timezone: browserTimezone(),
    enabled: true,
  };
}

export interface TasksTabProps {
  server: GameServerDto;
}

export function TasksTab({ server }: TasksTabProps) {
  const toast = useToast();
  const schedules = useApiResource<ScheduleDto[]>(
    (signal) => fetchSchedules(server.id, signal),
    [server.id],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleInput>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScheduleDto | null>(null);

  const list = schedules.data ?? [];
  const canManage = server.permissions.canManageSchedules;

  function openNew() {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(schedule: ScheduleDto) {
    setEditingId(schedule.id);
    setDraft({
      name: schedule.name,
      action: schedule.action,
      command: schedule.command,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function submit() {
    const parsed = scheduleInputSchema.safeParse(draft);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Die Eingaben passen noch nicht.');
      return;
    }

    setBusy(true);
    const result = editingId
      ? await updateSchedule(server.id, editingId, parsed.data)
      : await createSchedule(server.id, parsed.data);
    setBusy(false);

    if (!result.success) {
      setFormError(errorText(result));
      return;
    }

    schedules.setData((current) => {
      const entries = current ?? [];
      return editingId
        ? entries.map((entry) => (entry.id === result.data.id ? result.data : entry))
        : [...entries, result.data];
    });
    setDialogOpen(false);
    toast.success(editingId ? 'Aufgabe gespeichert.' : 'Aufgabe angelegt.');
  }

  async function toggle(schedule: ScheduleDto) {
    const result = await updateSchedule(server.id, schedule.id, {
      name: schedule.name,
      action: schedule.action,
      command: schedule.command,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      enabled: !schedule.enabled,
    });

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    schedules.setData((current) =>
      (current ?? []).map((entry) => (entry.id === result.data.id ? result.data : entry)),
    );
  }

  async function remove(schedule: ScheduleDto) {
    setBusy(true);
    const result = await deleteSchedule(server.id, schedule.id);
    setBusy(false);
    setPendingDelete(null);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    schedules.setData((current) => (current ?? []).filter((entry) => entry.id !== schedule.id));
    toast.success('Aufgabe gelöscht.');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-faint">
          Wiederkehrende Vorgänge, z. B. ein nächtlicher Neustart oder eine regelmäßige Sicherung.
        </p>
        {canManage ? (
          <Button variant="primary" iconLeft="plus" onClick={openNew}>
            Neue Aufgabe
          </Button>
        ) : null}
      </div>

      {schedules.loading && schedules.data === null ? (
        <Panel variant="outline" className="text-center text-base text-ink-muted">
          Aufgaben werden geladen …
        </Panel>
      ) : null}

      {schedules.error ? (
        <Panel variant="outline" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-base text-danger">{schedules.error}</span>
          <Button onClick={schedules.reload}>Erneut versuchen</Button>
        </Panel>
      ) : null}

      {!schedules.loading && !schedules.error && list.length === 0 ? (
        <EmptyState
          icon="clock"
          title="Keine geplanten Aufgaben"
          description="Lege zum Beispiel einen nächtlichen Neustart oder eine regelmäßige Sicherung an."
          action={
            canManage ? (
              <Button variant="primary" iconLeft="plus" onClick={openNew}>
                Neue Aufgabe
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {list.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {list.map((schedule) => (
            <li key={schedule.id}>
              <Panel variant="plain" padding="sm" className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{schedule.name}</span>
                    {!schedule.enabled ? <Badge tone="neutral">Pausiert</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {ACTION_LABELS[schedule.action]}
                    {schedule.command ? ` („${schedule.command}")` : ''} ·{' '}
                    {describeCron(schedule.cronExpression)} · {schedule.timezone}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-disabled">
                    Zuletzt: {formatDateTime(schedule.lastRunAt)}
                    {schedule.lastRunResult
                      ? ` (${RUN_RESULT_LABELS[schedule.lastRunResult]})`
                      : ''}{' '}
                    · Nächster Lauf: {formatDateTime(schedule.nextRunAt)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {schedule.permissions.canToggle ? (
                    <Toggle
                      label={`${schedule.name} aktivieren`}
                      checked={schedule.enabled}
                      onChange={() => void toggle(schedule)}
                    />
                  ) : null}
                  {schedule.permissions.canEdit ? (
                    <Button size="sm" onClick={() => openEdit(schedule)}>
                      Bearbeiten
                    </Button>
                  ) : null}
                  {schedule.permissions.canDelete ? (
                    <Button size="sm" variant="danger" onClick={() => setPendingDelete(schedule)}>
                      Löschen
                    </Button>
                  ) : null}
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      ) : null}

      <FormModal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
        submitLabel={editingId ? 'Speichern' : 'Anlegen'}
        busy={busy}
        error={formError}
        onSubmit={() => void submit()}
      >
        <TextField
          label="Name"
          placeholder="z. B. Nächtlicher Neustart"
          value={draft.name}
          onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
        />

        <SelectField
          label="Aktion"
          value={draft.action}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              action: value as ScheduleAction,
              command: value === 'command' ? (current.command ?? '') : null,
            }))
          }
          options={SCHEDULE_ACTIONS.map((action) => ({
            value: action,
            label: ACTION_LABELS[action],
          }))}
        />

        {draft.action === 'command' ? (
          <TextField
            label="Konsolenbefehl"
            placeholder="z. B. say Neustart in 5 Minuten"
            value={draft.command ?? ''}
            onChange={(value) => setDraft((current) => ({ ...current, command: value }))}
          />
        ) : null}

        <TextField
          label="Zeitplan (Cron)"
          placeholder="0 4 * * *"
          hint={describeCron(draft.cronExpression)}
          value={draft.cronExpression}
          onChange={(value) => setDraft((current) => ({ ...current, cronExpression: value }))}
        />

        <TextField
          label="Zeitzone"
          hint="Der Zeitplan wird in dieser Zeitzone ausgewertet."
          value={draft.timezone}
          onChange={(value) => setDraft((current) => ({ ...current, timezone: value }))}
        />
      </FormModal>

      <DangerConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        busy={busy}
        title="Aufgabe löschen?"
        message={pendingDelete ? `„${pendingDelete.name}" wird endgültig entfernt.` : ''}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />
    </div>
  );
}
