'use client';

import {
  type LinkedAccountProfileDto,
  type RegistrationRequestDto,
  type RegistrationRequestStatus,
  type RoleDto,
} from '@palantir/contracts';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FormModal,
  PageHeader,
  Panel,
  SegmentedControl,
  TextField,
  ToggleRow,
  cn,
  formatDate,
  serverInitials,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  approveRegistrationRequest,
  blockRegistrationRequest,
  fetchRegistrationRequests,
  fetchRoles,
  unblockRegistrationRequest,
} from '@/lib/api/admin';
import { type ApiResult, errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';
import { registrationStatusLabel, registrationStatusTone } from '../labels';

/**
 * Freischalt-Warteliste („Anfragen", Lastenheft §3.1 und §3.7).
 *
 * Zeigt die wartenden Konten mit den Profilangaben ihrer Login-Methoden zur
 * Wiedererkennung (Discord-Tag/Avatar, Steam-Profilname, Twitch-Name). Dieselbe
 * Route liefert über den Statusfilter zugleich die freigegebenen und die
 * gesperrten Konten – die Nutzerübersicht (Lastenheft §3.7). Welche Aktionen
 * erscheinen, entscheidet ausschließlich das `permissions`-Objekt des Eintrags.
 */

const STATUS_FILTERS: RegistrationRequestStatus[] = ['pending', 'approved', 'blocked'];

type Dialog =
  | { kind: 'approve'; request: RegistrationRequestDto }
  | { kind: 'block'; request: RegistrationRequestDto }
  | null;

const PROVIDER_LABELS: Record<LinkedAccountProfileDto['provider'], string> = {
  password: 'Passwort',
  discord: 'Discord',
  steam: 'Steam',
  twitch: 'Twitch',
};

function ProfileBadge({ profile }: { profile: LinkedAccountProfileDto }) {
  const label = PROVIDER_LABELS[profile.provider];
  const name = profile.displayName ?? label;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-1 text-sm text-ink-muted">
      {profile.avatarUrl ? (
        // Externe Provider-Avatare: bewusst ein einfaches <img>, damit keine
        // Host-Freigabe für next/image nötig ist. Fällt still weg, wenn es nicht lädt.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.avatarUrl}
          alt=""
          width={18}
          height={18}
          referrerPolicy="no-referrer"
          className="h-4.5 w-4.5 rounded-full object-cover"
        />
      ) : null}
      <span className="text-2xs uppercase tracking-[0.06em] text-ink-faint">{label}</span>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function RequestsView() {
  const { user } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageUsers ?? false;

  const [status, setStatus] = useState<RegistrationRequestStatus>('pending');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const resource = useApiResource<RegistrationRequestDto[]>(
    (signal) => fetchRegistrationRequests({ status, limit: 200, offset: 0 }, signal),
    canManage ? [status] : null,
  );

  const requests = useMemo(() => resource.data ?? [], [resource.data]);

  async function run(call: () => Promise<ApiResult<RegistrationRequestDto>>, success: string) {
    setBusy(true);
    const result = await call();
    setBusy(false);
    if (result.success) {
      toast.success(success);
      setDialog(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Anfragen" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Nutzerverwaltung" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Anfragen"
        subtitle="Neue Registrierungen freigeben oder sperren"
        className="-mx-5 -mt-5 px-5"
      />

      <SegmentedControl
        label="Nach Zustand filtern"
        value={status}
        onChange={setStatus}
        items={STATUS_FILTERS.map((key) => ({ key, label: registrationStatusLabel(key) }))}
      />

      {resource.loading ? (
        <AdminLoading label="Konten werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : requests.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          {status === 'pending'
            ? 'Keine offenen Anfragen.'
            : status === 'blocked'
              ? 'Keine gesperrten Konten.'
              : 'Keine freigegebenen Konten.'}
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.userId}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">
                      {serverInitials(request.displayName)}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-base font-semibold text-ink">
                        {request.displayName}
                      </span>
                      <span className="text-sm text-ink-faint">
                        Registriert am {formatDate(request.registeredAt)}
                      </span>
                    </div>
                  </div>
                  <Badge tone={registrationStatusTone(request.status)} withDot>
                    {registrationStatusLabel(request.status)}
                  </Badge>
                </div>

                {request.profiles.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {request.profiles.map((profile) => (
                      <ProfileBadge
                        key={`${profile.provider}-${profile.linkedAt}`}
                        profile={profile}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink-faint">Keine verknüpften Profile.</p>
                )}

                {request.roleNames.length > 0 ? (
                  <p className="text-sm text-ink-muted">
                    Rollen: <span className="text-ink">{request.roleNames.join(', ')}</span>
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {request.permissions.canApprove ? (
                    <Button
                      variant="success"
                      iconLeft="check"
                      onClick={() => setDialog({ kind: 'approve', request })}
                    >
                      Freigeben
                    </Button>
                  ) : null}
                  {request.permissions.canBlock ? (
                    <Button
                      variant="danger"
                      iconLeft="lock"
                      onClick={() => setDialog({ kind: 'block', request })}
                    >
                      Sperren
                    </Button>
                  ) : null}
                  {request.permissions.canUnblock ? (
                    <Button
                      variant="secondary"
                      iconLeft="restart"
                      onClick={() =>
                        void run(
                          () => unblockRegistrationRequest(request.userId),
                          `„${request.displayName}" ist wieder freigeschaltet.`,
                        )
                      }
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

      {dialog?.kind === 'approve' ? (
        <ApproveDialog
          request={dialog.request}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(roleIds) =>
            void run(
              () =>
                approveRegistrationRequest(
                  dialog.request.userId,
                  roleIds.length > 0 ? { roleIds } : {},
                ),
              `„${dialog.request.displayName}" ist freigeschaltet.`,
            )
          }
        />
      ) : null}

      {dialog?.kind === 'block' ? (
        <BlockDialog
          request={dialog.request}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={(reason) =>
            void run(
              () =>
                blockRegistrationRequest(
                  dialog.request.userId,
                  reason.trim() ? { reason: reason.trim() } : {},
                ),
              `„${dialog.request.displayName}" ist gesperrt.`,
            )
          }
        />
      ) : null}
    </div>
  );
}

/** Freigabe mit optionaler Rollenauswahl (ohne Auswahl vergibt das Backend „Nutzer"). */
function ApproveDialog({
  request,
  busy,
  onClose,
  onSubmit,
}: {
  request: RegistrationRequestDto;
  busy: boolean;
  onClose: () => void;
  onSubmit: (roleIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const roles = useApiResource<RoleDto[]>((signal) => fetchRoles(signal), []);

  // Die geschützte Gast-Rolle steht nicht zur Auswahl: Freigeben heißt gerade,
  // sie zu ersetzen (registration-request.ts).
  const assignable = (roles.data ?? []).filter((role) => !role.isProtected);

  function toggle(roleId: string, on: boolean) {
    setSelected((current) => (on ? [...current, roleId] : current.filter((id) => id !== roleId)));
  }

  return (
    <FormModal
      open
      onClose={onClose}
      title={`„${request.displayName}" freigeben`}
      description={'Ohne Auswahl erhält das Konto die Standardrolle „Nutzer".'}
      submitLabel="Freigeben"
      busy={busy}
      onSubmit={() => onSubmit(selected)}
    >
      {roles.loading ? (
        <p className="text-sm text-ink-faint">Rollen werden geladen …</p>
      ) : assignable.length === 0 ? (
        <p className="text-sm text-ink-faint">Keine zusätzlichen Rollen verfügbar.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {assignable.map((role) => (
            <ToggleRow
              key={role.id}
              title={role.name}
              description={role.description ?? undefined}
              checked={selected.includes(role.id)}
              onChange={(on) => toggle(role.id, on)}
            />
          ))}
        </div>
      )}
    </FormModal>
  );
}

/** Sperren – über die Gefahren-Bestätigung aus F2, mit optionalem Grund. */
function BlockDialog({
  request,
  busy,
  onClose,
  onConfirm,
}: {
  request: RegistrationRequestDto;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <DangerConfirmDialog
      open
      onClose={onClose}
      title={`„${request.displayName}" sperren?`}
      confirmLabel="Sperren"
      busy={busy}
      onConfirm={() => onConfirm(reason)}
      message={
        <div className={cn('flex flex-col gap-3')}>
          <p>
            Das Konto verliert sofort jeden Zugriff. Die Sperre lässt sich später wieder aufheben.
          </p>
          <TextField
            label="Grund (optional)"
            value={reason}
            onChange={setReason}
            placeholder="z. B. Spam-Registrierung"
          />
        </div>
      }
    />
  );
}
