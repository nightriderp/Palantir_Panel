'use client';

import {
  type GameServerDto,
  type RegistrationRequestDto,
  type RegistrationRequestStatus,
  type RoleDto,
  type UserResourceLimitDto,
} from '@palantir/contracts';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  DangerConfirmDialog,
  Icon,
  Modal,
  PageHeader,
  Panel,
  SegmentedControl,
  ServerStatusPill,
  ToggleRow,
  formatDate,
  formatServerAddress,
  serverInitials,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  assignRole,
  blockRegistrationRequest,
  clearUserLimits,
  fetchAllServers,
  fetchRegistrationRequests,
  fetchRoles,
  fetchUserLimits,
  removeRole,
  resetUserPassword,
  resetUserTwoFactor,
  setUserLimits,
  unblockRegistrationRequest,
} from '@/lib/api/admin';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';
import { registrationStatusLabel, registrationStatusTone } from '../labels';

/**
 * Nutzerverwaltung (Lastenheft §3.1 und §3.7).
 *
 * Die Liste ist die nach Zustand gefilterte Sicht der Warteliste – einen
 * eigenen Nutzer-Endpunkt gibt es (noch) nicht (WORK_STATUS.md, Gefundener
 * Punkt). Pro Konto: Rollen zuweisen/entziehen, sperren/entsperren, Passwort
 * zurücksetzen, 2FA zurücksetzen, Server einsehen. Jede Aktion hängt am
 * `permissions`-Objekt bzw. wird vom Backend erneut geprüft.
 *
 * **Kontingente (RAM/CPU/Speicher/Serveranzahl)** hängen am
 * `ResourceService` (B4) über die Routen `/admin/users/:userId/limits`
 * (Gefundener Punkt 88). Der Dialog lädt den DTO samt Belegung und blendet das
 * Bearbeiten allein am `permissions.canEdit` des DTOs ein.
 */

const STATUS_FILTERS: RegistrationRequestStatus[] = ['approved', 'pending', 'blocked'];

type Dialog =
  | { kind: 'roles'; user: RegistrationRequestDto }
  | { kind: 'servers'; user: RegistrationRequestDto }
  | { kind: 'limits'; user: RegistrationRequestDto }
  | { kind: 'block'; user: RegistrationRequestDto }
  | { kind: 'resetTwoFactor'; user: RegistrationRequestDto }
  | { kind: 'password'; user: RegistrationRequestDto; temporary: string }
  | null;

