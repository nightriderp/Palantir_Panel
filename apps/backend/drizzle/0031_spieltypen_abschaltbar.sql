-- Der Administrator kann Spieltypen ausschalten (Wunsch des Betreibers,
-- 2026-09-11).
--
-- Der Katalog selbst bleibt Code (Pflichtenheft 11): Hier steht nur, was diese
-- eine Instanz davon nicht anbietet. Deshalb `jsonb` und keine eigene Tabelle
-- mit Fremdschluessel - es gibt nichts, worauf sie zeigen koennte.
--
-- Vorgabe leer: Eine bestehende Installation bietet nach der Migration genau
-- dasselbe an wie vorher.
ALTER TABLE "instance_settings" ADD COLUMN "disabled_game_types" jsonb DEFAULT '[]'::jsonb NOT NULL;