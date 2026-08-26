'use client';

import { type SubdomainAvailabilityDto } from '@palantir/contracts';
import { subdomainSchema } from '@palantir/validation';
import { useEffect, useState } from 'react';
import { checkSubdomain } from '@/lib/api/servers';
import { isAborted } from '@/lib/api/client';

/**
 * Verfügbarkeitsprüfung der Subdomain (Pflichtenheft §13).
 *
 * Gefragt wird erst, wenn das Format stimmt und der Nutzer kurz nichts mehr
 * tippt – sonst entstünde pro Tastendruck ein Request. Das Ergebnis ist eine
 * Vorschau; verbindlich prüft das Backend beim Anlegen erneut.
 */

/** Wartezeit nach dem letzten Tastendruck. */
const DEBOUNCE_MS = 400;

export interface SubdomainCheck {
  result: SubdomainAvailabilityDto | null;
  checking: boolean;
  /** Formatfehler aus dem gemeinsamen Schema; `null`, wenn die Form passt. */
  formatError: string | null;
}

export function useSubdomainCheck(subdomain: string): SubdomainCheck {
  const [result, setResult] = useState<SubdomainAvailabilityDto | null>(null);
  const [checking, setChecking] = useState(false);

  const parsed = subdomainSchema.safeParse(subdomain);
  const formatError = parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? 'Diese Subdomain ist nicht erlaubt.');
  const normalized = parsed.success ? parsed.data : null;

  useEffect(() => {
    if (normalized === null) {
      setResult(null);
      setChecking(false);
      return;
    }

    const controller = new AbortController();
    setChecking(true);

    const timer = setTimeout(() => {
      void checkSubdomain(normalized, controller.signal).then((response) => {
        if (controller.signal.aborted || isAborted(response)) return;

        setChecking(false);
        if (response.success) {
          setResult(response.data);
          return;
        }

        // Auch eine Fehlerantwort ist eine Aussage: das Backend meldet über
        // SUBDOMAIN_TAKEN / SUBDOMAIN_INVALID, warum es nicht geht.
        setResult({
          subdomain: normalized,
          available: false,
          reason: response.error.code === 'SUBDOMAIN_TAKEN' ? 'taken' : 'invalid',
          message: response.error.message,
          fullHostname: '',
        });
      });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setChecking(false);
    };
  }, [normalized]);

  return { result, checking, formatError };
}
