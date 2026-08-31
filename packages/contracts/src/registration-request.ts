/**
 * Freischalt-Warteliste („Anfragen", Lastenheft §3.1 und §3.7).
 *
 * Jedes neu registrierte Konto bekommt automatisch die geschützte Systemrolle
 * „Gast" und hat bis zur Freischaltung keinerlei Zugriff (Pflichtenheft §7).
 * Die Warteliste zeigt genau diese Konten – zusammen mit den verfügbaren
 * Profilinformationen der verknüpften Login-Methoden, damit der Admin die
 * Person wiedererkennt.
 *
 * **Abgrenzung zu B1:** Die Registrierung selbst, die Login-Methoden
 * (`AuthMethod`) und das Abrufen der Profildaten beim Provider gehören zu B1
 * (Auth & Identity). B8 liefert ausschließlich die Admin-Sicht darauf und die
 * beiden Aktionen „freigeben" und „sperren".
 */

import { type ResourceQuotaSlot } from './resources.js';

/** Provider einer verknüpften Login-Methode (Pflichtenheft §6, `AuthMethod.type`). */
export type LinkedAccountProvider = 'password' | 'discord' | 'steam' | 'twitch';

export const LINKED_ACCOUNT_PROVIDERS = [
  'password',
  'discord',
  'steam',
  'twitch',
] as const satisfies readonly LinkedAccountProvider[];

export function isLinkedAccountProvider(value: string): value is LinkedAccountProvider {
  return (LINKED_ACCOUNT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Profilinformationen einer verknüpften Login-Methode (Lastenheft §3.1).
 *
 * Genannt sind dort Discord-Tag und -Avatar, Steam-Profilname und Twitch-Name.
 * Alle Felder sind einzeln `null`-bar: welche Angaben vorliegen, hängt vom
 * Provider und den minimalen OAuth-Scopes ab (Pflichtenheft §7). Bei
 * `password` gibt es naturgemäß kein Fremdprofil.
 */
export interface LinkedAccountProfileDto {
  provider: LinkedAccountProvider;
  /** Anzeigename beim Provider (Discord-Tag, Steam-Profilname, Twitch-Name). */
  displayName: string | null;
  avatarUrl: string | null;
  /** Profilseite beim Provider, sofern bekannt. */
  profileUrl: string | null;
  /** Zeitpunkt der Verknüpfung als ISO-8601. */
  linkedAt: string;
}

/**
 * Zustand eines Kontos in der Warteliste.
 *
 * - `pending` – wartet auf Entscheidung (nur Gast-Rolle, nicht gesperrt)
 * - `approved` – freigegeben, hat mindestens eine weitere Rolle
 * - `blocked` – gesperrt (`User.banned`)
 */
export type RegistrationRequestStatus = 'pending' | 'approved' | 'blocked';

export const REGISTRATION_REQUEST_STATUSES = [
  'pending',
  'approved',
  'blocked',
] as const satisfies readonly RegistrationRequestStatus[];

export function isRegistrationRequestStatus(value: string): value is RegistrationRequestStatus {
  return (REGISTRATION_REQUEST_STATUSES as readonly string[]).includes(value);
}

/** `permissions`-Objekt eines Wartelisten-Eintrags (Pflichtenheft §5.2). */
export interface RegistrationRequestPermissions {
  canView: boolean;
  /** Freigeben. `false`, wenn das Konto bereits freigegeben oder gesperrt ist. */
  canApprove: boolean;
  /** Sperren. `false` beim Owner-Konto und bei bereits gesperrten Konten. */
  canBlock: boolean;
  /** Sperre wieder aufheben. Nur bei gesperrten Konten `true`. */
  canUnblock: boolean;
}

/** Eintrag der Freischalt-Warteliste (Lastenheft §3.7). */
/**
 * Kurzfassung des Kontingents für die Nutzerliste (Mockup-Abgleich 12.1.3).
 *
 * Der Entwurf zeigt in der Nutzerliste eine Spalte „Kontingent" mit
 * Arbeitsspeicher und Serveranzahl (`4 GB / 8 GB · 1 / 3`). Genau diese beiden
 * Werte stehen hier – nicht das vollständige {@link ResourceQuotaDto}: Eine
 * Liste braucht keinen Rechteblock je Zeile und keine CPU- und Plattenwerte,
 * die dort ohnehin nicht hinpassen. Wer alles sehen oder ändern will, öffnet
 * das Kontingent des Nutzers (`/admin/users/:id/limits`).
 *
 * `limit: null` in einem Slot heißt „für diese Ressource gilt kein Limit".
 */
export interface RegistrationRequestQuota {
  /** Arbeitsspeicher der laufenden Server gegen die Grenze. */
  ram: ResourceQuotaSlot;
  /** Gleichzeitig laufende Server gegen die Grenze. */
  servers: ResourceQuotaSlot;
}

export interface RegistrationRequestDto {
  /** Id des wartenden Kontos – die Warteliste ist eine Sicht auf `User`, keine eigene Entität. */
  userId: string;
  displayName: string;
  status: RegistrationRequestStatus;
  banned: boolean;
  /** Verknüpfte Login-Methoden mit den verfügbaren Profilangaben. */
  profiles: LinkedAccountProfileDto[];
  /** Namen der aktuell zugewiesenen Rollen – bei `pending` nur „Gast". */
  roleNames: string[];
  /** Registrierungszeitpunkt als ISO-8601 (`User.createdAt`). */
  registeredAt: string;
  /**
   * Kontingent des Kontos für die Spalte „Kontingent" (Mockup-Abgleich 12.1.3).
   *
   * Optional, damit dieser Vertrag für sich stehen kann (CLAUDE.md §3): Ein
   * Konsument, der das Feld nicht kennt, bleibt gültig. `null` heißt „nicht
   * ermittelbar" – etwa, wenn die Belegung gerade nicht gelesen werden konnte;
   * ein Kontingent ohne jede Grenze ist dagegen ein Objekt mit `limit: null` in
   * beiden Slots.
   */
  quota?: RegistrationRequestQuota | null;
  permissions: RegistrationRequestPermissions;
}
