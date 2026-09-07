import {
  AUTH_METHOD_TYPES,
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

/**
 * Beschriftung zu einem Wert aus der Query (`/profil?linked=discord`).
 *
 * `null` für alles, was nicht im Katalog steht (Fundpunkt frontend-lib-11).
 * Der Wert stammt aus der Adresszeile und damit von jedem, der einen Link
 * verschicken kann; bisher wanderte er über einen ungeprüften Cast als Freitext
 * in einen grünen Erfolgs-Toast („… wurde verknüpft.") – React maskiert zwar,
 * aber die eigene Oberfläche sprach damit fremde Sätze aus (Content-Spoofing).
 * Kein Rückfall auf den Rohwert: Wer keinen bekannten Anbieter nennt, bekommt
 * gar keine Meldung.
 */
export function authMethodLabel(value: string | null | undefined): string | null {
  return isAuthMethodType(value) ? AUTH_METHOD_LABEL[value] : null;
}

/**
 * Gehört der Wert zu den vier Verfahren aus dem Vertrag?
 *
 * Geprüft wird gegen `AUTH_METHOD_TYPES` aus `@palantir/contracts`, nicht gegen
 * die Schlüssel der Beschriftungstabelle: Ein `in`-Test liefe über die
 * Prototypkette und hielte `toString` für ein Anmeldeverfahren.
 */
export function isAuthMethodType(value: unknown): value is AuthMethodType {
  return AUTH_METHOD_TYPES.some((type) => type === value);
}

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
