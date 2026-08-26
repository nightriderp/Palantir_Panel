'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon, cn } from '@/components/shared';
import { encodeAltchaSolution, solveAltchaChallenge } from '@/lib/auth/altcha';
import { fetchAltchaChallenge } from '@/lib/auth/api';
import { messageForThrown } from '@/lib/auth/errors';

/**
 * Selbstgehostetes Proof-of-Work-CAPTCHA (Pflichtenheft §3, Lastenheft §3.1).
 *
 * Der Ablauf ist bewusst ohne Nutzerinteraktion: Sobald das Formular sichtbar
 * ist, holt das Widget eine signierte Aufgabe vom Backend und löst sie im
 * Hintergrund. Wer registriert, sieht nur eine Fortschrittszeile – kein
 * Bilderraten, kein Fremdanbieter.
 *
 * Die Lösung geht als ein einziges Feld an die Registrierung; das Formular
 * bekommt sie über `onSolved`.
 */

export type AltchaStatus = 'idle' | 'loading' | 'solving' | 'solved' | 'error';

export interface AltchaWidgetProps {
  /** Liefert die kodierte Lösung – `null`, solange keine vorliegt. */
  onSolved: (payload: string | null) => void;
  className?: string;
}

const STATUS_LABEL: Record<AltchaStatus, string> = {
  idle: 'Sicherheitsprüfung wird vorbereitet …',
  loading: 'Sicherheitsprüfung wird geladen …',
  solving: 'Sicherheitsprüfung läuft …',
  solved: 'Sicherheitsprüfung bestanden.',
  error: 'Sicherheitsprüfung fehlgeschlagen.',
};

export function AltchaWidget({ onSolved, className }: AltchaWidgetProps) {
  const [status, setStatus] = useState<AltchaStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // `onSolved` als Referenz halten: sonst würde jede neue Funktionsinstanz aus
  // dem Elternteil eine neue Challenge auslösen.
  const onSolvedRef = useRef(onSolved);
  useEffect(() => {
    onSolvedRef.current = onSolved;
  }, [onSolved]);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function run() {
      setError(null);
      setProgress(0);
      setStatus('loading');
      onSolvedRef.current(null);

      try {
        const challenge = await fetchAltchaChallenge();
        if (!active) {
          return;
        }

        setStatus('solving');
        const result = await solveAltchaChallenge(challenge, {
          signal: controller.signal,
          onProgress: (value) => {
            if (active) {
              setProgress(value);
            }
          },
        });
        if (!active) {
          return;
        }

        onSolvedRef.current(encodeAltchaSolution(challenge, result));
        setProgress(1);
        setStatus('solved');
      } catch (thrown) {
        if (!active || controller.signal.aborted) {
          return;
        }
        onSolvedRef.current(null);
        setError(messageForThrown(thrown));
        setStatus('error');
      }
    }

    void run();

    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const busy = status === 'idle' || status === 'loading' || status === 'solving';

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2.5',
        status === 'solved' && 'border-success-line bg-success-soft',
        status === 'error' && 'border-danger-line bg-danger-soft',
        busy && 'border-line-strong bg-fill',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <Icon
          name={status === 'solved' ? 'check' : status === 'error' ? 'warning' : 'shield'}
          size={14}
          className={cn(
            'shrink-0',
            status === 'solved' && 'text-success',
            status === 'error' && 'text-danger',
            busy && 'text-ink-muted',
          )}
        />
        <span
          className={cn(
            'flex-1',
            status === 'solved' && 'text-success',
            status === 'error' && 'text-danger',
            busy && 'text-ink-muted',
          )}
          // Der Zustand wechselt ohne Zutun; Screenreader sollen ihn mitbekommen,
          // aber nicht mitten im Tippen unterbrochen werden.
          aria-live="polite"
        >
          {error ?? STATUS_LABEL[status]}
        </span>
        {status === 'error' ? (
          <button
            type="button"
            onClick={retry}
            className="shrink-0 text-sm font-semibold text-brand hover:text-brand-bright"
          >
            Erneut versuchen
          </button>
        ) : null}
      </div>

      {status === 'solving' ? (
        <div className="mt-2 h-1 overflow-hidden rounded-sm bg-fill-strong">
          <div
            className="h-full rounded-sm bg-brand-gradient transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
