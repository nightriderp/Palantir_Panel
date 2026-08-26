import { env } from '../config/env.js';
import { createDrizzleRoleRepository, seedRoles } from '../modules/rbac/index.js';
import { seedDefaultHostNode } from '../modules/server-orchestration/seed.js';
import { closeDb, getDb } from './client.js';

/**
 * Legt die Rollen der Ersteinrichtung an
 * (`pnpm --filter @palantir/backend db:seed`).
 *
 * Gehört in die Ersteinrichtung einer Instanz (Pflichtenheft §8 und §12.3),
 * direkt nach `db:migrate`. Der Lauf ist idempotent: bereits vorhandene Rollen
 * bleiben unangetastet – auch dann, wenn der Betreiber sie inzwischen umgebaut
 * hat. Ein erneuter Aufruf legt lediglich fehlende Rollen wieder an und stellt
 * damit sicher, dass die geschützte Systemrolle „Gast" nie dauerhaft fehlt.
 *
 * Bewusst ein eigenes Kommando statt eines Aufrufs beim Backend-Start: der
 * Zeitpunkt bleibt so für den Betreiber sichtbar und nachvollziehbar, genau wie
 * bei den Migrationen.
 *
 * Das Skript läuft über `tsx` direkt gegen `src/`, damit es unabhängig vom
 * Build-Ergebnis auch beim allerersten Deployment funktioniert.
 */
async function main(): Promise<void> {
  const db = getDb();
  const result = await seedRoles(createDrizzleRoleRepository(db));

  if (result.created.length > 0) {
    console.log(`Angelegte Rollen: ${result.created.join(', ')}`);
  }

  if (result.existing.length > 0) {
    console.log(`Bereits vorhanden (unverändert): ${result.existing.join(', ')}`);
  }

  console.log('Seed-Rollen sind vollständig.');

  // Node der Server-Orchestrierung (B3, Pflichtenheft §2.1 und §6). Ohne sie
  // lässt sich weder ein Server anlegen noch eine Agent-Verbindung zuordnen.
  const node = await seedDefaultHostNode(db, { wireguardIp: env.WIREGUARD_HOME_IP });

  console.log(
    node.created
      ? `Node angelegt: ${node.id} (${env.WIREGUARD_HOME_IP})`
      : `Node bereits vorhanden (unverändert): ${node.id}`,
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error('Ersteinrichtung fehlgeschlagen:', error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
