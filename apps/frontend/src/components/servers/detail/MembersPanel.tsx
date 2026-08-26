'use client';

import {
  SERVER_MEMBER_LEVELS,
  type GameServerDto,
  type ServerMemberDto,
  type ServerMemberLevel,
} from '@palantir/contracts';
import { serverMemberInputSchema } from '@palantir/validation';
import { useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FormModal,
  Panel,
  SelectField,
  TextField,
  formatDateTime,
  useToast,
} from '@/components/shared';
import { addOrUpdateMember, fetchMembers, removeMember } from '@/lib/api/servers';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';

/**
 * Mitgliederverwaltung eines Servers (Lastenheft §3.3).
 *
 * Weitere Nutzer als Mitverwalter freigeben, ihre Stufe ändern oder sie wieder
 * entfernen. Die Stufen stehen in `@palantir/contracts`
 * (`SERVER_MEMBER_LEVELS`); was daraus an Rechten folgt, rechnet das Backend
 * aus und liefert es als `permissions` am jeweiligen DTO.
 */

const LEVEL_LABELS: Record<ServerMemberLevel, string> = {
  viewer: 'Zusehen',
  operator: 'Bedienen',
  manager: 'Verwalten',
};

const LEVEL_HINTS: Record<ServerMemberLevel, string> = {
  viewer: 'Sieht den Server, die Adresse und die Konsolenausgabe.',
  operator: 'Darf zusätzlich starten, stoppen und Konsolenbefehle senden.',
  manager: 'Darf zusätzlich Einstellungen, Dateien, Backups und Aufgaben verwalten.',
};

export interface MembersPanelProps {
  server: GameServerDto;
}

export function MembersPanel({ server }: MembersPanelProps) {
  const toast = useToast();
  const members = useApiResource<ServerMemberDto[]>(
    (signal) => fetchMembers(server.id, signal),
    [server.id],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState<ServerMemberLevel>('operator');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ServerMemberDto | null>(null);

  const list = members.data ?? [];

  async function submit() {
    const parsed = serverMemberInputSchema.safeParse({ userId: userId.trim(), level });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Die Eingaben passen noch nicht.');
      return;
    }

    setBusy(true);
    const result = await addOrUpdateMember(server.id, parsed.data);
    setBusy(false);

    if (!result.success) {
      setFormError(errorText(result));
      return;
    }

    members.setData((current) => {
      const entries = current ?? [];
      const exists = entries.some((entry) => entry.userId === result.data.userId);
      return exists
        ? entries.map((entry) => (entry.userId === result.data.userId ? result.data : entry))
        : [...entries, result.data];
    });
    setDialogOpen(false);
    setUserId('');
    toast.success('Zugriff gespeichert.');
  }

  async function changeLevel(member: ServerMemberDto, next: ServerMemberLevel) {
    const result = await addOrUpdateMember(server.id, { userId: member.userId, level: next });
    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    members.setData((current) =>
      (current ?? []).map((entry) => (entry.userId === member.userId ? result.data : entry)),
    );
  }

  async function remove(member: ServerMemberDto) {
    setBusy(true);
    const result = await removeMember(server.id, member.userId);
    setBusy(false);
    setPendingRemove(null);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    members.setData((current) => (current ?? []).filter((entry) => entry.userId !== member.userId));
    toast.success('Zugriff entzogen.');
  }

  return (
    <Panel variant="plain" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Zugriff</h3>
        {server.permissions.canManageMembers ? (
          <Button size="sm" iconLeft="plus" onClick={() => setDialogOpen(true)}>
            Mitverwalter hinzufügen
          </Button>
        ) : null}
      </div>

      <p className="text-sm text-ink-muted">
        Besitzer: {server.ownerDisplayName ?? 'nicht sichtbar'}
      </p>

      {members.error ? <p className="text-sm text-danger">{members.error}</p> : null}

      {list.length === 0 ? (
        <p className="text-sm text-ink-faint">
          Außer dem Besitzer hat niemand Zugriff auf diesen Server.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base">{member.displayName}</div>
                <div className="text-xs text-ink-faint">
                  Seit {formatDateTime(member.addedAt)} · {LEVEL_HINTS[member.level]}
                </div>
              </div>

              {member.canEdit ? (
                <>
                  <select
                    aria-label={`Stufe von ${member.displayName}`}
                    value={member.level}
                    onChange={(event) =>
                      void changeLevel(member, event.target.value as ServerMemberLevel)
                    }
                    className="rounded-md border border-line-strong bg-fill px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:border-brand"
                  >
                    {SERVER_MEMBER_LEVELS.map((entry) => (
                      <option key={entry} value={entry}>
                        {LEVEL_LABELS[entry]}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="danger" onClick={() => setPendingRemove(member)}>
                    Entfernen
                  </Button>
                </>
              ) : (
                <Badge tone="neutral">{LEVEL_LABELS[member.level]}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      <FormModal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Mitverwalter hinzufügen"
        description="Gib die Nutzer-Id ein und wähle, wie viel diese Person darf."
        submitLabel="Zugriff geben"
        busy={busy}
        error={formError}
        onSubmit={() => void submit()}
      >
        <TextField
          label="Nutzer-Id"
          placeholder="00000000-0000-4000-8000-000000000000"
          value={userId}
          onChange={setUserId}
        />
        <SelectField
          label="Stufe"
          value={level}
          onChange={(value) => setLevel(value as ServerMemberLevel)}
          options={SERVER_MEMBER_LEVELS.map((entry) => ({
            value: entry,
            label: LEVEL_LABELS[entry],
          }))}
          hint={LEVEL_HINTS[level]}
        />
      </FormModal>

      <DangerConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        busy={busy}
        title="Zugriff entziehen?"
        confirmLabel="Entziehen"
        message={
          pendingRemove
            ? `„${pendingRemove.displayName}" verliert den Zugriff auf diesen Server.`
            : ''
        }
        onConfirm={() => {
          if (pendingRemove) void remove(pendingRemove);
        }}
      />
    </Panel>
  );
}
