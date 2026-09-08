/**
 * Die Node am Backup-Datensatz gegen ein laufendes PostgreSQL (Fundpunkt 174).
 *
 * Der Punkt der ganzen Änderung ist eine **Löschregel**, und Löschregeln stehen
 * in der Datenbank, nicht im Service: Ein Backup soll seinen Server überleben
 * (`server_id ON DELETE SET NULL`) – und dabei die Node behalten, auf der sein
 * Archiv liegt. Ein Testdouble könnte das nur nachspielen; hier steht, was
 * PostgreSQL tatsächlich tut.
 *
 * Geprüft wird:
 *
 * - Eine neu angelegte Sicherung trägt die Node ihres Servers.
 * - Das Löschen des Servers lässt `host_id` stehen (der eigentliche Punkt).
 * - Das Ausmustern der Node löscht die Sicherung **nicht**, sondern leert nur
 *   `host_id` – der Datensatz ist die einzige Spur, dass es das Archiv gab.
 * - `host_id` zeigt wirklich auf `host_nodes`; eine erfundene Kennung wird
 *   abgewiesen.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1` (siehe
 * `test-support/db.ts`); ohne Freigabe meldet der Harness die Suite als
 * übersprungen.
 */

import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { backups } from '../../db/schema/backups.js';
import { gameServers } from '../../db/schema/server-orchestration.js';
import { hostNodes } from '../../db/schema/resources.js';
import { legeNodeAn, legeNutzerAn, legeServerAn } from '../../test-support/fixtures.js';
import { describeDatenbank } from '../../test-support/db.js';
import { createDrizzleBackupRepository } from './repository.js';

describeDatenbank('Node am Backup-Datensatz (Fundpunkt 174)', (kontext) => {
  /** Konto, Node und Server – die Ausgangslage jeder Prüfung hier. */
  async function ausgangslage(): Promise<{ nodeId: string; serverId: string; backupId: string }> {
    const nutzerId = await legeNutzerAn(kontext.db);
    const nodeId = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, { ownerId: nutzerId, hostId: nodeId });

    const backup = await createDrizzleBackupRepository(kontext.db).create({
      serverId,
      hostId: nodeId,
      ownerId: nutzerId,
      type: 'manual',
      isExport: false,
      createdByUserId: null,
      scheduleId: null,
    });

    return { nodeId, serverId, backupId: backup.id };
  }

  async function zeile(
    backupId: string,
  ): Promise<{ serverId: string | null; hostId: string | null } | undefined> {
    const [row] = await kontext.db
      .select({ serverId: backups.serverId, hostId: backups.hostId })
      .from(backups)
      .where(eq(backups.id, backupId));

    return row;
  }

  it('schreibt die Node des Servers an den neuen Datensatz', async () => {
    const { nodeId, backupId } = await ausgangslage();

    expect((await zeile(backupId))?.hostId).toBe(nodeId);
  });

  it('nimmt die Node des jeweiligen Servers – nicht die erstbeste', async () => {
    // Mit einer Node belegte das nichts: Jeder Weg endete dort.
    const nutzerId = await legeNutzerAn(kontext.db);
    const ersteNode = await legeNodeAn(kontext.db);
    const zweiteNode = await legeNodeAn(kontext.db);
    const repository = createDrizzleBackupRepository(kontext.db);

    const gemeinsam = { ownerId: nutzerId, type: 'manual' as const, isExport: false };
    const hier = await repository.create({
      ...gemeinsam,
      serverId: await legeServerAn(kontext.db, { ownerId: nutzerId, hostId: ersteNode }),
      hostId: ersteNode,
      createdByUserId: null,
      scheduleId: null,
    });
    const dort = await repository.create({
      ...gemeinsam,
      serverId: await legeServerAn(kontext.db, { ownerId: nutzerId, hostId: zweiteNode }),
      hostId: zweiteNode,
      createdByUserId: null,
      scheduleId: null,
    });

    expect((await zeile(hier.id))?.hostId).toBe(ersteNode);
    expect((await zeile(dort.id))?.hostId).toBe(zweiteNode);
  });

  it('lässt die Node stehen, wenn der Server gelöscht wird – das ist der ganze Punkt', async () => {
    const { nodeId, serverId, backupId } = await ausgangslage();

    await kontext.db.delete(gameServers).where(eq(gameServers.id, serverId));

    const nachher = await zeile(backupId);

    // `server_id` geht auf NULL (ein Backup überlebt seinen Server) …
    expect(nachher?.serverId).toBeNull();
    // … und genau deshalb muss die Node am Datensatz bleiben: Über den Server
    // wäre sie jetzt nicht mehr auffindbar.
    expect(nachher?.hostId).toBe(nodeId);
  });

  it('löscht die Sicherung nicht mit, wenn die Node ausgemustert wird', async () => {
    const { nodeId, serverId, backupId } = await ausgangslage();

    // `game_servers.host_id` steht auf RESTRICT – eine Node lässt sich erst
    // ausmustern, wenn keine Server mehr auf ihr stehen.
    await kontext.db.delete(gameServers).where(eq(gameServers.id, serverId));
    await kontext.db.delete(hostNodes).where(eq(hostNodes.id, nodeId));

    const nachher = await zeile(backupId);

    // Kein CASCADE: Der Datensatz ist die einzige Spur, dass es das Archiv gab
    // (Größe, Besitzer, Ablageort) – und trägt den Speicherverbrauch des Kontos.
    expect(nachher).toBeDefined();
    // Kein RESTRICT: Das Ausmustern gelingt; die Node ist danach „unbekannt“,
    // und das Gateway fällt sichtbar auf `defaultHost()` zurück.
    expect(nachher?.hostId).toBeNull();
  });

  it('weist eine Node zurück, die es nicht gibt', async () => {
    const nutzerId = await legeNutzerAn(kontext.db);
    const nodeId = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, { ownerId: nutzerId, hostId: nodeId });

    // Belegt, dass die Spalte wirklich ein Fremdschlüssel auf `host_nodes` ist
    // und nicht bloß eine uuid-Spalte, in der irgendetwas stehen darf.
    await expect(
      createDrizzleBackupRepository(kontext.db).create({
        serverId,
        hostId: '00000000-0000-4000-8000-000000000000',
        ownerId: nutzerId,
        type: 'manual',
        isExport: false,
        createdByUserId: null,
        scheduleId: null,
      }),
    ).rejects.toThrow();
  });
});