export function UsersView() {
  const { user } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageUsers ?? false;

  const [status, setStatus] = useState<RegistrationRequestStatus>('approved');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const resource = useApiResource<RegistrationRequestDto[]>(
    (signal) => fetchRegistrationRequests({ status, limit: 200, offset: 0 }, signal),
    canManage ? [status] : null,
  );
  const roles = useApiResource<RoleDto[]>((signal) => fetchRoles(signal), canManage ? [] : null);

  const filtered = useMemo(() => {
    const list = resource.data ?? [];
    const term = search.trim().toLowerCase();
    return term ? list.filter((entry) => entry.displayName.toLowerCase().includes(term)) : list;
  }, [resource.data, search]);

  async function doReset(userId: string, displayName: string) {
    setBusy(true);
    const result = await resetUserPassword(userId);
    setBusy(false);
    if (result.success) {
      setDialog({
        kind: 'password',
        user: { userId, displayName } as RegistrationRequestDto,
        temporary: result.data.temporaryPassword,
      });
    } else {
      toast.error(errorText(result));
    }
  }

  async function doBlock(target: RegistrationRequestDto) {
    setBusy(true);
    const result = await blockRegistrationRequest(target.userId, {});
    setBusy(false);
    if (result.success) {
      toast.success(`„${target.displayName}" ist gesperrt.`);
      setDialog(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  async function doUnblock(target: RegistrationRequestDto) {
    setBusy(true);
    const result = await unblockRegistrationRequest(target.userId);
    setBusy(false);
    if (result.success) {
      toast.success(`„${target.displayName}" ist entsperrt.`);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  async function doResetTwoFactor(target: RegistrationRequestDto) {
    setBusy(true);
    const result = await resetUserTwoFactor(target.userId);
    setBusy(false);
    if (result.success) {
      toast.success(`2FA von „${target.displayName}" wurde zurückgesetzt.`);
      setDialog(null);
    } else {
      toast.error(errorText(result));
    }
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Benutzerverwaltung" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Nutzerverwaltung" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Benutzerverwaltung"
        subtitle="Konten, Rollen und Freischaltung"
        className="-mx-5 -mt-5 px-5"
      />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Nach Zustand filtern"
          value={status}
          onChange={setStatus}
          items={STATUS_FILTERS.map((key) => ({ key, label: registrationStatusLabel(key) }))}
        />
        <div className="relative min-w-[200px] flex-1">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nach Name suchen"
            aria-label="Nutzer suchen"
            className="w-full rounded-md border border-line-strong bg-fill py-2.5 pl-9 pr-3 text-base text-ink outline-none focus-visible:border-brand"
          />
        </div>
      </div>

      {resource.loading ? (
        <AdminLoading label="Konten werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : filtered.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">Keine Konten gefunden.</Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((entry) => (
            <li key={entry.userId}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">
                      {serverInitials(entry.displayName)}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-base font-semibold text-ink">{entry.displayName}</span>
                      <span className="text-sm text-ink-faint">
                        Seit {formatDate(entry.registeredAt)}
                        {entry.roleNames.length > 0 ? ` · ${entry.roleNames.join(', ')}` : ''}
                      </span>
                    </div>
                  </div>
                  <Badge tone={registrationStatusTone(entry.status)} withDot>
                    {registrationStatusLabel(entry.status)}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    iconLeft="shield"
                    onClick={() => setDialog({ kind: 'roles', user: entry })}
                  >
                    Rollen
                  </Button>
                  <Button
                    variant="secondary"
                    iconLeft="server"
                    onClick={() => setDialog({ kind: 'servers', user: entry })}
                  >
                    Server
                  </Button>
                  <Button
                    variant="secondary"
                    iconLeft="database"
                    onClick={() => setDialog({ kind: 'limits', user: entry })}
                  >
                    Kontingent
                  </Button>
                  <Button
                    variant="secondary"
                    iconLeft="key"
                    onClick={() => void doReset(entry.userId, entry.displayName)}
                  >
                    Passwort zurücksetzen
                  </Button>
                  <Button
                    variant="secondary"
                    iconLeft="lock"
                    onClick={() => setDialog({ kind: 'resetTwoFactor', user: entry })}
                  >
                    2FA zurücksetzen
                  </Button>
                  {entry.permissions.canBlock ? (
                    <Button
                      variant="danger"
                      iconLeft="lock"
                      onClick={() => setDialog({ kind: 'block', user: entry })}
                    >
                      Sperren
                    </Button>
                  ) : null}
                  {entry.permissions.canUnblock ? (
                    <Button
                      variant="secondary"
                      iconLeft="restart"
                      onClick={() => void doUnblock(entry)}
                    >
                      Entsperren
                    </Button>
                  ) : null}
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'roles' ? (
        <RolesDialog
          user={dialog.user}
          roles={roles.data ?? []}
          onClose={() => {
            setDialog(null);
            resource.reload();
          }}
        />
      ) : null}

      {dialog?.kind === 'servers' ? (
        <ServersDialog user={dialog.user} onClose={() => setDialog(null)} />
      ) : null}

      {dialog?.kind === 'limits' ? (
        <LimitsDialog user={dialog.user} onClose={() => setDialog(null)} />
      ) : null}

      {dialog?.kind === 'block' ? (
        <DangerConfirmDialog
          open
          onClose={() => setDialog(null)}
          title={`„${dialog.user.displayName}" sperren?`}
          confirmLabel="Sperren"
          busy={busy}
          onConfirm={() => void doBlock(dialog.user)}
          message="Das Konto verliert sofort jeden Zugriff. Die Sperre lässt sich später wieder aufheben."
        />
      ) : null}

      {dialog?.kind === 'resetTwoFactor' ? (
        <ConfirmDialog
          open
          onClose={() => setDialog(null)}
          title={`2FA von „${dialog.user.displayName}" zurücksetzen?`}
          confirmLabel="Zurücksetzen"
          busy={busy}
          onConfirm={() => void doResetTwoFactor(dialog.user)}
          message="Die Zwei-Faktor-Anmeldung wird deaktiviert. Der Nutzer kann sie danach neu einrichten – nutze das nur, wenn er sich ausgesperrt hat."
        />
      ) : null}

      {dialog?.kind === 'password' ? (
        <PasswordResultDialog
          displayName={dialog.user.displayName}
          temporary={dialog.temporary}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/** Rollen eines Kontos zuweisen und entziehen. */
function RolesDialog({
  user,
  roles,
  onClose,
}: {
  user: RegistrationRequestDto;
  roles: RoleDto[];
  onClose: () => void;
}) {
  const toast = useToast();
  // Die geschützte Gast-Rolle wird nicht von Hand vergeben (sie entsteht bei der
  // Registrierung und weicht bei der Freigabe).
  const assignable = roles.filter((role) => !role.isProtected);
  const [assigned, setAssigned] = useState<Set<string>>(
    () => new Set(assignable.filter((role) => user.roleNames.includes(role.name)).map((r) => r.id)),
  );
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(role: RoleDto, on: boolean) {
    setPending(role.id);
    const result = on
      ? await assignRole(role.id, user.userId)
      : await removeRole(role.id, user.userId);
    setPending(null);
    if (result.success) {
      setAssigned((current) => {
        const next = new Set(current);
        if (on) next.add(role.id);
        else next.delete(role.id);
        return next;
      });
    } else {
      toast.error(errorText(result));
    }
  }

  return (
    <Modal open onClose={onClose} title={`Rollen von „${user.displayName}"`}>
      <div className="flex flex-col gap-2 pb-2">
        {assignable.length === 0 ? (
          <p className="text-sm text-ink-faint">Keine vergebbaren Rollen vorhanden.</p>
        ) : (
          assignable.map((role) => (
            <ToggleRow
              key={role.id}
              title={role.name}
              description={role.description ?? undefined}
              checked={assigned.has(role.id)}
              disabled={pending === role.id}
              onChange={(on) => void toggle(role, on)}
            />
          ))
        )}
      </div>
    </Modal>
  );
}

/** Server eines Nutzers einsehen (Lastenheft §3.7). */
function ServersDialog({ user, onClose }: { user: RegistrationRequestDto; onClose: () => void }) {
  const servers = useApiResource<GameServerDto[]>((signal) => fetchAllServers(signal), []);
  const own = (servers.data ?? []).filter((server) => server.ownerId === user.userId);

  return (
    <Modal open onClose={onClose} title={`Server von „${user.displayName}"`}>
      <div className="flex flex-col gap-2 pb-2">
        {servers.loading ? (
          <p className="text-sm text-ink-faint">Server werden geladen …</p>
        ) : servers.error ? (
          <p className="text-sm text-danger">{servers.error}</p>
        ) : own.length === 0 ? (
          <p className="text-sm text-ink-faint">Dieses Konto besitzt keine Server.</p>
        ) : (
          own.map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2.5"
            >
              <div className="flex flex-col">
                <span className="text-base text-ink">{server.name}</span>
                <span className="font-mono text-sm text-ink-faint">
                  {formatServerAddress(server.address) ?? '—'}
                </span>
              </div>
              <ServerStatusPill status={server.status} />
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

/**
 * Kontingent eines Nutzers ansehen und setzen (Lastenheft §3.4, Pflichtenheft
 * §10). Lädt den DTO samt aktueller Belegung über `/admin/users/:id/limits`.
 */
function LimitsDialog({ user, onClose }: { user: RegistrationRequestDto; onClose: () => void }) {
  const resource = useApiResource<UserResourceLimitDto>(
    (signal) => fetchUserLimits(user.userId, signal),
    [user.userId],
  );

  return (
    <Modal open onClose={onClose} title={`Kontingent von „${user.displayName}"`}>
      <div className="pb-2">
        {resource.loading ? (
          <p className="text-sm text-ink-faint">Kontingent wird geladen …</p>
        ) : resource.error ? (
          <p className="text-sm text-danger">{resource.error}</p>
        ) : resource.data ? (
          <LimitsForm dto={resource.data} onClose={onClose} />
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Ein einzelnes Kontingent-Feld: leeres Feld bedeutet „kein Limit". Die aktuelle
 * Belegung steht als Hinweis darunter, damit sichtbar ist, ob der Nutzer bereits
 * über einer gerade gesetzten Grenze liegt.
 */
function LimitField({
  label,
  unit,
  value,
  usageHint,
  disabled,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  usageHint: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-ink-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value}
          disabled={disabled}
          placeholder="kein Limit"
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-line-strong bg-fill px-3 py-2.5 text-base text-ink outline-none placeholder:text-ink-disabled focus-visible:border-brand disabled:opacity-60"
        />
        <span className="shrink-0 text-sm text-ink-faint">{unit}</span>
      </div>
      <span className="text-2xs text-ink-faint">{usageHint}</span>
    </label>
  );
}

/** Wandelt den gespeicherten Zahlenwert in Feldtext; `null` → leeres Feld. */
function limitToField(value: number | null): string {
  return value === null ? '' : String(value);
}

/** Feldtext in einen Kontingent-Wert; leer → `null` (kein Limit). */
function fieldToLimit(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
}

function LimitsForm({ dto, onClose }: { dto: UserResourceLimitDto; onClose: () => void }) {
  const toast = useToast();
  const canEdit = dto.permissions.canEdit;

  const [ram, setRam] = useState(() => limitToField(dto.limits.maxRamMb));
  const [cpu, setCpu] = useState(() => limitToField(dto.limits.maxCpuCores));
  const [disk, setDisk] = useState(() => limitToField(dto.limits.maxDiskMb));
  const [servers, setServers] = useState(() => limitToField(dto.limits.maxConcurrentServers));
  const [busy, setBusy] = useState(false);

  const hasLimit =
    dto.limits.maxRamMb !== null ||
    dto.limits.maxCpuCores !== null ||
    dto.limits.maxDiskMb !== null ||
    dto.limits.maxConcurrentServers !== null;

  async function save() {
    const fields = [ram, cpu, disk, servers];
    if (fields.some((field) => field.trim() !== '' && Number.isNaN(Number(field)))) {
      toast.error('Bitte nur Zahlen eingeben oder das Feld leer lassen.');
      return;
    }

    setBusy(true);
    const result = await setUserLimits(dto.userId, {
      maxRamMb: fieldToLimit(ram),
      maxCpuCores: fieldToLimit(cpu),
      maxDiskMb: fieldToLimit(disk),
      maxConcurrentServers: fieldToLimit(servers),
    });
    setBusy(false);

    if (result.success) {
      toast.success('Kontingent gespeichert.');
      onClose();
    } else {
      toast.error(errorText(result));
    }
  }

  async function clear() {
    setBusy(true);
    const result = await clearUserLimits(dto.userId);
    setBusy(false);

    if (result.success) {
      toast.success('Kontingent aufgehoben.');
      onClose();
    } else {
      toast.error(errorText(result));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-faint">
        Ein leeres Feld bedeutet: kein Limit. Die harte Kapazität der Node greift unabhängig davon.
      </p>

      <div className="flex flex-col gap-3">
        <LimitField
          label="Arbeitsspeicher"
          unit="MiB"
          value={ram}
          usageHint={`belegt: ${dto.usage.runningRamMb} MiB (laufend)`}
          disabled={!canEdit || busy}
          onChange={setRam}
        />
        <LimitField
          label="CPU"
          unit="Kerne"
          value={cpu}
          usageHint={`belegt: ${dto.usage.runningCpuCores} Kerne (laufend)`}
          disabled={!canEdit || busy}
          onChange={setCpu}
        />
        <LimitField
          label="Speicherplatz"
          unit="MiB"
          value={disk}
          usageHint={`belegt: ${dto.usage.allocatedDiskMb} MiB (alle Server)`}
          disabled={!canEdit || busy}
          onChange={setDisk}
        />
        <LimitField
          label="Gleichzeitige Server"
          unit="Anzahl"
          value={servers}
          usageHint={`laufend: ${dto.usage.runningServers} · gesamt: ${dto.usage.totalServers}`}
          disabled={!canEdit || busy}
          onChange={setServers}
        />
      </div>

      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          {hasLimit ? (
            <Button variant="danger" iconLeft="trash" disabled={busy} onClick={() => void clear()}>
              Aufheben
            </Button>
          ) : null}
          <Button variant="primary" iconLeft="check" disabled={busy} onClick={() => void save()}>
            Speichern
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">
          Zum Ändern des Kontingents fehlt deinem Konto die Berechtigung.
        </p>
      )}
    </div>
  );
}

/** Einmal-Passwort nach dem Zurücksetzen – wird genau einmal gezeigt. */
function PasswordResultDialog({
  displayName,
  temporary,
  onClose,
}: {
  displayName: string;
  temporary: string;
  onClose: () => void;
}) {
  const toast = useToast();
  return (
    <Modal
      open
      onClose={onClose}
      title={`Neues Passwort für „${displayName}"`}
      description="Das Einmal-Passwort wird nur jetzt angezeigt. Gib es dem Nutzer sicher weiter – er muss es bei der nächsten Anmeldung ändern."
      footer={
        <Button variant="primary" onClick={onClose}>
          Fertig
        </Button>
      }
    >
      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-deep px-3 py-2.5">
        <code className="break-all font-mono text-base text-ink">{temporary}</code>
        <Button
          variant="secondary"
          iconLeft="copy"
          onClick={() =>
            void navigator.clipboard
              .writeText(temporary)
              .then(() => toast.success('Passwort kopiert.'))
              .catch(() => toast.error('Kopieren nicht möglich.'))
          }
        >
          Kopieren
        </Button>
      </div>
    </Modal>
  );
}
