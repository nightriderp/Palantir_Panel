import { createDrizzleAuditLogRepository, createAuditService } from '../modules/admin/index.js';
import {
  createDrizzleAuthRepository,
  grantOwnerByUsername,
  isAuthError,
} from '../modules/auth/index.js';
import { closeDb, getDb } from './client.js';

/**
 * Ersteinrichtung des Owner-Kontos.
 *
 * Hebt ein **bereits registriertes** Konto zum Owner (Lastenheft §2,
 * Pflichtenheft §8 und §12.3). Ohne diesen Schritt hat auf einer frisch
 * aufgesetzten Instanz niemand die Rechte, den ersten Admin freizuschalten.
 *
 * Aufruf auf der **VPS** über den Compose-Dienst `owner`, aus
 * `/opt/palantir/deploy/vps` – dort gibt es weder Node noch pnpm, nur Docker:
 *
 * ```
 * docker compose --env-file ../../.env run --rm owner <benutzername>
 * ```
 *
 * Auf dem **Entwicklungsrechner** direkt im Repo-Root des geklonten
 * Repositories:
 *
 * ```
 * pnpm --filter @palantir/backend db:owner <benutzername>
 * ```
 *
 * Der Nachweis ist der Systemzugang zu dieser Maschine, nicht ein weiteres
 * Geheimnis; die Begründung für diesen Weg steht in `modules/auth/owner.ts`,
 * die Anleitung in SETUP.md §2.5.
 *
 * Bewusst ein eigenes Kommando statt Automatik beim Backend-Start – wie
 * `db:migrate`, `db:seed` und `audit:archive` bleibt der Zeitpunkt für den
 * Betreiber sichtbar.
 *
 * Der Lauf ist idempotent: Trägt das genannte Konto den Status schon, passiert
 * nichts. Trägt ihn ein **anderes** Konto, bricht der Lauf mit
 * `OWNER_ALREADY_EXISTS` ab – genau ein Konto kann ihn tragen.
 */
async function main(): Promise<void> {
  const username = process.argv[2]?.trim();

  if (!username) {
    throw new Error(
      'Es fehlt der Benutzername des Kontos, das den Owner-Status bekommen soll.\n' +
        'Auf der VPS:  docker compose --env-file ../../.env run --rm owner <benutzername>\n' +
        'Lokal:        pnpm --filter @palantir/backend db:owner <benutzername>',
    );
  }

  const db = getDb();
  const result = await grantOwnerByUsername(createDrizzleAuthRepository(db), username);

  if (!result.granted) {
    console.log(
      `Das Konto „${result.user.displayName}" trägt den Owner-Status bereits – unverändert.`,
    );

    return;
  }

  /*
   * Die Vergabe des Owner-Status gehört ins append-only Audit-Log
   * (Pflichtenheft §6). Ohne Handelnden: Der Aufruf kommt vom Kommando auf der
   * VPS, das bereits Systemzugang voraussetzt – dieselbe Begründung wie beim
   * Archivierungslauf.
   *
   * Bewusst **nach** der Vergabe: Scheitert das Schreiben des Eintrags, ist der
   * Owner trotzdem gesetzt und der Betreiber sieht den Fehler. Andersherum
   * stünde ein Eintrag über eine Vergabe im Log, die nie stattgefunden hat.
   */
  await createAuditService(createDrizzleAuditLogRepository(db)).record({
    action: 'user.ownerGranted',
    targetType: 'user',
    targetId: result.user.id,
    metadata: { username, displayName: result.user.displayName },
  });

  console.log(`Owner-Status vergeben an „${result.user.displayName}" (${result.user.id}).`);
  console.log('Das Konto hat ab sofort unabhängig vom Rollensystem alle Rechte (Lastenheft §2).');
}

try {
  await main();
} catch (error: unknown) {
  if (isAuthError(error)) {
    console.error(
      `Ersteinrichtung des Owner-Kontos fehlgeschlagen [${error.code}]:`,
      error.message,
    );
  } else {
    console.error('Ersteinrichtung des Owner-Kontos fehlgeschlagen:', error);
  }

  process.exitCode = 1;
} finally {
  await closeDb();
}
