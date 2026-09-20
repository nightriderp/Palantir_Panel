-- Die Fassung des Agents ueberlebt jetzt den Neustart des Backends
-- (WORK_STATUS.md, Gefundener Punkt 321).
--
-- Was ein Agent im "hello" ueber sich sagt, stand bisher nur in einer Map im
-- Arbeitsspeicher. Das genuegt fuer eine laufende Node, versagt aber in den
-- beiden Lagen, in denen die Angabe zaehlt: Jedes Ausrollen startet das
-- Backend neu - und ausgerechnet danach sieht man nach, ob die Node
-- nachgezogen hat. Und eine Node, die nicht mehr hochkommt, meldet sich nie
-- wieder; dort ist der zuletzt bekannte Stand die eigentliche Auskunft.
--
-- Der Zeitstempel gehoert zwingend dazu: Erst er sagt, ob die Fassung von eben
-- stammt oder von vorletzter Woche. Alle drei Spalten sind NULL, solange sich
-- nie ein Agent gemeldet hat.
ALTER TABLE "host_nodes" ADD COLUMN "agent_version" text;--> statement-breakpoint
ALTER TABLE "host_nodes" ADD COLUMN "agent_protocol_version" integer;--> statement-breakpoint
ALTER TABLE "host_nodes" ADD COLUMN "agent_reported_at" timestamp with time zone;
