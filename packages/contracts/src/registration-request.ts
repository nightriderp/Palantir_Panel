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

import { AUTH_METHOD_TYPES, type AuthMethodType } from './auth.js';
import { type ResourceQuotaSlot } from './resources.js';

/**
 * Provider einer verknüpften Login-Methode (Pflichtenheft §6, `AuthMethod.type`).
 *
 * Bewusst ein Alias auf {@link AuthMethodType} statt einer zweiten Literalliste
 * (Audit-Fundstelle contracts-validation-11): Es ist dieselbe Spalte derselben
 * Entität, nur aus der Admin-Sicht betrachtet. Der Name bleibt erhalten, weil
 * er in der Warteliste die Lesbarkeit trägt – zwei Listen zu pflegen, die
 * stillschweigend auseinanderlaufen können, tut er nicht.
 */
export type LinkedAccountProvider = AuthMethodType;

/**
 * Anzeigereihenfolge der Provider – dieselbe Quelle wie {@link AUTH_METHOD_TYPES}.
 *
 * Kommt in `auth.ts` ein fünfter Provider dazu, kennt ihn die Warteliste ohne
 * weiteres Zutun.
 */
export const LINKED_ACCOUNT_PROVIDERS = AUTH_METHOD_TYPES;

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

/** Eine Rolle des Kontos mit Id und Name (Gefundener Punkt 90). */
export interface RegistrationRequestRole {
  id: string;
  name: string;
}

/** Eintrag der Freischalt-Warteliste (Lastenheft §3.7). */
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
  /**
   * Ist dieses Konto der Owner der Instanz? (Fundpunkt 221.)
   *
   * Der Owner steht ausserhalb des Rollensystems: Er traegt keine Rolle und
   * bekommt deshalb in `roleNames` die Standardrolle „Gast" zu sehen. In der
   * Nutzerliste las sich seine eigene Zeile damit wie ein Konto, das noch auf
   * seine Freischaltung wartet – ausgerechnet beim Betreiber.
   *
   * Optional, damit der Vertrag fuer sich stehen kann (CLAUDE.md §3): Fehlt das
   * Feld, zeigt die Oberflaeche die Rollen wie bisher.
   */
  isOwner?: boolean;
  /**
   * Dieselben Rollen **mit Id** (WORK_STATUS.md, Gefundener Punkt 90).
   *
   * `roleNames` bleibt für die reine Anzeige. Die Oberfläche musste die Namen
   * bisher über `/admin/roles` auf Ids zurückrechnen, um im Rollen-Dialog die
   * richtigen Häkchen zu setzen – das geht schief, sobald zwei Rollen denselben
   * Namen tragen oder eine umbenannt wird.
   *
   * Optional, damit der Vertrag für sich stehen kann (CLAUDE.md §3).
   */
  roles?: RegistrationRequestRole[];
  /**
   * Anzahl der Server, die dieses Konto besitzt (Gefundener Punkt 90).
   *
   * Die Oberfläche hat dafür bisher die ganze Serverliste geholt und im Browser
   * nach `ownerId` gefiltert – das zeigt nur, was der Aufrufer ohnehin sehen
   * darf, und lädt bei vielen Servern viel für eine einzige Zahl.
   */
  serverCount?: number;
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
