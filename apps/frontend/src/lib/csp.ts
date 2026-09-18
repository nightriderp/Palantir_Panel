import { apiBaseUrl } from '@/lib/auth/api';

/**
 * Content-Security-Policy der Weboberfläche – **durchgesetzt**, mit Nonce
 * (Review 2026-09-16, Befunde 3.4 und 12.3).
 *
 * Bis hierher lief die vollständige Regel nur im Report-Only-Modus, weil
 * Next.js seine Hydrations-Skripte inline und ohne Nonce in die Seite hängt
 * und `script-src` deshalb `'unsafe-inline'` brauchte – womit die Regel gegen
 * eingeschleustes Skript nichts ausrichtete. Jetzt erzeugt `proxy.ts` für jede
 * Anfrage eine Nonce und setzt sie in diesen Header; Next.js liest sie aus
 * dem `Content-Security-Policy`-Kopf der Anfrage und hängt sie an jedes
 * eigene Skript. Ein Skript ohne die Nonce läuft nicht mehr.
 *
 * `'strict-dynamic'`: Skripte, die ein nonce-tragendes Skript nachlädt (die
 * Chunks von Next), gelten als vertraut – ohne die Klausel müsste jede
 * Chunk-Adresse einzeln erlaubt sein. `'self'` bleibt als Rückfall für
 * Browser, die `'strict-dynamic'` nicht kennen.
 *
 * `'unsafe-eval'` nur in der Entwicklung: React baut dort Fehler-Stacks per
 * `eval` nach; im Betrieb braucht es weder React noch Next.
 *
 * Stile bleiben bei `'unsafe-inline'`: `style`-Attribute und die von React
 * eingesetzten `<style>`-Elemente tragen keine Nonce, und ein eingeschleuster
 * Stil ist kein Skript. Der Befund galt `script-src`.
 *
 * Die übrigen Quellen entsprechen der bisher beobachteten Regel: Schriften und
 * das erzeugte Stylesheet kommen von der API-Herkunft (Fundpunkt 151),
 * Profilbilder von den CDNs der Anmelde-Anbieter (`https:`), der Live-Kanal
 * über WebSocket zur API.
 *
 * Eine Nonce setzt **dynamisches Rendern** voraus – statische Seiten entstehen
 * beim Bau, wo es keine Anfrage gibt. Deshalb `dynamic = 'force-dynamic'` im
 * Root-Layout (`app/layout.tsx`).
 */

export interface CspOptions {
  readonly nonce: string;
  /** Herkunft der API (Schriften, Stylesheet, XHR). */
  readonly apiUrl: string;
  /** Adresse des Live-Kanals (WebSocket). */
  readonly liveWsUrl: string;
  /** Entwicklung: `'unsafe-eval'` für React-Fehlerstacks und den Refresh. */
  readonly entwicklung: boolean;
}

/** Eine frische, unvorhersagbare Nonce – eine je Anfrage. */
export function erzeugeNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

/** Baut den Header-Wert. Reine Funktion, damit sie ohne Next-Laufzeit prüfbar ist. */
export function baueCsp({ nonce, apiUrl, liveWsUrl, entwicklung }: CspOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${entwicklung ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline' ${apiUrl}`,
    `font-src 'self' ${apiUrl} data:`,
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${apiUrl} ${liveWsUrl}`,
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Adresse des Live-Kanals – dieselbe Ableitung wie in `lib/live`: ausdrücklich
 * gesetzt, sonst die API-Adresse mit `ws://` bzw. `wss://`.
 */
export function liveWsUrlAusUmgebung(apiUrl: string): string {
  const gesetzt = process.env.NEXT_PUBLIC_LIVE_WS_URL;
  if (gesetzt !== undefined && gesetzt.length > 0) {
    return gesetzt.replace(/\/+$/, '');
  }

  return apiUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
}

/** Header-Wert für eine Anfrage – Umgebung aus dem Build, Nonce von außen. */
export function cspFuerAnfrage(nonce: string): string {
  const apiUrl = apiBaseUrl();

  return baueCsp({
    nonce,
    apiUrl,
    liveWsUrl: liveWsUrlAusUmgebung(apiUrl),
    entwicklung: process.env.NODE_ENV === 'development',
  });
}
