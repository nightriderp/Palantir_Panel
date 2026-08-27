'use client';

import { type Permission, type RoleDto } from '@palantir/contracts';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FormModal,
  PageHeader,
  Panel,
  TextField,
  formatNumber,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { createRole, deleteRole, fetchRoles, updateRole } from '@/lib/api/admin';
import { type ApiResult, errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';
import { PermissionPicker } from './PermissionPicker';

/**
 * Rollen- und Berechtigungsverwaltung (Lastenheft §3.2 und §3.7, Pflichtenheft §8).
 *
 * Frei definierbare Rollen als Bündel aus dem Permission-Katalog. Die
 * geschützte Systemrolle „Gast" (`isProtected`) ist weder editier- noch
 * löschbar – das entscheidet der Contract über `permissions.canEdit`/`canDelete`,
 * nicht die Ansicht. Der Owner-Status ist ein Konto-Flag und keine Rolle; er
 * taucht hier deshalb nicht auf.
 */

type Editor =
  | { mode: 'create' }
  | { mode: 'edit'; role: RoleDto }
  | null;

export function RolesView() {
  const { user } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageRoles ?? false;

  const [editor, setEditor] = useState<Editor>(null);
  const [toDelete, setToDelete] = useState<RoleDto | null>(null);
  const [busy, setBusy] = useState(false);

  const resource = useApiResource<RoleDto[]>(
    (signal) => fetchRoles(signal),
    canManage ? [] : null,
  );

  const roles = useMemo(() => resource.data ?? [], [resource.data]);

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    const result = await deleteRole(toDelete.id);
    setBusy(false);
    if (result.success) {
      toast.success(`Rolle „${toDelete.name}" gelöscht.`);
      setToDelete(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Rollen" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Rollenverwaltung" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Rollen"
        subtitle="Berechtigungen zu frei definierbaren Rollen bündeln"
        className="-mx-5 -mt-5 px-5"
        actions={
          <Button variant="primary" iconLeft="plus" onClick={() => setEditor({ mode: 'create' })}>
            Neue Rolle
          </Button>
        }
      />

      {resource.loading ? (
        <AdminLoading label="Rollen werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : (
        <ul className="flex flex-col gap-3">
          {roles.map((role) => (
            <li key={role.id}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-ink">{role.name}</span>
                      {role.isProtected ? <Badge tone="brand">Systemrolle</Badge> : null}
                    </div>
                    {role.description ? (
                      <p className="text-sm text-ink-muted">{role.description}</p>
                    ) : null}
                    <p className="text-sm text-ink-faint">
                      {formatNumber(role.memberCount)}{' '}
                      {role.memberCount === 1 ? 'Mitglied' : 'Mitglieder'} ·{' '}
                      {formatNumber(role.grantedPermissions.length)}{' '}
                      {role.grantedPermissions.length === 1 ? 'Berechtigung' : 'Berechtigungen'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {role.permissions.canEdit ? (
                      <Button
                        variant="secondary"
                        iconLeft="gear"
                        onClick={() => setEditor({ mode: 'edit', role })}
                      >
                        Bearbeiten
                      </Button>
                    ) : null}
                    {role.permissions.canDelete ? (
                      <Button variant="danger" iconLeft="trash" onClick={() => setToDelete(role)}>
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
        <RoleEditor
          editor={editor}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            toast.success(
              editor.mode === 'create'
                ? `Rolle „${saved.name}" angelegt.`
                : `Rolle „${saved.name}" gespeichert.`,
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
          title={`Rolle „${toDelete.name}" löschen?`}
          confirmLabel="Rolle löschen"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          message={
            toDelete.memberCount > 0
              ? `Die Rolle wird ${toDelete.memberCount} ${
                  toDelete.memberCount === 1 ? 'Konto' : 'Konten'
                } entzogen und endgültig entfernt.`
              : 'Die Rolle wird endgültig entfernt.'
          }
        />
      ) : null}
    </div>
  );
}

/** Anlegen oder Bearbeiten einer Rolle. */
function RoleEditor({
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
  onSaved: (role: RoleDto) => void;
}) {
  const initial = editor.mode === 'edit' ? editor.role : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [permissions, setPermissions] = useState<Permission[]>(
    initial?.grantedPermissions ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 2 && trimmedName.length <= 50;

  async function submit() {
    setBusy(true);
    setError(null);
    const cleanDescription = description.trim() ? description.trim() : null;

    const result: ApiResult<RoleDto> =
      editor.mode === 'create'
        ? await createRole({ name: trimmedName, description: cleanDescription, permissions })
        : await updateRole(editor.role.id, {
            name: trimmedName,
            description: cleanDescription,
            permissions,
          });

    setBusy(false);
    if (result.success) {
      onSaved(result.data);
    } else {
      setError(errorText(result));
    }
  }

  return (
    <FormModal
      open
      onClose={onClose}
      title={editor.mode === 'create' ? 'Neue Rolle' : `Rolle „${editor.role.name}" bearbeiten`}
      submitLabel={editor.mode === 'create' ? 'Anlegen' : 'Speichern'}
      submitDisabled={!nameValid}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
    >
      <TextField
        label="Name"
        value={name}
        onChange={setName}
        placeholder="z. B. Moderator"
        hint="2 bis 50 Zeichen."
      />
      <TextField
        label="Beschreibung (optional)"
        value={description}
        onChange={setDescription}
        placeholder="Wofür ist die Rolle gedacht?"
      />
      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-muted">Berechtigungen</span>
        <PermissionPicker selected={permissions} onChange={setPermissions} disabled={busy} />
      </div>
    </FormModal>
  );
}
