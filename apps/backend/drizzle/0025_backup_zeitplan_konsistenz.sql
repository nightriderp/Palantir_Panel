-- W2-12 – Backup-Job und Zeitplan konsistent: Höchstens ein laufender
-- Panel-Abzug, zugesichert von der Datenbank (Audit bb-11).
--
-- Der Service prüfte das bisher nur über `findRunning()`; zwischen Prüfen und
-- Anlegen passt der Minuten-Takt oder ein zweiter Admin. Zwei `running`-Zeilen
-- bedeuteten zwei parallele `pg_dump`-Prozesse, bei gleicher Millisekunde sogar
-- auf denselben Zielpfad.
--
-- Vor dem Index werden bestehende Mehrfachläufe aufgeräumt: Ein Bestand mit
-- zwei `running`-Zeilen (aus genau diesem Rennen oder aus einem abgerissenen
-- Lauf, bb-04) ließe `CREATE UNIQUE INDEX` scheitern – ein Fehlschlag im
-- Betrieb wäre schlimmer als keine Migration. Der jüngste Lauf bleibt stehen;
-- ihn behandelt der Kehraus (`sweepOrphanedRun`) nach seiner Frist. Alle
-- älteren werden als unvollständig festgehalten, damit ihre Datei über die
-- Aufbewahrung wieder aufgeräumt wird.
UPDATE "panel_backups" SET
  "status" = 'failed',
  "failure_message" = 'Beim Einspielen der Migration 0025 stand noch ein weiterer Abzug auf „laufend“; dieser Lauf ist unvollständig.',
  "completed_at" = coalesce("completed_at", now())
WHERE "status" = 'running'
  AND "id" <> (
    SELECT "juengster"."id" FROM "panel_backups" AS "juengster"
    WHERE "juengster"."status" = 'running'
    ORDER BY "juengster"."started_at" DESC
    LIMIT 1
  );--> statement-breakpoint
CREATE UNIQUE INDEX "panel_backups_one_running_idx" ON "panel_backups" USING btree ("status") WHERE "panel_backups"."status" = 'running';
