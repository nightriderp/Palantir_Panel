CREATE TABLE "arcade_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"game_id" text NOT NULL,
	"host_user_id" uuid NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"seats" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"match" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"chat" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "arcade_rooms_status_check" CHECK ("arcade_rooms"."status" in ('lobby', 'running', 'finished', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "arcade_seeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"seed" bigint NOT NULL,
	"game_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "arcade_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"title" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arcade_scores" ADD COLUMN "seed_id" uuid;--> statement-breakpoint
ALTER TABLE "arcade_scores" ADD COLUMN "game_version" integer;--> statement-breakpoint
ALTER TABLE "arcade_scores" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "arcade_rooms" ADD CONSTRAINT "arcade_rooms_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcade_seeds" ADD CONSTRAINT "arcade_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcade_tracks" ADD CONSTRAINT "arcade_tracks_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arcade_rooms_open_code_idx" ON "arcade_rooms" USING btree ("code") WHERE "arcade_rooms"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "arcade_rooms_status_idx" ON "arcade_rooms" USING btree ("status");--> statement-breakpoint
CREATE INDEX "arcade_rooms_host_idx" ON "arcade_rooms" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "arcade_seeds_user_game_idx" ON "arcade_seeds" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "arcade_seeds_expires_idx" ON "arcade_seeds" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "arcade_tracks_active_game_idx" ON "arcade_tracks" USING btree ("game_id") WHERE "arcade_tracks"."is_active";--> statement-breakpoint
CREATE INDEX "arcade_tracks_game_idx" ON "arcade_tracks" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "arcade_tracks_uploaded_by_idx" ON "arcade_tracks" USING btree ("uploaded_by");