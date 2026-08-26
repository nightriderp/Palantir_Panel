'use client';

import {
  type GameConfigField,
  type GameConfigValue,
  type GameConfigValues,
} from '@palantir/contracts';
import { FieldShell, NumberField, SelectField, TextField, Toggle } from './Fields';

/**
 * Formular aus dem Config-Schema eines Spieltyps (Pflichtenheft §11).
 *
 * Das Frontend kennt kein einziges Spiel: Welche Felder es gibt, sagt die
 * `GameTypeDefinition`. Genutzt von Schritt „Optionen" im Wizard und vom Reiter
 * „Einstellungen" – dort mit `lockAfterCreate`, weil Felder wie der Welt-Seed
 * nach dem Anlegen feststehen.
 */

const LOCKED_HINT =
  'Steht seit dem Anlegen fest. Ein anderer Wert würde eine neue Welt erzeugen und die bestehende zurücklassen.';

export interface ConfigFieldsProps {
  fields: readonly GameConfigField[];
  values: GameConfigValues;
  onChange: (key: string, value: GameConfigValue) => void;
  /**
   * Felder mit `lockedAfterCreate` sperren. Im Wizard `false` (dort werden sie
   * gerade festgelegt), in den Einstellungen `true`.
   */
  lockAfterCreate: boolean;
  /** Alles sperren, z. B. weil `permissions.canManageSettings` fehlt. */
  disabled?: boolean;
  /** Schlüssel der Pflichtfelder, die noch leer sind. */
  missingKeys?: readonly string[];
}

export function ConfigFields({
  fields,
  values,
  onChange,
  lockAfterCreate,
  disabled = false,
  missingKeys = [],
}: ConfigFieldsProps) {
  if (fields.length === 0) {
    return (
      <p className="text-base text-ink-faint">
        Dieses Spiel bringt keine zusätzlichen Einstellungen mit.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        const locked = disabled || (lockAfterCreate && field.lockedAfterCreate);
        const hint = lockAfterCreate && field.lockedAfterCreate ? LOCKED_HINT : field.description;
        const error = missingKeys.includes(field.key) ? 'Dieses Feld ist erforderlich.' : null;
        const value = values[field.key];

        switch (field.type) {
          case 'toggle':
            return (
              <FieldShell key={field.key} label={field.label} hint={hint} error={error}>
                <Toggle
                  label={field.label}
                  checked={value === true}
                  disabled={locked}
                  onChange={(next) => onChange(field.key, next)}
                />
              </FieldShell>
            );

          case 'number':
            return (
              <NumberField
                key={field.key}
                label={field.label}
                hint={hint}
                error={error}
                disabled={locked}
                min={field.min ?? undefined}
                max={field.max ?? undefined}
                value={typeof value === 'number' ? value : Number(value ?? 0)}
                onChange={(next) => onChange(field.key, next)}
              />
            );

          case 'select':
            return (
              <SelectField
                key={field.key}
                label={field.label}
                hint={hint}
                error={error}
                disabled={locked}
                value={String(value ?? '')}
                options={field.options.map((option) => ({ value: option, label: option }))}
                onChange={(next) => onChange(field.key, next)}
              />
            );

          case 'password':
          case 'text':
            return (
              <TextField
                key={field.key}
                label={field.label}
                hint={hint}
                error={error}
                disabled={locked}
                type={field.type === 'password' ? 'password' : 'text'}
                value={String(value ?? '')}
                onChange={(next) => onChange(field.key, next)}
              />
            );
        }
      })}
    </div>
  );
}
