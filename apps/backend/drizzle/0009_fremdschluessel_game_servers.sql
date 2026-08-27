-- R3 – Datenbank-Integrität: Fremdschlüssel auf `game_servers` nachtragen.
--
-- `backups`, `schedules` und `port_allocations` verweisen fachlich auf einen
-- Gameserver, tragen aber keinen Fremdschlüssel, weil `game_servers` bei ihrer
-- Entstehung noch nicht existierte (WORK_STATUS.md, Gefundene Punkte 32 und 41).
--
-- Vor jedem `ADD CONSTRAINT` werden bereits vorhandene verwaiste Datensätze
-- aufgeräumt – genau so, wie die jeweilige Löschregel es getan hätte. Ohne das
-- scheitert die Migration an bestehenden Daten, und ein Fehlschlag im Betrieb
-- wäre schlimmer als keine Migration.

ALTER TABLE "backups" ALTER COLUMN "server_id" DROP NOT NULL;--> statement-breakpoint
-- Backups gelöschter Server: `server_id` auf NULL statt Löschen – ein Backup
-- soll seinen Server überleben (Lastenheft §3.3). `owner_id` bleibt erhalten und
-- trägt danach die `.own`/`.any`-Prüfung.
UPDATE "backups" SET "server_id" = NULL
WHERE "server_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "game_servers" WHERE "game_servers"."id" = "backups"."server_id");--> statement-breakpoint
-- Zeitpläne ohne Server haben keine Bedeutung – dieselbe Wirkung wie CASCADE.
DELETE FROM "schedules"
WHERE NOT EXISTS (SELECT 1 FROM "game_servers" WHERE "game_servers"."id" = "schedules"."server_id");--> statement-breakpoint
-- Verwaiste Port-Zuordnungen halten den Port dauerhaft belegt; bisher räumte nur
-- `releaseForServer()` auf. `server_id IS NULL` bleibt unangetastet.
DELETE FROM "port_allocations"
WHERE "server_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "game_servers" WHERE "game_servers"."id" = "port_allocations"."server_id");--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_allocations" ADD CONSTRAINT "port_allocations_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE cascade ON UPDATE no action;
