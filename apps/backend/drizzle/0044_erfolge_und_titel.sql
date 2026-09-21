-- Erfolge, Titel und Stufen (Betreiber-Wunsch 21.09.2026).
--
-- `user_achievements` haelt fest, dass ein Konto ein Abzeichen aus dem Katalog
-- in `@palantir/contracts` freigeschaltet hat - eine Zeile je Freischaltung.
-- Der eindeutige Index ueber (Konto, Abzeichen) ist zugleich die Absicherung
-- gegen doppelte Vergabe: Das Repository schreibt mit ON CONFLICT DO NOTHING,
-- statt sich auf eine Sperre zu verlassen.
--
-- Warum eine eigene Tabelle und keine Abfrage ueber das Audit-Log: Die
-- Ausloeser haengen am Log, dessen Eintraege nach 24 Monaten ins Archiv
-- wandern (Pflichtenheft §6). Eine laufend neu gezaehlte Uebersicht wuerde ein
-- Konto seine Abzeichen still verlieren lassen, sobald die alten Eintraege
-- wegrollen. Es gibt bewusst keine Punkte-Spalte - die Stufe ergibt sich aus
-- der Zahl dieser Zeilen (`levelForUnlocked`).
--
-- `users.title_achievement_id` ist der getragene Titel, gespeichert als
-- Kennung des Abzeichens statt als Text: Eine spaetere Umformulierung im
-- Katalog traegt das Konto dann mit, ein gespeicherter Text bliebe stehen.
-- Ohne Fremdschluessel, weil er auf das Paar (Konto, Abzeichen) zeigen muesste
-- und damit im Kreis zurueck auf `users` liefe; die Pruefung liegt im Service.
CREATE TABLE "user_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title_achievement_id" text;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_achievements_user_achievement_idx" ON "user_achievements" USING btree ("user_id","achievement_id");--> statement-breakpoint
CREATE INDEX "user_achievements_user_idx" ON "user_achievements" USING btree ("user_id");
