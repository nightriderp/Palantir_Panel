CREATE TABLE "arcade_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arcade_scores" ADD CONSTRAINT "arcade_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arcade_scores_game_score_idx" ON "arcade_scores" USING btree ("game_id","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "arcade_scores_user_game_idx" ON "arcade_scores" USING btree ("user_id","game_id");