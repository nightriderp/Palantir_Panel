'use client';

import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { Spinner } from './Spinner';
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
  /**
   * Die Aktion läuft: Die Schaltfläche zeigt einen Spinner **anstelle** ihres
   * linken Symbols und nimmt keine weiteren Klicks an.
   *
   * Gesperrt wird dabei mit gesetzt – eine laufende Aktion soll sich nicht
   * doppelt auslösen lassen. `disabled` bleibt daneben gültig: Eine
   * Schaltfläche kann gesperrt sein, ohne zu laufen.
   *
   * Der Spinner ersetzt `iconLeft`, statt daneben zu treten: Sonst würde die
   * Schaltfläche beim Start der Aktion breiter und die ganze Zeile
   * nachrutschen.
   */
  loading?: boolean;
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
 * Eine gesperrte Schaltfläche: blass, und der Zeiger sagt „hier geht nichts".
 */
const GESPERRT = 'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Eine Schaltfläche, deren Aktion gerade läuft.
 *
 * ⚠️ **Bewusst ohne jede Deckkraft-Angabe**, und das ist der ganze Punkt: Mit
 * `disabled:opacity-50` sähe die laufende Aktion genau so aus wie eine
 * gesperrte – blass und tot. Dieser Anblick war der Anlass für `loading`
 * überhaupt. Sichtbar wird der Unterschied durch den Spinner und den Zeiger,
 * nicht durch Verblassen.
 *
 * Deshalb steht das hier als **Entweder-oder** und nicht als nachgeschobenes
 * `disabled:opacity-100`: Tailwind gibt seine Deckkraft-Klassen nicht
 * aufsteigend aus (im erzeugten Stylesheet steht `100` vor `50`), ein
 * Überschreiben hätte also stillschweigend nicht gegriffen. Genau so war es
 * beim ersten Versuch – der Knopf blieb bei 0,5.
 */
const ARBEITET = 'cursor-wait';

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
  /**
   * Läuft die Aktion? Dann gilt die Optik einer **arbeitenden** Schaltfläche
   * statt der einer gesperrten – siehe {@link GESPERRT} und {@link ARBEITET}.
   */
  loading = false,
): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-semibold',
    // Der Druck sitzt auf `:active`, also schon beim Zeiger-Runter statt
    // erst beim Klick. Wer Bewegung abgeschaltet hat, bekommt nur den
    // Farbwechsel.
    'transition-[color,background-color,border-color,transform] duration-100',
    'active:scale-[0.97] motion-reduce:active:scale-100',
    'disabled:hover:brightness-100',
    loading ? ARBEITET : GESPERRT,
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
    loading = false,
    disabled,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const symbolgroesse = size === 'sm' ? 12 : 14;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled ?? loading}
      /*
        `aria-busy` sagt einem Vorlesewerkzeug, was der Spinner dem Auge sagt.
        Ohne das wäre die Schaltfläche dort nur „nicht verfügbar" – und der
        Unterschied zwischen „läuft gerade" und „geht hier nicht" ist genau
        der, auf den es in dem Moment ankommt.
      */
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(fullWidth && 'w-full', className), loading)}
      {...rest}
    >
      {loading ? (
        <Spinner size={symbolgroesse} />
      ) : iconLeft ? (
        <Icon name={iconLeft} size={symbolgroesse} />
      ) : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={symbolgroesse} /> : null}
    </button>
  );
});

export interface ButtonLinkProps {
  /** Ziel-Route. */
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: IconName;
  iconRight?: IconName;
  fullWidth?: boolean;
  className?: string;
  title?: string;
  children?: ReactNode;
}

/**
 * Schaltfläche, die in Wahrheit ein Link ist.
 *
 * **Für jeden Knopf, der nichts tut außer zu navigieren.** Vorher standen an
 * diesen Stellen `<Button onClick={() => router.push(…)}>`, und das kostet
 * spürbar: `router.push` lädt die Zielroute erst beim Klick. Ein `<Link>`
 * dagegen holt sie schon vor, sobald er ins Bild kommt – und weil seit
 * `(dashboard)/loading.tsx` eine Suspense-Grenze existiert, ist das Vorholen
 * überhaupt erst wirksam. Nebenbei bekommt der Eintrag damit das, was ein Link
 * mitbringt und ein `<button>` nie hatte: Mittelklick in neuem Tab,
 * „Adresse kopieren", eine sichtbare Zieladresse in der Statusleiste.
 *
 * Programmatische Sprünge **nach** einer Aktion (nach dem Anlegen zum neuen
 * Server, nach dem Abmelden zur Anmeldung) bleiben bei `router.push` – dort
 * gibt es keinen Klick, an dem ein Link hängen könnte.
 *
 * Die Optik kommt aus {@link buttonClasses}, damit ein Link neben einer echten
 * Schaltfläche nicht auffällt. Kein `loading`: Ein Link löst nichts aus, was
 * laufen könnte – dessen Wartezeit zeigt `useLinkStatus` in der Seitenleiste.
 */
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth = false,
  className,
  title,
  children,
}: ButtonLinkProps) {
  const symbolgroesse = size === 'sm' ? 12 : 14;

  return (
    <Link
      href={href}
      title={title}
      className={buttonClasses(variant, size, cn(fullWidth && 'w-full', className))}
    >
      {iconLeft ? <Icon name={iconLeft} size={symbolgroesse} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={symbolgroesse} /> : null}
    </Link>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'iconLeft' | 'iconRight'> {
  icon: IconName;
  /** Pflicht: die Schaltfläche trägt keinen sichtbaren Text. */
  label: string;
}

/** Quadratische Schaltfläche mit nur einem Symbol (z. B. Neustart auf der ServerCard). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'secondary', size = 'md', loading = false, className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      loading={loading}
      aria-label={label}
      title={label}
      className={cn('px-0', size === 'sm' ? 'w-8' : 'w-[38px]', className)}
      {...rest}
    >
      {/*
        Bei laufender Aktion steht der Spinner schon als Kind der Schaltfläche;
        das Symbol daneben würde den quadratischen Knopf sprengen.
      */}
      {loading ? null : <Icon name={icon} size={size === 'sm' ? 12 : 14} />}
    </Button>
  );
});
