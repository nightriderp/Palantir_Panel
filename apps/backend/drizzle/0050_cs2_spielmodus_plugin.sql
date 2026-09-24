-- CS2: Die Schalter „Plugin: MatchZy“ und „Plugin: Retakes“ werden zur Auswahl
-- „Spielmodus-Plugin“ (Betreiber-Wunsch 24.09.2026, Fundpunkt 361). Beide
-- steuern den Rundenablauf und dürfen nicht zusammen laufen; eine Auswahl macht
-- das unmöglich. Bestehende Server behalten, was an war – Retakes vor MatchZy,
-- weil Retakes zuletzt dazukam und bei beiden an zuletzt gewählt war.
UPDATE "game_servers"
SET "config_json" = ("config_json" - 'pluginMatchZy' - 'pluginRetakes')
  || jsonb_build_object(
    'modePlugin',
    CASE
      WHEN "config_json" ->> 'pluginRetakes' = 'true' THEN 'retakes'
      WHEN "config_json" ->> 'pluginMatchZy' = 'true' THEN 'matchzy'
      ELSE 'none'
    END
  )
WHERE "game_type" = 'cs2';
