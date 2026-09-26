CREATE TABLE "user_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_type" text NOT NULL,
	"name" text NOT NULL,
	"values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_presets" ADD CONSTRAINT "user_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_presets_user_game_name_idx" ON "user_presets" USING btree ("user_id","game_type","name");--> statement-breakpoint
CREATE INDEX "user_presets_user_game_idx" ON "user_presets" USING btree ("user_id","game_type");