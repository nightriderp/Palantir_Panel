/**
 * Ersteinrichtung des Owner-Kontos (Lastenheft §2, Pflichtenheft §8 und §12.3).
 *
 * Der Owner steht **außerhalb** des Rollensystems und hat immer alle Rechte –
 * berechnet wird das an genau einer Stelle, in `buildPermissionActor()` aus B2.
 * Hier geht es allein darum, wie das Flag `User.isOwner` überhaupt an ein Konto
 * kommt: Ohne diesen Schritt hat auf einer frisch aufgesetzten Instanz niemand
 * die Rechte, den ersten Admin freizuschalten.
 *
 * ## Warum ein eigener Einrichtungsschritt statt „erstes Konto gewinnt"
 *
 * Drei Wege standen zur Wahl:
 *
 * 1. **Erstes registriertes Konto wird Owner.** Verworfen. Die Registrierung
 *    ist offen (Lastenheft §3.1) und das Panel steht ab dem ersten Start unter
 *    seiner öffentlichen Domain. Zwischen `docker compose up` und der eigenen
 *    Registrierung liegt ein Zeitfenster, in dem ein Fremder die Instanz
 *    übernehmen könnte – ohne Zugangsdaten, ohne Systemzugang, allein durch
 *    schnelleres Ausfüllen des Formulars. Ein Sicherheitsmerkmal, das von der
 *    Reihenfolge zweier HTTP-Requests abhängt, ist keines.
 * 2. **Owner-Konto in `db:seed` anlegen.** Verworfen. Der Seed-Lauf müsste dann
 *    ein Passwort kennen – entweder aus der `.env` (ein weiteres Geheimnis im
 *    Klartext, CLAUDE.md §2) oder als erzeugter Wert, den der Betreiber aus der
 *    Konsolenausgabe abschreibt. Außerdem entstünde ein zweiter Weg, ein Konto
 *    anzulegen, der an Registrierung, Passwortregeln und `AuthMethod` vorbeiläuft.
 * 3. **Einmaliger Einrichtungsschritt auf einem bestehenden Konto.** Gewählt.
 *
 * Der Betreiber registriert sich über die normale Oberfläche – mit denselben
 * Passwortregeln, demselben ALTCHA und derselben `AuthMethod` wie jeder andere.
 * Danach hebt er genau dieses Konto per Kommando auf der **VPS** zum Owner:
 *
 * ```
 * pnpm --filter @palantir/backend db:owner <benutzername>
 * ```
 *
 * Der Nachweis ist der Systemzugang zur VPS, nicht ein weiteres Geheimnis. Das
 * ist dasselbe Muster wie bei `db:migrate`, `db:seed` und `audit:archive`: ein
 * sichtbarer, nachvollziehbarer Schritt der Ersteinrichtung statt Automatik im
 * Hintergrund (Pflichtenheft §12.3, dokumentiert in SETUP.md §2.5).
 *
 * ## Genau ein Owner
 *
 * Die Zusicherung aus Lastenheft §2 hängt nicht an dieser Datei: Der partielle
 * Unique-Index `users_single_owner_idx` (`users(is_owner) WHERE is_owner`) lehnt
 * ein zweites Owner-Konto bereits beim Schreiben ab. Die Prüfung hier liefert
 * dem Betreiber lediglich den benannten Fehler `OWNER_ALREADY_EXISTS` statt
 * einer rohen Datenbankmeldung.
 *
 * Ein Gegenstück zum Entziehen gibt es bewusst nicht. Der Sonderstatus ist der
 * Schutz davor, dass sich niemand mehr anmelden kann; ein Wechsel des Owners
 * ist kein Vorgang der Version 1.
 */

import { AuthError } from './errors.js';
import type { AuthRepository, UserRecord } from './types.js';

export interface GrantOwnerResult {
  readonly user: UserRecord;
  /**
   * `false`, wenn das Konto den Status schon vorher trug.
   *
   * Der Lauf ist damit idempotent – ein zweiter Aufruf mit demselben Konto ist
   * kein Fehler, genau wie beim Seed-Lauf der Rollen.
   */
  readonly granted: boolean;
}

/**
 * Hebt ein vorhandenes Konto zum Owner.
 *
 * @throws AuthError `USER_NOT_FOUND`, wenn es die Anmeldekennung nicht gibt.
 * @throws AuthError `OWNER_ALREADY_EXISTS`, wenn ein **anderes** Konto den
 *   Status bereits trägt.
 */
export async function grantOwnerByUsername(
  repository: AuthRepository,
  username: string,
): Promise<GrantOwnerResult> {
  const user = await repository.findUserByUsername(username);

  if (!user) {
    throw new AuthError('USER_NOT_FOUND');
  }

  return grantOwner(repository, user);
}

/** Wie {@link grantOwnerByUsername}, aber auf einem bereits geladenen Konto. */
export async function grantOwner(
  repository: AuthRepository,
  user: UserRecord,
): Promise<GrantOwnerResult> {
  const existing = await repository.findOwner();

  if (existing) {
    if (existing.id === user.id) {
      return { user: existing, granted: false };
    }

    throw new AuthError(
      'OWNER_ALREADY_EXISTS',
      `Das Konto „${existing.displayName}" trägt den Owner-Status bereits. Genau ein Konto kann ihn tragen (Lastenheft §2).`,
    );
  }

  return { user: await repository.setOwner(user.id), granted: true };
}
