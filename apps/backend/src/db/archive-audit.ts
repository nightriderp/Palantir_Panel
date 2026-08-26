import { createDrizzleRoleRepository, createRoleService } from '../modules/rbac/index.js';
import { createAdminModule } from '../modules/admin/index.js';
import { env } from '../config/env.js';
import { closeDb, getDb } from './client.js';

/**
 * Archivierungslauf des Audit-Logs
 * (`pnpm --filter @palantir/backend audit:archive`).
 *
 * Exportiert alle Einträge, die älter als 24 Monate sind, in eine komprimierte
 * Archivdatei unter `AUDIT_ARCHIVE_DIR` und entfernt sie erst danach aus der
 * aktiven Tabelle (Pflichtenheft §6). Schlägt der Export fehl, bleibt die
 * Tabelle unverändert.
 *
 * Bewusst ein eigenes Kommando statt eines Hintergrundjobs im Backend – wie bei
 * `db:migrate` und `db:seed` bleibt der Zeitpunkt für den Betreiber sichtbar.
 * Wer den Lauf regelmäßig will, hängt ihn auf der **VPS** in einen Cronjob,
 * z. B. monatlich:
 *
 * ```
 * 0 4 1 * * cd /opt/palantir && pnpm --filter @palantir/backend audit:archive
 * ```
 */
async function main(): Promise<void> {
  if (!env.AUDIT_ARCHIVE_DIR) {
    throw new Error(
      'AUDIT_ARCHIVE_DIR ist nicht gesetzt. Bitte die zentrale .env im Repo-Root ausfüllen (siehe .env.example Abschnitt 13).',
    );
  }

  const db = getDb();
  const admin = createAdminModule({
    db,
    roles: createRoleService(createDrizzleRoleRepository(db)),
    auditArchiveDir: env.AUDIT_ARCHIVE_DIR,
  });

  const result = await admin.archiveAuditLog();

  if (result.archivedCount === 0) {
    console.log(
      `Keine Einträge älter als der Stichtag ${result.cutoff} – die aktive Tabelle bleibt unverändert.`,
    );

    return;
  }

  console.log(`Archivdatei geschrieben: ${result.archiveFilePath ?? '(keine)'}`);
  console.log(
    `${result.archivedCount} Einträge archiviert (${result.oldestTimestamp} bis ${result.newestTimestamp}) und aus der aktiven Tabelle entfernt.`,
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error('Archivierung des Audit-Logs fehlgeschlagen:', error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
