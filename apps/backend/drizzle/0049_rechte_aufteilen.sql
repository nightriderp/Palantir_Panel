-- Rechte aufteilen (Fundpunkte 345/346, Betreiber-Wunsch 23.09.2026).
--
-- Drei Aufgaben hingen bis hierher an Rechten, die etwas anderes beschreiben:
-- Instanz-Einstellungen und Schriften an `user.manage`, Spiel-Anfragen und das
-- Schalten der Templates an `user.manage`, die Panel-Sicherung an
-- `backup.manage.any`. Die Routen verlangen ab dieser Fassung die neuen bzw.
-- passenden Rechte. Damit keine bestehende Rolle dabei etwas verliert, bekommt
-- jede Rolle, die das alte Recht trug, das neue dazu. Enger schneiden kann der
-- Betreiber danach im Rollen-Editor.
--
-- Reine Datenmigration: `roles.permissions` ist `text[]`, der Katalog wird von
-- der Anwendung geprueft (siehe `db/schema/rbac.ts`).

UPDATE "roles"
SET "permissions" = array_append("permissions", 'instance.manage'), "updated_at" = now()
WHERE 'user.manage' = ANY("permissions") AND NOT ('instance.manage' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = array_append("permissions", 'gametype.manage'), "updated_at" = now()
WHERE 'user.manage' = ANY("permissions") AND NOT ('gametype.manage' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = array_append("permissions", 'panelBackup.manage'), "updated_at" = now()
WHERE 'backup.manage.any' = ANY("permissions") AND NOT ('panelBackup.manage' = ANY("permissions"));
