/**
 * Profilangaben der verknüpften Login-Methoden für die Freischalt-Warteliste
 * (Lastenheft §3.1, R1 – Gefundener Punkt 39).
 *
 * Die Warteliste zeigt neue Registrierungen „inkl. verfügbarer
 * Profilinformationen (Discord-Tag/Avatar, Steam-Profilname, Twitch-Name) zur
 * Wiedererkennung". Die Angaben stammen aus `auth_methods` – dort legt B1 sie
 * beim Login über einen Anbieter ab (`providerDisplayName`,
 * `providerAvatarUrl`, Pflichtenheft §7).
 *
 * Bewusst eine reine Abbildungsfunktion ohne Datenbank: So ist die Zuordnung
 * ohne laufendes PostgreSQL prüfbar (CLAUDE.md §4), und der Datenzugriff bleibt
 * in `repositories.ts`.
 */

import type { LinkedAccountProfileDto, LinkedAccountProvider } from '@palantir/contracts';

/** Eine Zeile aus `auth_methods`, soweit die Warteliste sie braucht. */
export interface LinkedMethodRow {
  readonly type: LinkedAccountProvider;
  readonly providerUserId: string | null;
  readonly providerDisplayName: string | null;
  readonly providerAvatarUrl: string | null;
  readonly createdAt: Date;
}

/**
 * Öffentliche Profilseite beim Anbieter, sofern sie sich verlässlich aus der
 * gespeicherten Kennung bilden lässt.
 *
 * Discord und Steam adressieren Profile über die **Id**, die B1 als
 * `providerUserId` speichert – die Links sind damit stabil, auch wenn der
 * Nutzer sich umbenennt.
 *
 * Für Twitch gibt es bewusst **keinen** Link: Die URL dort ist
 * `twitch.tv/<login>`, gespeichert wird aber `display_name` (Pflichtenheft §7,
 * minimale Scopes). Beides fällt in den meisten Fällen zusammen, aber eben
 * nicht immer – ein Link, der manchmal ins Leere zeigt, ist als
 * Wiedererkennungshilfe schlechter als gar keiner. Bei `password` gibt es
 * naturgemäß kein Fremdprofil.
 */
export function profileUrlFor(
  provider: LinkedAccountProvider,
  providerUserId: string | null,
): string | null {
  if (providerUserId === null) {
    return null;
  }

  switch (provider) {
    case 'discord':
      return `https://discord.com/users/${providerUserId}`;
    case 'steam':
      return `https://steamcommunity.com/profiles/${providerUserId}`;
    case 'twitch':
    case 'password':
      return null;
  }
}

/**
 * Bildet eine Zeile aus `auth_methods` auf den Vertrag ab.
 *
 * Der `password`-Eintrag bleibt bewusst in der Liste, mit lauter leeren
 * Angaben: Für den Admin ist die Information „dieses Konto hat auch ein
 * Passwort-Login" Teil des Bildes, und `LinkedAccountProvider` führt
 * `password` ausdrücklich als Wert.
 */
export function toLinkedAccountProfile(row: LinkedMethodRow): LinkedAccountProfileDto {
  return {
    provider: row.type,
    displayName: row.providerDisplayName,
    avatarUrl: row.providerAvatarUrl,
    profileUrl: profileUrlFor(row.type, row.providerUserId),
    linkedAt: row.createdAt.toISOString(),
  };
}
