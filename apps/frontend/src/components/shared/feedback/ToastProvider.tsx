'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { TONE_TEXT_CLASSES, type Tone } from '../primitives/Badge';
import { cn } from '../utils/cn';

/** Art der Einblendung – bestimmt Farbe und Symbol. */
export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  variant?: ToastVariant;
  /**
   * Anzeigedauer in Millisekunden; `0` heißt „bleibt stehen, bis jemand sie
   * wegklickt".
   *
   * Ohne Angabe entscheidet die Art der Meldung (Fundpunkt 220, siehe
   * {@link VARIANT_DURATION_MS}).
   */
  durationMs?: number;
}

export interface Toast extends Required<ToastOptions> {
  id: string;
  message: string;
}

const VARIANT_TONE: Record<ToastVariant, Tone> = {
  info: 'brand',
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

const VARIANT_ICON: Record<ToastVariant, IconName> = {
  info: 'bell',
  success: 'check',
  warning: 'warning',
  error: 'warning',
};

export interface ToastApi {
  /** Blendet eine Meldung ein und liefert deren Id zurück. */
  show: (message: string, options?: ToastOptions) => string;
  success: (message: string, options?: ToastOptions) => string;
  warning: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  /** Blendet eine Meldung vorzeitig aus. */
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Anzeigedauer je Art der Meldung (Fundpunkt 220).
 *
 * Am laufenden System gemessen: Ein Klick auf „Starten" bei nicht verbundener
 * Node beantwortete das Backend mit `503 AGENT_NOT_CONNECTED`; der Satz „Der
 * Homeserver ist derzeit nicht verbunden." war nach **2,8 Sekunden** wieder
 * weg. Wer während des Klicks kurz wegsah, sah nur, dass nichts passiert ist.
 *
 * Für eine Erfolgsmeldung sind 2,6 Sekunden richtig – sie bestätigt etwas, das
 * ohnehin auf dem Bildschirm passiert. Eine **Fehlermeldung** ist die einzige
 * Stelle, an der die Begründung steht; sie bleibt deshalb stehen, bis jemand
 * sie wegklickt. Eine Warnung liegt dazwischen.
 */
const VARIANT_DURATION_MS: Record<ToastVariant, number> = {
  info: 2600,
  success: 2600,
  warning: 8000,
  error: 0,
};

/**
 * Stellt die Toast-Funktion für den gesamten eingeloggten Bereich bereit.
 *
 * Gehört einmal weit oben in den Baum (Dashboard-Layout). Die Einblendungen
 * selbst rendert dieser Provider gleich mit, ein separater Viewport ist nicht
 * nötig.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      const variant = options?.variant ?? 'info';
      const toast: Toast = {
        id,
        message,
        variant,
        durationMs: options?.durationMs ?? VARIANT_DURATION_MS[variant],
      };
      setToasts((current) => [...current, toast]);

      // `0` heißt „bleibt stehen": kein Zeitgeber, nur der Schließen-Knopf.
      if (toast.durationMs > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), toast.durationMs),
        );
      }

      return id;
    },
    [dismiss],
  );

  // Beim Unmount alle offenen Zeitgeber aufräumen.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, options) => show(message, { ...options, variant: 'success' }),
      warning: (message, options) => show(message, { ...options, variant: 'warning' }),
      error: (message, options) => show(message, { ...options, variant: 'error' }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Zugriff auf die Toast-Funktion.
 *
 * Wirft bewusst, wenn kein `ToastProvider` darüber liegt – ein stillschweigend
 * verschluckter Hinweis wäre schlimmer als ein Fehler in der Entwicklung.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error('useToast benötigt einen <ToastProvider> weiter oben im Komponentenbaum.');
  }
  return api;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      // `polite`, damit Screenreader die Meldung vorlesen, ohne die aktuelle
      // Eingabe zu unterbrechen.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-2.5 rounded-md border border-line-strong bg-surface px-4 py-3 text-base text-ink shadow-panel"
        >
          <Icon
            name={VARIANT_ICON[toast.variant]}
            size={14}
            className={cn('mt-0.5', TONE_TEXT_CLASSES[VARIANT_TONE[toast.variant]])}
          />
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Meldung ausblenden"
            className="shrink-0 text-ink-faint hover:text-ink"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
