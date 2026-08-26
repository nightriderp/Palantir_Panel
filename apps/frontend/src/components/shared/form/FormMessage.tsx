import { type ReactNode } from 'react';

import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../utils/cn';

export type FormMessageTone = 'error' | 'warning' | 'info' | 'success';

export interface FormMessageProps {
  tone?: FormMessageTone;
  /** Anderes Symbol als das der Tonlage, falls die Meldung eines braucht. */
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<FormMessageTone, string> = {
  error: 'border-danger-line bg-danger-soft text-danger',
  warning: 'border-warning-line bg-warning-soft text-warning',
  info: 'border-brand-line bg-brand-soft text-ink-muted',
  success: 'border-success-line bg-success-soft text-success',
};

const TONE_ICONS: Record<FormMessageTone, IconName> = {
  error: 'warning',
  warning: 'warning',
  info: 'warning',
  success: 'check',
};

/**
 * Meldungszeile **innerhalb** eines Formulars – nicht Toast, nicht Modal
 * („Gefundene Punkte“ 26).
 *
 * Sie gehört zum Formular und bleibt sichtbar, solange der Zustand gilt; ein
 * Toast wäre nach ein paar Sekunden weg, ein Modal würde die Eingabe
 * verdecken. `role="alert"` sorgt dafür, dass Screenreader sie ohne
 * Fokuswechsel vorlesen.
 *
 * Gezeigt wird der übersetzte deutsche Satz zum Fehlercode (siehe
 * `lib/auth/errors.ts`), niemals der technische Freitext aus der Antwort
 * (Pflichtenheft §5.1).
 */
export function FormMessage({ tone = 'error', icon, children, className }: FormMessageProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon name={icon ?? TONE_ICONS[tone]} size={14} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}
