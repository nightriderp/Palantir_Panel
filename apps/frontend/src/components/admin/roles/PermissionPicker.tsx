'use client';

import {
  PERMISSION_CATALOG,
  PERMISSIONS,
  type Permission,
} from '@palantir/contracts';
import { useMemo } from 'react';
import { ToggleRow } from '@/components/shared';
import { permissionAreaLabel } from '../labels';

/**
 * Auswahl der Berechtigungen einer Rolle aus dem Permission-Katalog
 * (Pflichtenheft §8). Der Katalog ist die einzige Quelle – hier steht keine
 * eigene Liste, damit eine neue Permission automatisch auftaucht.
 *
 * Rein darstellend: die Auswahl liegt im aufrufenden Editor.
 */

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

export interface PermissionPickerProps {
  selected: readonly Permission[];
  onChange: (permissions: Permission[]) => void;
  disabled?: boolean;
}

export function PermissionPicker({ selected, onChange, disabled }: PermissionPickerProps) {
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
