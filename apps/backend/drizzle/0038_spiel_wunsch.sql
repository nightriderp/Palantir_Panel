CREATE TABLE "game_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_requests" ADD CONSTRAINT "game_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_requests" ADD CONSTRAINT "game_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_requests_open_per_user_idx" ON "game_requests" USING btree ("user_id") WHERE "game_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "game_requests_status_created_idx" ON "game_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "game_requests_user_id_idx" ON "game_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "game_requests_decided_by_id_idx" ON "game_requests" USING btree ("decided_by_id");