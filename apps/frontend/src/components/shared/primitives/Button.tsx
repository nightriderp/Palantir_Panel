'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../utils/cn';

export type ButtonVariant =
  /** Primäraktion einer Ansicht – Marken-Verlauf. Höchstens eine pro Bereich. */
  | 'primary'
  /** Standard-Sekundäraktion (z. B. „Abbrechen", „Verwalten"). */
  | 'secondary'
  /** Zustimmende Aktion mit Signalfarbe (z. B. „Starten"). */
  | 'success'
  /** Zerstörende oder unterbrechende Aktion (z. B. „Löschen", „Stoppen"). */
  | 'danger'
  /** Aktion ohne Fläche, für Textlinks in Kartenzeilen. */
  | 'ghost';

export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Symbol vor der Beschriftung. */
  iconLeft?: IconName;
  /** Symbol nach der Beschriftung. */
  iconRight?: IconName;
  /** Nimmt die volle Breite des Elternelements ein (Formulare, Mobilansicht). */
  fullWidth?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  /**
   * Die Primäraktion trägt zusätzlich einen farbigen Schein nach unten. Ohne
   * ihn steht der Verlauf flach in der Fläche; mit ihm hebt sich der eine
   * wichtige Knopf einer Ansicht sichtbar ab.
   */
  primary:
    'bg-brand-gradient text-white border border-transparent shadow-glow hover:brightness-110',
  secondary: 'bg-fill text-ink border border-line-strong hover:border-ink-disabled',
  success: 'bg-success-soft text-success border border-success-line hover:brightness-110',
  danger: 'bg-danger-soft text-danger border border-danger-line hover:brightness-110',
  ghost: 'bg-transparent text-ink-muted border border-transparent hover:bg-fill hover:text-ink',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-base',
};

/**
 * Klassen einer Schaltfläche – auch für Elemente, die keine `<button>` sind.
 *
 * Ein Download ist ein `<a download>` und muss es bleiben (der Browser lädt
 * dann herunter, statt zu navigieren); optisch soll er neben einer
 * Schaltfläche derselben Größe stehen. Vorher baute die Dateiliste ihre
 * Gefahren-Schaltfläche mit abgeschriebenen Klassen nach (Review 2026-09-16,
 * Befund 12.4) – hier ist die eine Quelle dafür.
 */
export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-semibold',
    // Der Druck sitzt auf `:active`, also schon beim Zeiger-Runter statt
    // erst beim Klick. Wer Bewegung abgeschaltet hat, bekommt nur den
    // Farbwechsel.
    'transition-[color,background-color,border-color,transform] duration-100',
    'active:scale-[0.97] motion-reduce:active:scale-100',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100',
    SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    className,
  );
}

/**
 * Schaltfläche des Design-Systems.
 *
 * Die Komponente trifft **keine** Berechtigungsentscheidung. Ob eine Aktion
 * angeboten wird, entscheidet die aufrufende Ansicht anhand des
 * `permissions`-Objekts aus dem DTO (Pflichtenheft §5.2).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    iconLeft,
    iconRight,
    fullWidth = false,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, cn(fullWidth && 'w-full', className))}
      {...rest}
    >
      {iconLeft ? <Icon name={iconLeft} size={size === 'sm' ? 12 : 14} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={size === 'sm' ? 12 : 14} /> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'iconLeft' | 'iconRight'> {
  icon: IconName;
  /** Pflicht: die Schaltfläche trägt keinen sichtbaren Text. */
  label: string;
}

/** Quadratische Schaltfläche mit nur einem Symbol (z. B. Neustart auf der ServerCard). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'secondary', size = 'md', className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={cn('px-0', size === 'sm' ? 'w-8' : 'w-[38px]', className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 12 : 14} />
    </Button>
  );
});
