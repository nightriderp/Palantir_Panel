'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
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
  /**
   * Läuft die bestätigte Aktion noch? Dann schließt der Dialog weder über
   * Escape noch über den Hintergrund noch über das Kreuz
   * (Audit-Fundstelle frontend-lib-08).
   *
   * Vorher sperrten die Aufsätze nur ihre Schaltflächen: Der Dialog verschwand
   * mitten in der laufenden Aktion, und die Rückmeldung kam später aus dem
   * Nichts. Wer `busy` reicht, hält den Dialog stehen, bis die Aktion antwortet.
   */
  busy?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Auswahl für „was kann den Fokus bekommen".
 *
 * Bewusst ohne Sichtbarkeitsprüfung über `offsetParent`: Im Test-DOM (jsdom)
 * hat kein Element eine Ausdehnung, dort fiele die Prüfung immer negativ aus
 * und der Fokusfang wäre genau da nicht prüfbar, wo er beschrieben ist.
 * Ausgeblendetes fängt stattdessen `[hidden]` und `aria-hidden` ab.
 */
const FOKUSSIERBAR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

function fokussierbareIn(wurzel: HTMLElement): HTMLElement[] {
  return [...wurzel.querySelectorAll<HTMLElement>(FOKUSSIERBAR)].filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Basis-Dialog des Design-Systems.
 *
 * Verhalten: Escape schließt, Klick auf den Hintergrund schließt, der Fokus
 * springt beim Öffnen in den Dialog und der Seiteninhalt darunter scrollt nicht
 * mit. Für die drei häufigen Fälle gibt es fertige Aufsätze – `ConfirmDialog`,
 * `DangerConfirmDialog` und `FormModal` – die hier drauf aufbauen.
 *
 * Beides – Escape und Hintergrund – ist gesperrt, solange `busy` gesetzt ist.
 *
 * **Fokus bleibt im Dialog** (Fundpunkt 215): Tab und Umschalt+Tab laufen im
 * Kreis durch die Bedienelemente des Dialogs, statt hinter ihm in die Seite zu
 * wandern – dort ließ sich vorher mit der Tastatur alles bedienen, was der
 * Dialog gerade verdeckt. Beim Schließen bekommt das Element den Fokus zurück,
 * das ihn beim Öffnen hatte; sonst landete er wieder am Seitenanfang.
 *
 * Der Rest der Seite wird bewusst **nicht** `inert` gesetzt: Der Dialog steckt
 * im React-Baum seines Aufrufers (kein Portal), er hätte also seinen eigenen
 * Vorfahren stillzulegen. Für Vorlesehilfen sagt `aria-modal="true"` dasselbe.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  tone = 'default',
  closeOnBackdrop = true,
  busy = false,
  className,
  children,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Lag der Beginn des Klicks (`mousedown`) auf dem Hintergrund?
   *
   * Nur dann darf das Loslassen schließen. Wer im Dialog Text markiert und die
   * Maus außerhalb loslässt, erzeugt sonst ein `click` am gemeinsamen Vorfahren
   * – dem Hintergrund – und verliert seine Eingaben (frontend-lib-08).
   */
  const pressStartedOnBackdrop = useRef(false);

  /** Wohin der Fokus zurückgeht, wenn der Dialog schließt (Fundpunkt 215). */
  const fokusVorher = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (busy) return;
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (dialog === null) return;

      const elemente = fokussierbareIn(dialog);
      const aktiv = document.activeElement;

      // Ein Dialog ohne Bedienelemente: Der Fokus bleibt trotzdem drin.
      if (elemente.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const erstes = elemente[0] as HTMLElement;
      const letztes = elemente[elemente.length - 1] as HTMLElement;
      const drinnen = aktiv instanceof Node && dialog.contains(aktiv);

      if (event.shiftKey && (!drinnen || aktiv === erstes || aktiv === dialog)) {
        event.preventDefault();
        letztes.focus();
        return;
      }

      if (!event.shiftKey && (!drinnen || aktiv === letztes)) {
        event.preventDefault();
        erstes.focus();
      }
    },
    [busy, onClose],
  );

  useEffect(() => {
    if (!open) return;
    fokusVorher.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;

      // Nur zurückgeben, wenn es das Element noch gibt: Ein Dialog, der die
      // Zeile löscht, aus der er geöffnet wurde, hat kein Ziel mehr.
      const zurueck = fokusVorher.current;
      fokusVorher.current = null;
      if (zurueck !== null && zurueck.isConnected) zurueck.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  function handleBackdropMouseDown(event: ReactMouseEvent<HTMLDivElement>): void {
    pressStartedOnBackdrop.current = event.target === event.currentTarget;
  }

  function handleBackdropMouseUp(event: ReactMouseEvent<HTMLDivElement>): void {
    const startedAndEndedOnBackdrop =
      pressStartedOnBackdrop.current && event.target === event.currentTarget;
    pressStartedOnBackdrop.current = false;
    if (!startedAndEndedOnBackdrop) return;
    if (!closeOnBackdrop || busy) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-up items-end justify-center bg-black/60 p-0 backdrop-blur-[3px] sm:items-center sm:p-5"
      // Geschlossen wird erst beim Loslassen – und nur, wenn schon das Drücken
      // auf dem Hintergrund lag (frontend-lib-08).
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        // Der Dialog steckt im React-Baum seines Aufrufers (kein Portal): ohne
        // das hier liefe jeder Klick im Dialog zusätzlich in dessen Karten- oder
        // Zeilen-Handler.
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
            disabled={busy}
            aria-label="Dialog schließen"
            className="-mr-1 shrink-0 rounded p-1 text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:text-ink-disabled"
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
