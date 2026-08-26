import { Icon, cn } from '@/components/shared';

export type AuthFormMessageTone = 'error' | 'warning' | 'info';

export interface AuthFormMessageProps {
  tone?: AuthFormMessageTone;
  children: React.ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<AuthFormMessageTone, string> = {
  error: 'border-danger-line bg-danger-soft text-danger',
  warning: 'border-warning-line bg-warning-soft text-warning',
  info: 'border-brand-line bg-brand-soft text-ink-muted',
};

/**
 * Meldungszeile über der Absende-Schaltfläche eines Anmeldeformulars.
 *
 * Zeigt den zum Fehlercode gehörenden deutschen Satz (siehe
 * `lib/auth/errors.ts`), niemals den technischen Freitext aus der Antwort
 * (Pflichtenheft §5.1).
 *
 * Bewusst kein Toast: die Meldung gehört zum Formular und muss sichtbar
 * bleiben, solange der Fehlerzustand gilt. `role="alert"` sorgt dafür, dass
 * Screenreader sie ohne Fokuswechsel vorlesen.
 */
export function AuthFormMessage({ tone = 'error', children, className }: AuthFormMessageProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon name="warning" size={14} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}
