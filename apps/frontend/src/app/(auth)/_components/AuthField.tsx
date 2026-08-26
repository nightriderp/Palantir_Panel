'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/components/shared';

/**
 * Beschriftetes Eingabefeld der Anmelde-Ansichten.
 *
 * **Hinweis zur Zuständigkeit:** F2 (Shared UI) führt bisher keine
 * Formular-Bausteine – weder Label noch Eingabefeld noch Feldfehler. Dieses
 * Feld ist deshalb bewusst **lokal zu F1** und nicht als allgemeine Variante
 * gedacht; sobald F2 einen Baustein dafür hat, wird hier darauf umgestellt. Die
 * Lücke ist unter „Gefundene Punkte" in WORK_STATUS.md vermerkt (CLAUDE.md §6).
 *
 * Farb-, Radius- und Schriftwerte kommen ausschließlich aus den F2-Tokens.
 */
export interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Fehlermeldung zu diesem Feld; färbt den Rahmen und wird vorgelesen. */
  error?: string | null;
  /** Erläuterung unter dem Feld (z. B. Mindestlänge des Passworts). */
  hint?: ReactNode;
  /** Zusätzliche Klassen für das Eingabefeld selbst. */
  inputClassName?: string;
}

export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { label, error, hint, className, inputClassName, ...rest },
  ref,
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={className}>
      <label htmlFor={id} className="text-xs uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </label>
      <input
        {...rest}
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hint ? hintId : null, error ? errorId : null) || undefined}
        className={cn(
          'mt-1.5 w-full rounded-md border bg-fill px-3 py-2.5 text-base text-ink outline-none',
          'placeholder:text-ink-disabled',
          error ? 'border-danger-line' : 'border-line-strong',
          inputClassName,
        )}
      />
      {hint ? (
        <p id={hintId} className="mt-1.5 text-sm text-ink-faint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
