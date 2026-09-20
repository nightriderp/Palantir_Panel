-- Mitgelieferte Schriften lassen sich ausblenden (Betreiber-Wunsch 20.09.2026).
--
-- Die sechs mitgelieferten Schriften liegen im Abbild, nicht in der Datenbank:
-- Loeschen laesst sich dort nichts, und der naechste Start braechte sie
-- zurueck. Die Instanz merkt sich deshalb, welche sie verschweigen soll.
--
-- Dieselbe Bauart wie `disabled_game_types` daneben und aus demselben Grund:
-- eine Liste kurzer Kennungen ohne Fremdschluessel, deren Katalog im Code
-- steht.
ALTER TABLE "instance_settings"
  ADD COLUMN IF NOT EXISTS "hidden_bundled_fonts" jsonb DEFAULT '[]'::jsonb NOT NULL;
