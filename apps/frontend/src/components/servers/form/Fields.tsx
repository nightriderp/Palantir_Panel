'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/components/shared';

/**
 * Formularfelder für die Ansichten des Arbeitspakets F3.
 *
 * **Vorläufig hier statt in F2:** Das Design-System bringt bisher keine
 * Eingabefelder mit (siehe „Gefundene Punkte" in WORK_STATUS.md). Sobald F2 sie
 * hat, werden diese Bausteine dorthin gezogen und hier entfernt – die Optik
 * folgt deshalb ausschließlich den Tokens aus `tailwind.config.ts`, ohne einen
 * einzigen literalen Farb- oder Radiuswert.
 */

const CONTROL_CLASSES =
  'w-full rounded-md border border-line-strong bg-fill px-3 py-2.5 text-base text-ink outline-none focus-visible:border-brand disabled:cursor-not-allowed disabled:text-ink-disabled';

export interface FieldShellProps {
  label: string;
  /** Erklärtext unter dem Feld. */
  hint?: ReactNode;
  /** Fehlermeldung; ersetzt den Erklärtext und färbt ihn. */
  error?: string | null;
  /** Zusatz rechts neben der Beschriftung, z. B. der aktuelle Wert. */
  labelAside?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/** Rahmen aus Beschriftung, Feld und Hinweis – überall gleich aufgebaut. */
export function FieldShell({
  label,
  hint,
  error,
  labelAside,
  htmlFor,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm text-ink-muted">
          {label}
        </label>
        {labelAside ? <span className="font-mono text-xs text-ink-faint">{labelAside}</span> : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<FieldShellProps, 'children' | 'htmlFor'> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  disabled?: boolean;
  /** Inhalt rechts im Feld, z. B. die Basis-Domain hinter der Subdomain. */
  suffix?: ReactNode;
  autoFocus?: boolean;
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  suffix,
  autoFocus,
  ...shell
}: TextFieldProps) {
  const id = useId();
  const input = (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      className={cn(CONTROL_CLASSES, suffix ? 'rounded-r-none border-r-0' : undefined)}
    />
  );

  return (
    <FieldShell {...shell} htmlFor={id}>
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

export interface NumberFieldProps extends Omit<FieldShellProps, 'children' | 'htmlFor'> {
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
  const id = useId();
  return (
    <FieldShell {...shell} htmlFor={id}>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={CONTROL_CLASSES}
      />
    </FieldShell>
  );
}

export interface SelectFieldProps extends Omit<FieldShellProps, 'children' | 'htmlFor'> {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  /** Erster Eintrag ohne Wert, z. B. „Node wählen …". */
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
  const id = useId();
  return (
    <FieldShell {...shell} htmlFor={id}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL_CLASSES}
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

export interface SliderFieldProps extends Omit<FieldShellProps, 'children' | 'htmlFor'> {
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
  const id = useId();
  return (
    <FieldShell {...shell} htmlFor={id}>
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
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
