-- Fundpunkt 174 – eine Sicherung weiß, auf welcher Node sie liegt.
--
-- `DOWNLOAD_BACKUP` und `DELETE_BACKUP` arbeiten nur auf einem Archivpfad und
-- kennen keinen Server mehr; ihre Node kam deshalb bisher aus `defaultHost()`.
-- Mit einer Node ist das folgenlos, ab der zweiten lädt das Panel die Sicherung
-- von der falschen Maschine. Die Node gehört an den Datensatz, weil
-- `backups.server_id` beim Löschen des Servers auf `NULL` geht – der Umweg über
-- den Server darf also wegfallen.
--
-- `ON DELETE SET NULL`: `CASCADE` nähme dem Betreiber mit der Node auch den
-- Datensatz, die einzige Spur, dass es die Sicherung gab. `RESTRICT` ließe das
-- Ausmustern einer Node an ihren Sicherungen scheitern – ohne regulären Ausweg,
-- denn der Agent, der die Archive entfernen müsste, ist mit der Node weg.
ALTER TABLE "backups" ADD COLUMN "host_id" uuid;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_host_id_host_nodes_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."host_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backups_host_id_idx" ON "backups" USING btree ("host_id");--> statement-breakpoint
-- Bestandsdaten, Teil 1: Sicherungen, deren Server noch steht. Die Zuordnung
-- ist eindeutig – das Archiv entstand auf der Node dieses Servers.
UPDATE "backups" SET "host_id" = "game_servers"."host_id"
  FROM "game_servers"
 WHERE "backups"."server_id" = "game_servers"."id";--> statement-breakpoint
-- Bestandsdaten, Teil 2: Sicherungen ohne Server (`ON DELETE SET NULL`). Für
-- die steht nirgends mehr, wo sie liegen – **außer** es gibt genau eine Node.
-- Genau das ist der heutige Stand jeder Installation, und dann liegt jedes
-- Archiv dort. Die Bedingung prüft das ausdrücklich, statt es anzunehmen: Bei
-- null oder mehreren Nodes bleibt `host_id` leer, und das Gateway nimmt
-- weiterhin `defaultHost()` – sichtbar als Warnung im Log
-- (`server-orchestration/backup-ports.ts`). Eine geratene Zuordnung wäre
-- schlimmer als eine offene: Sie sähe aus wie eine Auskunft.
UPDATE "backups" SET "host_id" = (SELECT "id" FROM "host_nodes")
 WHERE "host_id" IS NULL
   AND (SELECT count(*) FROM "host_nodes") = 1;
