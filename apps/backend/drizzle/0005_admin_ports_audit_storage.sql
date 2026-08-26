CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"actor_display_name" text,
	"target_type" text,
	"target_id" text,
	"ip_hint" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "port_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"range_id" uuid NOT NULL,
	"port" integer NOT NULL,
	"protocol" text NOT NULL,
	"server_id" uuid,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "port_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"start_port" integer NOT NULL,
	"end_port" integer NOT NULL,
	"protocol" text NOT NULL,
	"node_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_snapshots" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"total_bytes" bigint NOT NULL,
	"used_bytes" bigint NOT NULL,
	"free_bytes" bigint NOT NULL,
	"entries" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_nodes" ADD COLUMN "status_message" text;--> statement-breakpoint
ALTER TABLE "host_nodes" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_allocations" ADD CONSTRAINT "port_allocations_range_id_port_ranges_id_fk" FOREIGN KEY ("range_id") REFERENCES "public"."port_ranges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_ranges" ADD CONSTRAINT "port_ranges_node_id_host_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."host_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_snapshots" ADD CONSTRAINT "storage_snapshots_node_id_host_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."host_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "port_allocations_port_protocol_idx" ON "port_allocations" USING btree ("port","protocol");--> statement-breakpoint
CREATE INDEX "port_allocations_server_id_idx" ON "port_allocations" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "port_allocations_range_id_idx" ON "port_allocations" USING btree ("range_id");--> statement-breakpoint
CREATE INDEX "port_ranges_protocol_idx" ON "port_ranges" USING btree ("protocol");--> statement-breakpoint
-- ===========================================================================
-- Unveraenderlichkeit des Audit-Logs (Pflichtenheft §6 und §18, CLAUDE.md §2)
-- ===========================================================================
-- Von Hand ergaenzt: Drizzle Kit erzeugt keine Trigger. Die Regel darf nicht
-- allein im Anwendungscode stehen - jeder Datenbankzugang, auch ein direkter
-- psql-Aufruf, muss an ihr vorbei.
--
-- UPDATE und TRUNCATE sind ausnahmslos gesperrt. DELETE ist ebenfalls gesperrt,
-- mit genau einer Ausnahme: dem Archivierungsprozess aus Pflichtenheft §6. Der
-- weist sich ueber die Sitzungsvariable "palantir.audit_archive" aus, die er
-- per SET LOCAL nur innerhalb seiner eigenen Transaktion setzt, und darf auch
-- dann ausschliesslich Eintraege entfernen, die aelter als 24 Monate sind -
-- nachdem er sie in die Archivdatei exportiert hat.
--
-- Die 24 Monate stehen zusaetzlich als AUDIT_RETENTION_MONTHS in
-- packages/contracts/src/audit.ts. Die Wiederholung ist gewollt: Die Datenbank
-- prueft unabhaengig davon, was der Anwendungscode behauptet.
CREATE FUNCTION palantir_audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'AUDIT_ENTRY_IMMUTABLE: Eintraege im Audit-Log koennen nicht geaendert werden.'
			USING ERRCODE = '42501';
	END IF;

	IF TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'AUDIT_ENTRY_IMMUTABLE: Das Audit-Log kann nicht geleert werden.'
			USING ERRCODE = '42501';
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF coalesce(current_setting('palantir.audit_archive', true), '') <> 'on' THEN
			RAISE EXCEPTION 'AUDIT_ENTRY_IMMUTABLE: Eintraege im Audit-Log koennen nicht geloescht werden.'
				USING ERRCODE = '42501';
		END IF;

		IF OLD."timestamp" > now() - interval '24 months' THEN
			RAISE EXCEPTION 'AUDIT_ENTRY_IMMUTABLE: Nur Eintraege aelter als 24 Monate duerfen archiviert werden.'
				USING ERRCODE = '42501';
		END IF;

		RETURN OLD;
	END IF;

	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION palantir_audit_log_guard();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
	BEFORE TRUNCATE ON "audit_log"
	FOR EACH STATEMENT EXECUTE FUNCTION palantir_audit_log_guard();
