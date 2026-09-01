CREATE TABLE "panel_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"storage_path" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"failure_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "panel_backups_started_idx" ON "panel_backups" USING btree ("started_at" DESC NULLS LAST);