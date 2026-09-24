'use client';

import {
  type GameConfigField,
  type GameConfigValue,
  type GameConfigValues,
} from '@palantir/contracts';
import { useState } from 'react';
import { FieldShell, NumberField, SelectField, TextField, Toggle } from '@/components/shared';

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
  /**
   * Beschreibungen weglassen – in der kompakten Live-Steuerung, wo „Die Karte,
   * mit der der Server startet“ nicht passt.
   */
  hideHints?: boolean;
}

/**
 * Zahl aus einer Eingabe, die auch ein Link sein darf (`numberFromLink`): nur
 * Ziffern → die Zahl; sonst der Parameter `param` der Adresse (Steam-Workshop:
 * `…?id=3070284539`). `null`, wenn keine Zahl darin steckt.
 */
export function zahlAusLink(eingabe: string, param: string): number | null {
  const text = eingabe.trim();

  if (/^\d+$/u.test(text)) return Number(text);

  const treffer = new RegExp(`[?&]${param}=(\\d+)`, 'u').exec(text);

  return treffer?.[1] === undefined ? null : Number(treffer[1]);
}

/**
 * Zahlenfeld, das auch einen Link annimmt (Betreiber-Wunsch 25.09.2026).
 * Angezeigt wird die gespeicherte Zahl; wer einen Link einfügt, sieht danach
 * die Zahl daraus. Was keine Zahl enthält, ändert nichts und sagt warum.
 */
function LinkZahlFeld({
  field,
  value,
  hint,
  error,
  disabled,
  onChange,
}: {
  field: GameConfigField;
  value: GameConfigValue | undefined;
  hint: string | undefined;
  error: string | null;
  disabled: boolean;
  onChange: (key: string, value: GameConfigValue) => void;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const param = field.numberFromLink?.param ?? 'id';

  return (
    <TextField
      label={field.label}
      hint={hint}
      error={error ?? fehler}
      disabled={disabled}
      value={value === undefined || value === 0 ? '' : String(value)}
      placeholder={`Link oder Zahl (…?${param}=…)`}
      inputProps={{ inputMode: 'text', spellCheck: false }}
      onChange={(eingabe) => {
        if (eingabe.trim() === '') {
          setFehler(null);
          onChange(field.key, 0);

          return;
        }

        const zahl = zahlAusLink(eingabe, param);

        if (zahl === null) {
          setFehler(`Kein Link mit „?${param}=“ und keine Zahl.`);

          return;
        }

        setFehler(null);
        onChange(field.key, zahl);
      }}
    />
  );
}

export function ConfigFields({
  fields,
  values,
  onChange,
  lockAfterCreate,
  disabled = false,
  missingKeys = [],
  hideHints = false,
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
        // Nur bei bestimmtem Wert eines anderen Felds (`visibleWhen`) – die
        // Workshop-ID etwa nur bei Karte „workshop“. Der Wert bleibt erhalten.
        if (
          field.visibleWhen !== undefined &&
          !field.visibleWhen.values.includes(String(values[field.visibleWhen.field] ?? ''))
        ) {
          return null;
        }

        const locked = disabled || (lockAfterCreate && field.lockedAfterCreate);
        const hint = hideHints
          ? undefined
          : lockAfterCreate && field.lockedAfterCreate
            ? LOCKED_HINT
            : field.description;
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
            if (field.numberFromLink !== undefined) {
              return (
                <LinkZahlFeld
                  key={field.key}
                  field={field}
                  value={value}
                  hint={hint ?? undefined}
                  error={error}
                  disabled={locked}
                  onChange={onChange}
                />
              );
            }

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
                // `GameConfigValue` kennt kein `null` (Vertrag: Text, Zahl oder
                // Schalter). Ein geleertes Feld meldet deshalb nichts nach oben
                // – der zuletzt gültige Wert bleibt im Entwurf stehen, statt zu
                // einer 0 zu werden (Audit-Fundstelle frontend-lib-13).
                onChange={(next) => {
                  if (next === null) return;
                  onChange(field.key, next);
                }}
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
                // Anzeigenamen, wo die Definition welche hat (z. B. „MatchZy
                // (Turniere, Scrims)“ statt `matchzy`); gespeichert wird der Wert.
                options={field.options.map((option) => ({
                  value: option,
                  label: field.optionLabels?.[option] ?? option,
                }))}
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
