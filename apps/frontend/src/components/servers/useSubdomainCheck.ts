'use client';

import { type SubdomainAvailabilityDto, buildServerHostname } from '@palantir/contracts';
import { subdomainSchema } from '@palantir/validation';
import { useEffect, useState } from 'react';
import { checkSubdomain } from '@/lib/api/servers';
import { errorText, isAborted } from '@/lib/api/client';
import { BASE_DOMAIN } from '@/lib/api/session';

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
  // Hat die Anfrage für die aktuelle Subdomain geantwortet? Wird beim
  // Wechsel unten zurückgesetzt; `checking` ergibt sich daraus.
  const [beantwortet, setBeantwortet] = useState(false);

  const parsed = subdomainSchema.safeParse(subdomain);
  const formatError = parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? 'Diese Subdomain ist nicht erlaubt.');
  const normalized = parsed.success ? parsed.data : null;

  // Wechsel der Subdomain während des Renderns verbuchen statt in einem
  // Effekt: Das alte Ergebnis bleibt sichtbar, bis das neue da ist – nur
  // eine ungültige Form räumt es ab.
  const [vorherige, setVorherige] = useState(normalized);
  if (vorherige !== normalized) {
    setVorherige(normalized);
    setBeantwortet(false);
    if (normalized === null) setResult(null);
  }

  const checking = normalized !== null && !beantwortet;

  useEffect(() => {
    if (normalized === null) return;

    const controller = new AbortController();

    const timer = setTimeout(() => {
      void checkSubdomain(normalized, controller.signal).then((response) => {
        if (controller.signal.aborted || isAborted(response)) return;

        setBeantwortet(true);
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
          message: errorText(response),
          // Die Adresse bildet dieselbe Funktion wie im Backend – vorher stand
          // hier `''`, obwohl der Vertrag einen Hostnamen zusagt (Audit
          // contract-drift-04).
          fullHostname: buildServerHostname(normalized, BASE_DOMAIN),
        });
      });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalized]);

  return { result, checking, formatError };
}
