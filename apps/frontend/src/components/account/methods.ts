import {
  type AuthMethodType,
  type LinkedAuthMethod,
  OAUTH_PROVIDERS,
  type OAuthProvider,
} from '@palantir/contracts';

/**
 * Reine Hilfslogik rund um die verknüpften Anmeldeverfahren (Profil-Seite).
 *
 * Bewusst ohne React/DOM, damit die Regeln – welcher Anbieter ist noch frei,
 * hat das Konto ein Passwort – ohne gerendertes Bauteil prüfbar sind
 * (CLAUDE.md §4).
 */

/** Beschriftung je Verfahren für Anzeige und Vorlesbarkeit. */
export const AUTH_METHOD_LABEL: Record<AuthMethodType, string> = {
  password: 'Passwort',
  discord: 'Discord',
  twitch: 'Twitch',
  steam: 'Steam',
};

/** Ist das Passwort-Verfahren bereits mit dem Konto verknüpft? */
export function hasPassword(methods: readonly LinkedAuthMethod[]): boolean {
  return methods.some((method) => method.type === 'password');
}

/** Welche externen Anbieter sind noch nicht verknüpft und damit ergänzbar? */
export function linkableProviders(methods: readonly LinkedAuthMethod[]): OAuthProvider[] {
  const linked = new Set(methods.map((method) => method.type));
  return OAUTH_PROVIDERS.filter((provider) => !linked.has(provider));
}

/**
 * Anzeigezeile zu einem verknüpften Verfahren.
 *
 * `password` trägt keinen Provider-Namen; die externen Verfahren zeigen den
 * beim Anbieter hinterlegten Anzeigenamen, sofern vorhanden.
 */
export function methodDetail(method: LinkedAuthMethod): string | null {
  if (method.type === 'password') {
    return null;
  }
  return method.providerDisplayName;
}
