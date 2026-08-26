'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../utils/cn';

/**
 * Formular-Bausteine des Design-Systems (Arbeitspaket R4, „Gefundene Punkte“ 26 und 47).
 *
 * Vorlage war die Fassung, die F3 unter `components/servers/form/Fields.tsx`
 * vorläufig gebaut hatte; ergänzt wurde, was F1 zusätzlich brauchte:
 * Fehlerrahmen am Eingabefeld, `aria-invalid`/`aria-describedby`, freie
 * Eingabe-Attribute (`autoComplete`, `inputMode`, …) und eine zweite
 * Beschriftungsvariante. F1 und F3 nutzen seitdem ausschließlich diese Datei.
 *
 * Regeln wie im übrigen Design-System: rein darstellend, Werte per Props,
 * Änderungen per Callback nach oben, Oberflächensprache Deutsch, Mobile-First
 * und **keine literalen Farb- oder Radiuswerte** – nur Tokens aus
 * `tailwind.config.ts`.
 */

/** Grundoptik aller Eingabe-Elemente (Text, Zahl, Auswahl). */
const CONTROL_BASE =
  'w-full rounded-md border bg-fill px-3 py-2.5 text-base text-ink outline-none placeholder:text-ink-disabled focus-visible:border-brand disabled:cursor-not-allowed disabled:text-ink-disabled';

/** Rahmenfarbe abhängig davon, ob zum Feld ein Fehler gemeldet ist. */
function controlClasses(error: string | null | undefined, extra?: string): string {
  return cn(CONTROL_BASE, error ? 'border-danger-line' : 'border-line-strong', extra);
}

/**
 * Beschriftungsvarianten.
 *
 * - `plain` – Standard in den Dashboard-Formularen (Wizard, Einstellungen).
 * - `caps` – Versalien-Variante der Anmelde-Ansichten (F1).
 */
export type FieldLabelVariant = 'plain' | 'caps';

const LABEL_CLASSES: Record<FieldLabelVariant, string> = {
  plain: 'text-sm text-ink-muted',
  caps: 'text-xs uppercase tracking-[0.08em] text-ink-muted',
};

export interface FieldShellProps {
  label: string;
  /** Erklärtext unter dem Feld. */
  hint?: ReactNode;
  /** Fehlermeldung; ersetzt den Erklärtext und färbt ihn. */
  error?: string | null;
  /** Zusatz rechts neben der Beschriftung, z. B. der aktuelle Wert. */
  labelAside?: ReactNode;
  labelVariant?: FieldLabelVariant;
  htmlFor?: string;
  /** ID des Hinweistextes – die Feldkomponenten verdrahten damit `aria-describedby`. */
  hintId?: string;
  /** ID der Fehlermeldung – dito. */
  errorId?: string;
  children: ReactNode;
  className?: string;
}

/** Rahmen aus Beschriftung, Feld und Hinweis – überall gleich aufgebaut. */
export function FieldShell({
  label,
  hint,
  error,
  labelAside,
  labelVariant = 'plain',
  htmlFor,
  hintId,
  errorId,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className={LABEL_CLASSES[labelVariant]}>
          {label}
        </label>
        {labelAside ? <span className="font-mono text-xs text-ink-faint">{labelAside}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Gemeinsame Props aller Felder: der Rahmen ohne die von der Feldkomponente gesetzten Teile. */
type FieldProps = Omit<FieldShellProps, 'children' | 'htmlFor' | 'hintId' | 'errorId'>;

/** IDs für Feld, Hinweis und Fehlermeldung samt fertigem `aria-describedby`. */
function useFieldIds(hint: ReactNode, error: string | null | undefined) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return {
    id,
    hintId,
    errorId,
    // Der Rahmen zeigt entweder Fehler oder Hinweis – beschrieben wird genau das Sichtbare.
    describedBy: error ? errorId : hint ? hintId : undefined,
  };
}

/** Eingabe-Attribute, die eine Feldkomponente selbst setzt und deshalb nicht durchreicht. */
type PassthroughInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | 'id'
  | 'type'
  | 'value'
  | 'onChange'
  | 'disabled'
  | 'className'
  | 'placeholder'
  | 'autoComplete'
  | 'autoFocus'
>;

export interface TextFieldProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'email';
  disabled?: boolean;
  /** Inhalt rechts im Feld, z. B. die Basis-Domain hinter der Subdomain. */
  suffix?: ReactNode;
  autoFocus?: boolean;
  /**
   * Standard `off`. Anmelde-Ansichten setzen hier die passende Angabe
   * (`username`, `current-password`, `one-time-code`, …), damit Passwortspeicher
   * das Feld erkennen.
   */
  autoComplete?: string;
  /** Zusätzliche Klassen nur für das Eingabefeld, z. B. der zentrierte 2FA-Code. */
  inputClassName?: string;
  /** Restliche Eingabe-Attribute wie `inputMode`, `maxLength`, `spellCheck`. */
  inputProps?: PassthroughInputProps;
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  suffix,
  autoFocus,
  autoComplete = 'off',
  inputClassName,
  inputProps,
  ...shell
}: TextFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(shell.hint, shell.error);
  const input = (
    <input
      {...inputProps}
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      aria-invalid={shell.error ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
      className={controlClasses(
        shell.error,
        cn(suffix ? 'rounded-r-none border-r-0' : undefined, inputClassName),
      )}
    />
  );

  return (
    <FieldShell {...shell} htmlFor={id} hintId={hintId} errorId={errorId}>
      {suffix ? (
        <div className="flex">
          {input}
          <span className="flex items-center rounded-r-md border border-line-strong bg-fill-strong px-3 text-sm text-ink-muted">
            {suffix}
          </span>
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}

export interface NumberFieldProps extends FieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  ...shell
}: NumberFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(shell.hint, shell.error);
  return (
    <FieldShell {...shell} htmlFor={id} hintId={hintId} errorId={errorId}>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.target.value))}
        className={controlClasses(shell.error)}
      />
    </FieldShell>
  );
}

export interface SelectFieldProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  /** Erster Eintrag ohne Wert, z. B. „Node wählen …“. */
  placeholder?: string;
  disabled?: boolean;
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ...shell
}: SelectFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(shell.hint, shell.error);
  return (
    <FieldShell {...shell} htmlFor={id} hintId={hintId} errorId={errorId}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={controlClasses(shell.error)}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export interface SliderFieldProps extends FieldProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
}

/** Schieberegler für Ressourcen – auf dem Smartphone gut zu treffen. */
export function SliderField({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  ...shell
}: SliderFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(shell.hint, shell.error);
  return (
    <FieldShell {...shell} htmlFor={id} hintId={hintId} errorId={errorId}>
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-6 w-full accent-brand"
      />
    </FieldShell>
  );
}

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Beschriftung für Screenreader, wenn daneben kein Text steht. */
  label: string;
  disabled?: boolean;
}

/** Schalter im Stil des Mockups. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5',
        checked ? 'border-transparent bg-brand' : 'border-line-strong bg-fill',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-4.5 w-4.5 rounded-full bg-ink transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export interface ToggleRowProps {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Zeile mit Text links und Schalter rechts (Einstellungen, Aufgabenliste). */
export function ToggleRow({ title, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-fill px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-base font-semibold">{title}</div>
        {description ? <div className="mt-0.5 text-xs text-ink-faint">{description}</div> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}
