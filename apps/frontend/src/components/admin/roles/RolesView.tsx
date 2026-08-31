'use client';

import {
  PERMISSION_CATALOG,
  PERMISSIONS,
  type Permission,
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
  TextField,
  ToggleRow,
  formatNumber,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { createRole, deleteRole, fetchRoles, updateRole } from '@/lib/api/admin';
import { type ApiResult, errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';
import { permissionAreaLabel } from '../labels';

/**
 * Rollen- und Berechtigungsverwaltung (Lastenheft §3.2 und §3.7, Pflichtenheft §8).
 *
 * Frei definierbare Rollen als Bündel aus dem Permission-Katalog. Die
 * geschützte Systemrolle „Gast" (`isProtected`) ist weder editier- noch
 * löschbar – das entscheidet der Contract über `permissions.canEdit`/`canDelete`,
 * nicht die Ansicht. Der Owner-Status ist ein Konto-Flag und keine Rolle; er
 * taucht hier deshalb nicht auf.
 *
 * **Warum die Berechtigungsauswahl in dieser Datei steht und nicht daneben:**
 * Sie lag bis hierher als eigene Client-Komponente `PermissionPicker.tsx` im
 * selben Ordner. Mit dieser zweiten Datei ließ der Next.js-Bundler den Eintrag
 * für `RolesView` aus dem React-Client-Manifest weg – die Seite antwortete
 * daraufhin in der Produktion mit HTTP 500 („Could not find the module … in the
 * React Client Manifest"), während jede andere Admin-Seite lief. Reproduzierbar
 * über `next build`: mit der zweiten Datei fehlt der Manifest-Eintrag, ohne sie
 * ist er da. Die Auswahl wird nur hier gebraucht, deshalb ist das Zusammenlegen
 * die kleinere Lösung als ein Umbau der Bündelung. **Nicht wieder in eine
 * eigene Datei herauslösen**, ohne den Manifest-Eintrag danach zu prüfen.
 */

type Editor = { mode: 'create' } | { mode: 'edit'; role: RoleDto } | null;

export function RolesView() {
  const { user } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageRoles ?? false;

  const [editor, setEditor] = useState<Editor>(null);
  const [toDelete, setToDelete] = useState<RoleDto | null>(null);
  const [busy, setBusy] = useState(false);

  const resource = useApiResource<RoleDto[]>((signal) => fetchRoles(signal), canManage ? [] : null);

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
  const [permissions, setPermissions] = useState<Permission[]>(initial?.grantedPermissions ?? []);
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

/** Bereich (Präfix vor dem ersten Punkt) → seine Permissions, in Katalogreihenfolge. */
function groupByArea(): Array<{ area: string; permissions: Permission[] }> {
  const order: string[] = [];
  const byArea = new Map<string, Permission[]>();
  for (const permission of PERMISSIONS) {
    const area = permission.split('.')[0] ?? permission;
    if (!byArea.has(area)) {
      byArea.set(area, []);
      order.push(area);
    }
    byArea.get(area)?.push(permission);
  }
  return order.map((area) => ({ area, permissions: byArea.get(area) ?? [] }));
}

interface PermissionPickerProps {
  selected: readonly Permission[];
  onChange: (permissions: Permission[]) => void;
  disabled?: boolean;
}

/**
 * Auswahl der Berechtigungen einer Rolle aus dem Permission-Katalog
 * (Pflichtenheft §8). Der Katalog ist die einzige Quelle – hier steht keine
 * eigene Liste, damit eine neue Permission automatisch auftaucht.
 *
 * Rein darstellend: die Auswahl liegt im aufrufenden Editor.
 */
function PermissionPicker({ selected, onChange, disabled }: PermissionPickerProps) {
  const groups = useMemo(groupByArea, []);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(permission: Permission, on: boolean) {
    onChange(
      on
        ? [...selected.filter((value) => value !== permission), permission]
        : selected.filter((value) => value !== permission),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ area, permissions }) => (
        <fieldset key={area} className="flex flex-col gap-2">
          <legend className="mb-1 text-2xs uppercase tracking-[0.08em] text-ink-soft">
            {permissionAreaLabel(area)}
          </legend>
          {permissions.map((permission) => (
            <ToggleRow
              key={permission}
              title={PERMISSION_CATALOG[permission].description}
              description={permission}
              checked={selectedSet.has(permission)}
              onChange={(on) => toggle(permission, on)}
              disabled={disabled}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
