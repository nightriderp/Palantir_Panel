'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { cn } from '../utils/cn';

export interface ModalProps {
  open: boolean;
  /** Wird bei Escape, Klick auf den Hintergrund und über das Kreuz aufgerufen. */
  onClose: () => void;
  /** Überschrift des Dialogs; dient zugleich als Beschriftung für Screenreader. */
  title: string;
  /** Optionaler Erklärtext direkt unter der Überschrift. */
  description?: string;
  /** Aktionsleiste am unteren Rand (rechtsbündig). */
  footer?: ReactNode;
  /** Gefahrenkontext – färbt die Überschrift. */
  tone?: 'default' | 'danger';
  /** Hintergrundklick schließt den Dialog (Standard: ja). */
  closeOnBackdrop?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Basis-Dialog des Design-Systems.
 *
 * Verhalten: Escape schließt, Klick auf den Hintergrund schließt, der Fokus
 * springt beim Öffnen in den Dialog und der Seiteninhalt darunter scrollt nicht
 * mit. Für die drei häufigen Fälle gibt es fertige Aufsätze – `ConfirmDialog`,
 * `DangerConfirmDialog` und `FormModal` – die hier drauf aufbauen.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  tone = 'default',
  closeOnBackdrop = true,
  className,
  children,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-up items-end justify-center bg-black/60 p-0 backdrop-blur-[3px] sm:items-center sm:p-5"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'max-h-[86vh] w-full max-w-[520px] animate-materialize overflow-y-auto rounded-t-2xl bg-surface shadow-modal outline-none sm:rounded-2xl',
          className,
        )}
      >
        <div className="flex items-start gap-3 p-6 pb-0">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className={cn('text-xl font-bold', tone === 'danger' && 'text-danger')}
            >
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-2 text-base text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dialog schließen"
            className="-mr-1 shrink-0 rounded p-1 text-ink-muted hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {children ? <div className="px-6 pt-4">{children}</div> : null}

        {footer ? (
          <div className="flex flex-wrap justify-end gap-2.5 p-6 pt-5.5">{footer}</div>
        ) : (
          <div className="pb-6" />
        )}
      </div>
    </div>
  );
}
