-- Fundpunkt 141 – ein gelöschtes Konto reißt keine fremden Gespräche mehr mit.
--
-- `messages.sender_id` und `message_reports.reported_by_id` standen auf
-- `ON DELETE CASCADE`. Löschte sich ein Konto (Lastenheft §3.1), verschwanden
-- damit seine Nachrichten aus **fremden** Unterhaltungen: Beim Gegenüber blieb
-- die eine Hälfte des Gesprächs zurück, ohne Hinweis, dass dort je etwas
-- anderes stand. Dasselbe von der Melderseite – mit dem Konto ging die Meldung
-- und mit ihr `reported_content`, die einzige Beweiskopie des gemeldeten
-- Textes. Ein offener Moderationsfall ließ sich so durch Löschen des eigenen
-- Kontos aus der Welt schaffen.
--
-- Entscheidung des Betreibers: Die Nachrichten bleiben, die Kennung wird
-- geleert, angezeigt wird der feste Text `DELETED_ACCOUNT_DISPLAY_NAME`
-- („Unbekanntes Konto", `packages/contracts/src/chat.ts`).
--
-- `message_reports.message_id` bleibt bewusst bei `CASCADE`: Verschwindet die
-- Nachricht wirklich, hat die Meldung darauf keinen Gegenstand mehr.
--
-- Beide Spalten tragen bereits einen Index (`messages_sender_id_idx`,
-- `message_reports_reported_by_id_idx`, Migration 0027). Ohne ihn läse
-- PostgreSQL für jede gelöschte `users`-Zeile beide Tabellen vollständig.
ALTER TABLE "message_reports" DROP CONSTRAINT "message_reports_reported_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_sender_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "message_reports" ALTER COLUMN "reported_by_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "sender_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "deleted_by_moderator" boolean;--> statement-breakpoint
-- Bestandsdaten: Bis hierher leitete das DTO „vom Moderator entfernt" aus
-- `deleted_by_id <> sender_id` ab. Solange beide Spalten noch gefüllt sind,
-- ist diese Ableitung für die bestehenden Zeilen richtig – danach nicht mehr,
-- weil ab jetzt beide `NULL` werden können. Deshalb wird sie hier einmalig
-- festgeschrieben, bevor das erste Konto gelöscht wird. `IS DISTINCT FROM`
-- statt `<>`: `deleted_by_id` ist schon heute nullbar (`ON DELETE SET NULL`
-- für Moderatoren-Konten), und `NULL <> uuid` ergäbe `NULL` statt `true`.
-- Nicht gelöschte Nachrichten bleiben `NULL` – der Vertrag liest das als
-- „steht noch" (`MessageDto.deletedByModerator`).
UPDATE "messages" SET "deleted_by_moderator" = ("deleted_by_id" IS DISTINCT FROM "sender_id") WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
